/**
 * Bakes `!include` directives in `specpower/custom/{coding,review}/*.md` into
 * their expanded literal text, in place, at `init`/`sync` time.
 *
 * Custom rule files may reference project documentation (coding-style, ADRs,
 * architecture notes) via `!include <rel-from-project-root>`. Rather than make
 * the controller or subagent resolve these at runtime (fragile, cwd-dependent,
 * and absent in worktrees where gitignored assets are missing), we expand
 * them deterministically into plain text right after `copyCustom` copies the
 * package-root `custom/` into `specpower/custom/`.
 *
 * Expansion is recursive (A→B→C), with:
 * - cycle detection (expansion stack by realpath)
 * - depth cap (MAX_DEPTH)
 * - once semantics (a file is expanded only once globally — diamond includes
 *   don't duplicate content)
 * - sandbox allowlist (target must resolve under an include-root)
 * - hard limits (per-file size, total size, extension whitelist)
 *
 * Any failure (missing file, out-of-sandbox, cycle, over-limit, bad syntax,
 * disallowed extension) throws with a clear message naming the offending file
 * and directive — never silently skips (silent skips are the bug class that
 * broke custom in the first place).
 *
 * This is a no-op if `specpower/custom/` is absent (e.g. a non-specpower
 * project or a stale worktree that hasn't been synced).
 */

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import {
  join,
  resolve,
  relative,
  isAbsolute,
  extname,
  dirname,
  basename,
} from 'node:path';
import yaml from 'js-yaml';

/** Matches a whole-line include directive, e.g. `!include docs/coding-style.md`. */
const INCLUDE_RE = /^[ \t]*!\s*include\s+(\S+)\s*$/;

/** Directories whose files may be the target of `!include`. Always-allowed defaults: `specpower/` + common project doc dirs. */
const DEFAULT_INCLUDE_ROOTS = ['specpower/', 'docs/', 'arch/', 'design/'];

const MAX_DEPTH = 10;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const ALLOWED_EXT = new Set(['.md', '.txt', '.yaml', '.yml', '.json']);

interface BakeCtx {
  readonly projectRoot: string;
  /** Realpath'd absolute include-roots (sandbox boundaries). */
  readonly roots: readonly string[];
  /** Current expansion chain (realpath) — for cycle detection. */
  readonly stack: Set<string>;
  /** Globally-expanded files (realpath) — for once semantics. */
  readonly seen: Set<string>;
  /** Running byte total of source files read, for the total cap. */
  totalBytes: number;
}

/**
 * Builds an error that names the offending file (project-relative), the line
 * number, the directive, and the reason — so failures surface exactly where
 * the bad include lives instead of as a generic stack trace.
 */
function includeError(
  ctx: BakeCtx,
  absFile: string,
  line: number,
  directive: string,
  reason: string,
): Error {
  const where = relative(ctx.projectRoot, absFile) || absFile;
  return new Error(
    `custom include error in ${where}:${line} — ${directive}: ${reason}`,
  );
}

/**
 * Is `target` (realpath'd) equal to or nested under `root` (realpath'd)?
 * Uses `relative` so symlinks and `..` traversal are already resolved away
 * by the realpath calls — a non-empty, non-`..`-prefixed relative path means
 * containment.
 */
