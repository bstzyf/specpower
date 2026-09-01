/**
 * CLI command: specpower sync [--user]
 *
 * Force-refreshes specpower assets (skills, command aliases, and — for the
 * project scope — prompts/schemas/templates) from the installed package into
 * either the current project's `.claude/` (default) or the user-level
 * `~/.claude/` (`--user`).
 *
 * Unlike `specpower init`, sync is unguarded: it always refreshes, overwriting
 * stale copies. Use it after `npm install -g specpower@latest` to propagate
 * the new version's skills into a project (model C) or into your user config
 * (model B).
 *
 * Scope behavior:
 * - project (default): copies skills + commands + prompts + schemas +
 *   templates. SKILL.md prompt references stay relative (`.claude/specpower/
 *   prompts/...`) because both the skills and the prompts live under the
 *   project's `.claude/`, resolved against the session cwd.
 * - user (--user): copies skills + commands only and rewrites each SKILL.md's
 *   prompt references to point at the installed package's `prompts/` dir.
 *   User-level skills live in `~/.claude` but prompts are resolved relative
 *   to the project cwd, so the prompts are NOT copied per-user — the package
 *   remains the single source of truth and updates with the next install.
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  COMMAND_NAMES,
  copySkillsAndCommands,
  copyPrompts,
  copySchemas,
  copyTemplates,
  copyCustom,
  findPackageRoot,
  readPackageVersion,
  stampVersionInConfig,
} from './init.js';
import { bakeCustomIncludes } from './custom-bake.js';
import type { ToolAdapter, ToolId } from '../../core/tools/types.js';
import { resolveTool, maybeToolHint, allAdapters } from '../../core/tools/adapters.js';

/**
 * Options for {@link syncAssets}.
 */
export interface SyncOptions {
  /** When true, sync into `~/.<rootDir>` (user-level, model B) instead of the cwd project. */
  readonly user?: boolean;
  /**
   * Override the project root for project-scope sync. Defaults to `process.cwd()`.
   * Exposed for tests; the CLI action leaves it unset.
   */
  readonly projectRoot?: string;
  /**
   * Force a specific tool adapter (project scope). When unset, project-scope
   * sync resolves the tool via {@link resolveToolForProject} (detects the
   * existing `<rootDir>` layout, falling back to `resolveTool`). Used by
   * {@link propagateToWorktrees} to pin the main checkout's tool for fresh
   * worktrees that have no rootDir of their own.
   */
  readonly tool?: ToolAdapter;
  /**
   * Internal: when false, skip the post-sync worktree propagation step. Set to
   * `false` by {@link propagateToWorktrees} so the recursive per-worktree sync
   * calls do not re-propagate (which would loop). External callers leave it
   * unset (default `true`).
   */
  readonly _propagate?: boolean;
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  readonly status: 'synced';
  readonly scope: 'project' | 'user';
  /** The target tool that was synced (claude | opencode | cac). */
  readonly tool: ToolId;
  /** The tool's root directory that was refreshed (e.g. `<project>/.claude`). */
  readonly target: string;
  /** Absolute path to the installed specpower package the assets came from. */
  readonly packageRoot: string;
  /** Human-readable list of asset groups that were refreshed. */
  readonly refreshed: readonly string[];
  /** Stale skill dirs / command files removed because they no longer exist in this version. */
  readonly removed: readonly string[];
  readonly message: string;
}

const SPECPOWER_SKILL_PREFIX = 'specpower-';

/**
 * Detects whether `cwd` lives inside a **linked** git worktree (rather than
 * the repo's own working copy). In a linked worktree, `git rev-parse --git-dir`
 * points at the worktree's private `.git/worktrees/<name>` dir while
 * `--git-common-dir` points at the shared main repo `.git`; the two differ. In
 * the main checkout both resolve to the same `.git`; outside any repo git fails
 * and we return false.
 *
 * Both paths come from git itself (same normalization style) and are made
 * absolute against `cwd`, then forward-slash + lower-case normalized before
 * comparing. This is required on **Windows**, where the previous impl compared
 * `dirname(resolve(cwd, --git-common-dir))` against `--show-toplevel` and
 * mis-detected the main checkout as a worktree: `resolve()` yields backslash
 * paths while `--show-toplevel` uses forward slashes, and `fs.mkdtemp` returns
 * 8.3 short-name paths (`C:\Users\LIANGK~1\...`) that `--show-toplevel` reports
 * as long names (`C:/Users/liangkongrong/...`) — `fs.realpathSync` does not
 * reliably expand short names, so the two compared strings never matched even
 * in the main repo. Comparing two git outputs (`--git-dir` vs
 * `--git-common-dir`) eliminates both divergence sources because both sides
 * undergo the identical `resolve(cwd, p)` transformation.
 *
 * Used by {@link syncAssets} to skip {@link stampVersionInConfig} when run
 * inside a worktree — otherwise the stamp would mutate the worktree's
 * tracked `specpower/config.yaml`, polluting `git diff`/PR noise. The
 * version is reconciled when sync runs against the main checkout instead.
 *
 * @param cwd - Directory to probe. Defaults to `process.cwd()`.
 */