function isUnderRoot(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function isUnderAnyRoot(target: string, roots: readonly string[]): boolean {
  return roots.some((r) => isUnderRoot(target, r));
}

/**
 * Converts a simple glob pattern to a RegExp. Only `*` (matches non-`/`) and
 * `?` (matches single non-`/`) are special; everything else is escaped.
 * Used by wildcard `!include docs/rules/*.md` to enumerate a directory.
 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Reads `specpower/config.yaml` and returns the declared `custom.include-roots`
 * (prefixed with the always-present `specpower/`). Missing config or missing
 * field yields the default. Non-existent declared roots are dropped silently
 * (they constrain nothing; a target under them would fail file-not-found).
 */
async function resolveIncludeRoots(
  projectRoot: string,
): Promise<readonly string[]> {
  const declared = DEFAULT_INCLUDE_ROOTS.slice();
  const configPath = join(projectRoot, 'specpower', 'config.yaml');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = yaml.load(content) as
      | { custom?: { 'include-roots'?: unknown } }
      | undefined;
    const extra = parsed?.custom?.['include-roots'];
    if (Array.isArray(extra)) {
      for (const r of extra) {
        if (typeof r === 'string') {
          declared.push(r);
        }
      }
    }
  } catch {
    // No config.yaml or unreadable — use defaults.
  }

  // Realpath each root; drop ones that don't exist (can't constrain anything).
  const real: string[] = [];
  for (const r of declared) {
    const abs = resolve(projectRoot, r);
    try {
      real.push(fsSync.realpathSync(abs));
    } catch {
      // declared root doesn't exist yet — skip it
    }
  }
  return real;
}

/**
 * Expands a single file: reads it, replaces each `!include` line with the
 * recursively-expanded content of its target, returns the expanded text.
 * Mutates `ctx.stack` / `ctx.seen` / `ctx.totalBytes`.
 */
async function expandFile(absFile: string, ctx: BakeCtx): Promise<string> {
  let realFile: string;
  try {
    realFile = fsSync.realpathSync(absFile);
  } catch {
    throw includeError(ctx, absFile, 0, `!include`, `file not found`);
  }

  // Cycle: already in the current expansion chain.
  if (ctx.stack.has(realFile)) {
    const chain = relative(ctx.projectRoot, realFile) || realFile;
    throw new Error(`circular include: ${chain}`);
  }
  // Once: already expanded elsewhere — skip (no duplicate content).
  if (ctx.seen.has(realFile)) {
    return '';
  }
  // Depth cap.
  if (ctx.stack.size >= MAX_DEPTH) {
    throw new Error(
      `include too deep (max depth ${MAX_DEPTH}) while expanding ${relative(ctx.projectRoot, realFile) || realFile}`,
    );
  }
  ctx.stack.add(realFile);
  ctx.seen.add(realFile);

  const stat = await fs.stat(absFile);
  if (!stat.isFile()) {
    throw includeError(
      ctx,
      absFile,
      0,
      `!include`,
      `${relative(ctx.projectRoot, absFile) || absFile} is not a regular file`,
    );
  }

  const raw = await fs.readFile(absFile, 'utf-8');
  const fileBytes = Buffer.byteLength(raw);
  if (fileBytes > MAX_FILE_BYTES) {
    throw new Error(
      `custom include error: ${relative(ctx.projectRoot, absFile) || absFile} exceeds ${MAX_FILE_BYTES} bytes`,
    );
  }
  ctx.totalBytes += fileBytes;
  if (ctx.totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `custom include error: total expanded size exceeds ${MAX_TOTAL_BYTES} bytes`,
    );
  }

  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = INCLUDE_RE.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const directive = lines[i].trim();
    const inc = m[1];

    if (isAbsolute(inc)) {
      throw includeError(
        ctx,
        absFile,
        i + 1,
        directive,
        `path must be relative to the project root, not absolute`,
      );
    }

    const target = resolve(ctx.projectRoot, inc);

    // Wildcard include: `!include docs/rules/*.md` expands all matching files
    // in the directory (lexicographic, extension-whitelisted, per-file once).
    if (inc.includes('*') || inc.includes('?')) {
      const dirPath = dirname(target);
      const pattern = basename(target);
      let realDir: string;
      try {
        realDir = fsSync.realpathSync(dirPath);
      } catch {
        throw includeError(ctx, absFile, i + 1, directive, `directory not found: ${inc}`);
      }
      if (!isUnderAnyRoot(realDir, ctx.roots)) {
        const rootNames = ctx.roots
          .map((r) => relative(ctx.projectRoot, r) || r)
          .join(', ');
        throw includeError(
          ctx,
          absFile,
          i + 1,
          directive,
          `directory is outside include-roots [${rootNames}]`,
        );
      }
      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(realDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      const re = globToRegex(pattern);
      const matches = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => re.test(name))
        .filter((name) => ALLOWED_EXT.has(extname(name).toLowerCase()))
        .sort();
      if (matches.length === 0) {
        throw includeError(
          ctx,
          absFile,
          i + 1,
          directive,
          `no files matched ${inc}`,
        );
      }
      const parts: string[] = [];
      for (const name of matches) {
        parts.push(await expandFile(join(realDir, name), ctx));
      }
      out.push(parts.join('\n'));
      continue;
    }

    const ext = extname(target).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw includeError(
        ctx,
        absFile,
        i + 1,
        directive,
        `extension ${ext || '(none)'} not allowed; allowed: ${[...ALLOWED_EXT].join(', ')}`,
      );
    }

    let realTarget: string;
    try {
      realTarget = fsSync.realpathSync(target);
    } catch {
      // Fail-fast: a missing target aborts sync rather than degrading to a
      // comment. Silent skips are the bug class that broke custom in the
      // first place — a bad `!include` path must be fixed at the source.
      throw includeError(ctx, absFile, i + 1, directive, `file not found: ${inc}`);
    }

    if (!isUnderAnyRoot(realTarget, ctx.roots)) {
      // Fail-fast: a target outside every include-root aborts sync. No
      // out-of-sandbox content ever reaches a prompt, and the consumer is
      // forced to declare the root (or fix the path) rather than silently
      // shipping a skipped directive.
      const rootNames = ctx.roots
        .map((r) => relative(ctx.projectRoot, r) || r)
        .join(', ');
      throw includeError(
        ctx,
        absFile,
        i + 1,
        directive,
        `target is outside include-roots [${rootNames}]`,
      );
    }

    const expanded = await expandFile(target, ctx);
    out.push(expanded);
  }

  ctx.stack.delete(realFile);
  return out.join('\n');
}

/**
 * Expands `!include` directives in every top-level `.md` of
 * `specpower/custom/{coding,review}/`, writing the expanded text back in
 * place. Called by `init`/`sync` (project scope) immediately after
 * `copyCustom`.
 *
 * Each top-level custom md is expanded with a fresh ctx (independent
 * `seen`/`stack`), so the same shared doc included by a coding rule and a
 * review rule both end up with the content — once semantics apply within a
 * single top-level file's expansion, not across files. `totalBytes` is
 * shared across all expansions (the total-size cap is global).
 *
 * No-op if `specpower/custom/` is absent. After includes are baked, the
 * `[CONTROLLER: ...]` placeholders in the project's prompt copies
 * (`.claude/specpower/prompts/...`) are baked to the concatenated custom
 * text of the matching kind.
 */
export async function bakeCustomIncludes(
  projectRoot: string,
  rootDir = '.claude',
): Promise<void> {
  const roots = await resolveIncludeRoots(projectRoot);
  let totalBytes = 0;

  for (const kind of ['coding', 'review'] as const) {
    const dir = join(projectRoot, 'specpower', 'custom', kind);
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory missing (no custom, or worktree not synced) — skip.
      continue;
    }
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort(); // lexicographic, matches the controller's read order
    for (const name of mdFiles) {
      const file = join(dir, name);
      // Fresh ctx per top-level file: seen/stack are per-file so the same
      // shared doc can be included by both a coding rule and a review rule
      // without the second expansion coming back empty. totalBytes is the
      // one global budget.
      const ctx: BakeCtx = {
        projectRoot,
        roots,
        stack: new Set(),
        seen: new Set(),
        totalBytes,
      };
      const expanded = await expandFile(file, ctx);
      totalBytes = ctx.totalBytes;
      await fs.writeFile(file, expanded, 'utf-8');
    }
  }

  await bakePrompts(projectRoot, rootDir);
}