export function isInsideWorktree(cwd: string = process.cwd()): boolean {
  try {
    const run = (args: string[]) =>
      execSync(`git ${args.join(' ')}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    const gitDir = run(['rev-parse', '--git-dir']);
    const commonDir = run(['rev-parse', '--git-common-dir']);
    if (!gitDir || !commonDir) return false;
    // Both may be relative (`.git`); resolve against cwd, then normalize
    // separators + case so the comparison is stable on Windows (backslash vs
    // forward slash, short vs long names — both sides transformed identically).
    const norm = (p: string): string =>
      resolve(cwd, p).replace(/\\/g, '/').toLowerCase();
    return norm(gitDir) !== norm(commonDir);
  } catch {
    return false;
  }
}

/**
 * Enumerate the **linked** git worktrees of the repository containing
 * `projectRoot`, excluding the main checkout itself. Returns absolute paths.
 *
 * Uses `git worktree list --porcelain` (stable, machine-readable). Parses only
 * `worktree <path>` lines; the main checkout is the first entry emitted by git,
 * so it is skipped. Outside a git repo (or on any git failure) returns `[]` —
 * callers treat propagation as best-effort.
 *
 * Why: a fresh git worktree contains only tracked files, so specpower's
 * regenerated assets (skills/prompts/…) absent from the main checkout's tracked
 * set are missing in each worktree. {@link propagateToWorktrees} uses this list
 * to sync assets into every worktree after a main-checkout sync, deterministically
 * and without relying on a shell guard (which is unreliable on Windows — see
 * {@link isInsideWorktree} and the worktree-skill-loading fix).
 *
 * @param projectRoot - A path inside the repository whose worktrees to list.
 */
export function listLinkedWorktrees(projectRoot: string): readonly string[] {
  try {
    const out = execSync('git worktree list --porcelain', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const worktrees: string[] = [];
    let first = true;
    for (const line of out.split(/\r?\n/)) {
      const m = /^worktree (.+)$/.exec(line);
      if (!m) continue;
      if (first) {
        // git emits the main checkout first; skip it — only linked worktrees
        // are propagation targets.
        first = false;
        continue;
      }
      worktrees.push(m[1].trim());
    }
    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Resolve the main checkout's top-level directory for a path that may live
 * inside a linked git worktree. Returns `null` outside a repo or on any git
 * failure. Uses `--git-common-dir` (shared across the main checkout and its
 * linked worktrees) and takes its parent — the main checkout root.
 */
function mainCheckoutRoot(cwd: string): string | null {
  try {
    const common = execSync('git rev-parse --git-common-dir', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!common) return null;
    return dirname(resolve(cwd, common));
  } catch {
    return null;
  }
}

/**
 * Resolve the active tool adapter for a project directory by detecting which
 * tool's `<rootDir>` already exists on disk, falling back to `resolveTool`
 * (env `SPECPOWER_TOOL` → user config → claude default) when none exists.
 *
 * Why: `syncAssets`/step-3.5 `specpower sync` previously resolved the tool via
 * `resolveTool` alone, which honors the user config / env. When that persisted
 * tool differs from the tool layout the project actually uses (e.g. user config
 * pins `chrys` → `.agents/`, but the project uses `cac` → `.cac/`), sync wrote
 * to the wrong root and the host Skill tool found no skills there. Detecting
 * the existing `<rootDir>` makes sync align with the layout the project
 * actually uses, regardless of the user config.
 *
 * A fresh linked worktree has no `<rootDir>` of its own (its regenerated assets
 * are untracked, so a fresh worktree does not carry them). In that case the
 * fallback inspects the **main checkout** (the worktree shares the main repo's
 * `.git`, so its root is derivable via `--git-common-dir`) for an existing
 * `<rootDir>` — that is the layout the project actually uses, and the worktree
 * must inherit it rather than the (possibly mismatched) user config. Only when
 * neither the worktree nor the main checkout has a rootDir does it fall back to
 * the passed-in `fallback` / `resolveTool()`.
 *
 * @param projectRoot - Absolute path to the specpower project root (may be a
 *   linked worktree).
 * @param fallback - Adapter to use when no `<rootDir>` exists on disk anywhere
 *   derivable. Defaults to `resolveTool()`; callers pass the main checkout's
 *   resolved tool so fresh worktrees inherit it.
 */
export async function resolveToolForProject(
  projectRoot: string,
  fallback?: ToolAdapter,
): Promise<ToolAdapter> {
  // Prefer an adapter whose root dir already exists on disk — that is the
  // layout the project actually uses.
  for (const adapter of allAdapters()) {
    if (existsSync(join(projectRoot, adapter.rootDir))) {
      return adapter;
    }
  }
  // Fresh worktree: no rootDir here. Inherit from the main checkout (shared
  // .git) rather than the user config, which may pin a different tool.
  const mainRoot = mainCheckoutRoot(projectRoot);
  if (mainRoot && mainRoot !== projectRoot) {
    for (const adapter of allAdapters()) {
      if (existsSync(join(mainRoot, adapter.rootDir))) {
        return adapter;
      }
    }
  }
  return fallback ?? (await resolveTool(process.env.SPECPOWER_TOOL));
}



/**
 * The set of skill dir names the current version ships, e.g. `specpower-plan`.
 */
function currentSkillDirs(): readonly string[] {
  return COMMAND_NAMES.map((c) => `${SPECPOWER_SKILL_PREFIX}${c}`);
}

/**
 * The set of command alias files the current version ships, e.g. `plan.md`.
 */
function currentCommandFiles(): readonly string[] {
  return COMMAND_NAMES.map((c) => `${c}.md`);
}

/**
 * Removes skill files/dirs and command alias files that belong to specpower
 * but are no longer shipped by the current version (e.g. renamed or removed
 * skills across versions). Non-specpower entries are left untouched.
 *
 * Tool-aware: nested tools (claude/cac) prune `specpower-*` skill DIRS under
 * `skills/`; flat tools (opencode) prune `specpower-*.md` skill FILES under
 * `agent/`. The command scan dir also varies per tool.
 *
 * @returns Human-readable paths of everything removed.
 */
async function cleanStale(
  tool: ToolAdapter,
  toolRoot: string,
): Promise<string[]> {
  const removed: string[] = [];
  const validSkills = new Set(currentSkillDirs());
  const validCommands = new Set(currentCommandFiles());
  const skillScanDir = join(toolRoot, tool.skillsScanSubdir);
  const commandScanDir = join(toolRoot, tool.commandsScanSubdir);
  const flat = tool.skillLayout === 'flat';

  try {
    const entries = await fs.readdir(skillScanDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const matches =
          flat
            ? entry.isFile() &&
              entry.name.startsWith(SPECPOWER_SKILL_PREFIX) &&
              entry.name.endsWith('.md')
            : entry.isDirectory() &&
              entry.name.startsWith(SPECPOWER_SKILL_PREFIX);
        if (!matches) {
          return;
        }
        const canonical = flat ? entry.name.replace(/\.md$/, '') : entry.name;
        if (!validSkills.has(canonical)) {
          await fs.rm(join(skillScanDir, entry.name), {
            recursive: true,
            force: true,
          });
          removed.push(`${tool.skillsScanSubdir}/${entry.name}`);
        }
      }),
    );
  } catch {
    // skills dir does not exist yet — nothing to clean.
  }

  try {
    const entries = await fs.readdir(commandScanDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !validCommands.has(entry.name)
        ) {
          await fs.rm(join(commandScanDir, entry.name), { force: true });
          removed.push(`${tool.commandsScanSubdir}/${entry.name}`);
        }
      }),
    );
  } catch {
    // command dir does not exist yet — nothing to clean.
  }

  return removed;
}

/**
 * Refreshes specpower assets from the installed package into the active
 * tool's root directory (project or user scope).
 *
 * @param opts - Sync options (scope, projectRoot override).
 * @returns SyncResult describing what was refreshed and pruned.
 */
export async function syncAssets(
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const scope: 'project' | 'user' = opts.user ? 'user' : 'project';
  const packageRoot = findPackageRoot();
  const projectRoot = opts.projectRoot ?? process.cwd();
  // Tool resolution differs by scope:
  // - user scope: always resolveTool (env → user config → claude); the user
  //   home has no "existing rootDir" to detect from.
  // - project scope: honor an explicit opts.tool override (used by worktree
  //   propagation to pin the main checkout's tool); otherwise detect the
  //   existing <rootDir> layout so sync aligns with the tool the project
  //   actually uses, regardless of a mismatched user config (the
  //   worktree-skill-loading bug root cause).
  const tool =
    scope === 'user'
      ? await resolveTool(process.env.SPECPOWER_TOOL)
      : opts.tool ?? (await resolveToolForProject(projectRoot));
  const toolRoot =
    scope === 'user'
      ? join(homedir(), tool.rootDir)
      : join(projectRoot, tool.rootDir);

  const removed = await cleanStale(tool, toolRoot);

  // Refresh skills + command aliases, emitting through the tool adapter.
  // User scope rewrites prompt refs to the installed package (per adapter).
  await copySkillsAndCommands(tool, toolRoot, packageRoot, { scope });

  const refreshed = [...currentSkillDirs(), tool.commandsScanSubdir];

  if (scope === 'project') {
    // Project skills reference prompts/schemas/templates via relative paths
    // resolved against the project cwd, so copy them next to the skills.
    await copyPrompts(tool, toolRoot, packageRoot);
    await copySchemas(toolRoot, packageRoot);
    await copyTemplates(toolRoot, packageRoot);
    await copyCustom(projectRoot, packageRoot);
    // Expand `!include` directives in custom rule files into literal text,
    // right after copyCustom copies the package-root custom/ in place.
    await bakeCustomIncludes(projectRoot, tool.rootDir);
    refreshed.push('prompts', 'schemas', 'templates', 'custom');

    // Stamp the installed version into config.yaml so a later `specpower init`
    // sees `equal` instead of re-offering to sync the (now-current) assets.
    // Surgical: only the `version:` line is touched, preserving comments.
    //
    // Skip the stamp inside a linked git worktree: mutating the worktree's
    // tracked config.yaml would pollute `git diff`/PR noise, and the version
    // is reconciled the next time sync runs against the main checkout.
    if (!isInsideWorktree(projectRoot)) {
      await stampVersionInConfig(projectRoot, readPackageVersion(packageRoot));
      // A main-checkout sync is the canonical point to propagate the freshly
      // synced assets into every linked git worktree: a fresh worktree contains
      // only tracked files, so regenerated assets (skills/prompts/…) that are
      // untracked in the main checkout are missing there, and the host Skill
      // tool cannot discover `specpower-*` skills in the worktree's cwd. Doing
      // it here (CLI-level, deterministic) avoids relying on a POSIX shell guard
      // in build's worktree setup, which is unreliable on Windows. Suppressed
      // when _propagate is false (set by propagateToWorktrees' recursive calls).
      if (opts._propagate !== false) {
        await propagateToWorktrees(projectRoot, tool);
      }
    }
  }

  return {
    status: 'synced',
    scope,
    tool: tool.id,
    target: toolRoot,
    packageRoot,
    refreshed,
    removed,
    message: `Synced specpower assets (${scope}, tool: ${tool.id}) to ${toolRoot}.`,
  };
}

/**
 * Sync specpower assets into every linked git worktree of `projectRoot`,
 * using each worktree's detected tool layout (falling back to `mainTool` for
 * fresh worktrees that have no `<rootDir>` of their own).
 *
 * Best-effort and permissive: a failed worktree (e.g. its directory was removed
 * mid-run) is reported on stdout but never aborts the overall sync, and the
 * recursive per-worktree syncs run with `_propagate: false` so they do not
 * re-propagate (no infinite loop).
 *
 * @param projectRoot - The main checkout root (a specpower project, NOT a worktree).
 * @param mainTool - The tool resolved for the main checkout; inherited by fresh
 *   worktrees that have no rootDir to detect from.
 */
async function propagateToWorktrees(
  projectRoot: string,
  mainTool: ToolAdapter,
): Promise<void> {
  const worktrees = listLinkedWorktrees(projectRoot);
  for (const wt of worktrees) {
    try {
      const wtTool = await resolveToolForProject(wt, mainTool);
      await syncAssets({ projectRoot: wt, tool: wtTool, _propagate: false });
    } catch (error: unknown) {
      // A single broken worktree must not abort the whole sync. Surface it and
      // continue; the main checkout's sync already succeeded.
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: could not propagate specpower assets to worktree ${wt}: ${msg}`);
    }
  }
}

/**
 * Registers the `sync` command with Commander.
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description(
      'Refresh specpower skills/commands/assets from the installed package ' +
        '(--user targets ~/.<rootDir>; tool via `specpower config` or SPECPOWER_TOOL)',
    )
    .option(
      '--user',
      'Sync to user-level ~/.<rootDir> instead of the current project',
    )
    .action(async (opts: SyncOptions) => {
      await maybeToolHint();
      const result = await syncAssets(opts);
      console.info(result.message);
      if (result.removed.length > 0) {
        console.info(`Removed stale: ${result.removed.join(', ')}`);
      }
      if (result.scope === 'user') {
        console.info(
          'User-level skills now reference prompts directly from the installed package ' +
            `(${result.packageRoot}).`,
        );
      }
    });
}