/**
 * Maps a custom kind to each prompt-copy path (relative to projectRoot) whose
 * `[CONTROLLER: ...]` placeholder should be baked to that kind's concatenated
 * custom text. These are *copies* under `<rootDir>/specpower/prompts/` (created
 * by init/sync for the active tool — `.claude/`, `.cac/`, `.agents/`, …), not the
 * package-root sources — baking the sources would leak project-specific custom
 * text back into the template.
 *
 * `rootDir` defaults to `.claude` for back-compat with callers (and tests) that
 * predate multi-root support.
 */
function promptPlaceholderMap(
  rootDir = '.claude',
): Array<{ kind: 'coding' | 'review'; promptRel: string }> {
  const base = join(rootDir, 'specpower', 'prompts');
  return [
    { kind: 'coding', promptRel: join(base, 'shared', 'implementer-prompt.md') },
    { kind: 'coding', promptRel: join(base, 'shared', 'receiving-code-review.md') },
    { kind: 'review', promptRel: join(base, 'shared', 'code-reviewer-prompt.md') },
    { kind: 'review', promptRel: join(base, 'review', 'code-review.md') },
  ];
}

/**
 * Reads every `.md` under `specpower/custom/{kind}/` (sorted, same order the
 * controller reads them in) and concatenates them with `\n`. Returns
 * `'none'` when the dir is missing or empty — the literal used as the
 * placeholder replacement so the prompt reads "none" rather than an empty
 * string (which reads as a malformed prompt).
 */
async function readCustomConcat(
  projectRoot: string,
  kind: 'coding' | 'review',
): Promise<string> {
  const dir = join(projectRoot, 'specpower', 'custom', kind);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const mds = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort();
    const parts = await Promise.all(
      mds.map((m) => fs.readFile(join(dir, m), 'utf-8')),
    );
    return parts.length ? parts.join('\n') : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Replaces every `[CONTROLLER: ...]` placeholder in each mapped prompt copy
 * with the concatenated custom text of the matching kind. A missing prompt
 * copy (project not init'd, or the prompt path was removed) is skipped
 * silently — baking is best-effort over whatever copies exist on disk.
 */
async function bakePrompts(
  projectRoot: string,
  rootDir = '.claude',
): Promise<void> {
  const byKind = {
    coding: await readCustomConcat(projectRoot, 'coding'),
    review: await readCustomConcat(projectRoot, 'review'),
  };
  for (const { kind, promptRel } of promptPlaceholderMap(rootDir)) {
    const promptPath = join(projectRoot, promptRel);
    let text: string;
    try {
      text = await fs.readFile(promptPath, 'utf-8');
    } catch {
      // Prompt copy doesn't exist (project not init'd, or path removed) —
      // nothing to bake here.
      continue;
    }
    // Match ONLY whole-line placeholders (`[CONTROLLER: ...]` on its own
    // line, optional leading whitespace). The `[^\]\n]*` excludes both `]`
    // and newline so a literal `[CONTROLLER:` that appears inline in prose
    // (e.g. the D9 self-check sentence "if you see the literal `[CONTROLLER:`")
    // — which has no matching `]` on its line — is NOT matched and NOT
    // swallowed by a greedy cross-line match into a later `]`.
    const replaced = text.replace(
      /^[ \t]*\[CONTROLLER:[^\]\n]*\][ \t]*$/gm,
      byKind[kind],
    );
    await fs.writeFile(promptPath, replaced, 'utf-8');
  }
}

// Re-exported helpers for unit testing of the sandbox/limit primitives.
export const __test = {
  INCLUDE_RE,
  isUnderRoot,
  isUnderAnyRoot,
  resolveIncludeRoots,
  expandFile,
  bakePrompts,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  ALLOWED_EXT,
};
