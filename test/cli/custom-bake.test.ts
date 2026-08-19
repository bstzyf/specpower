import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bakeCustomIncludes } from '../../src/cli/commands/custom-bake.js';
import { initProject } from '../../src/cli/commands/init.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Custom `!include` baking: directives in specpower/custom/{coding,review}/*.md
 * are recursively expanded into literal text at init/sync time, with cycle
 * detection, depth cap, once semantics, sandbox allowlist, and hard size /
 * extension limits. Any failure throws (never silently drops).
 */

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(join(file, '..'), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

async function read(file: string): Promise<string> {
  return fs.readFile(file, 'utf-8');
}

describe('bakeCustomIncludes', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'specpower-bake-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(join(dir, '..', 'escape.md'), { force: true });
  });

  async function bake(): Promise<void> {
    await bakeCustomIncludes(dir);
  }

  it('expands a basic !include into the target content and leaves no directive', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(join(dir, 'docs', 'style.md'), '# Style\n- camelCase\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', '01-rules.md'),
      'before\n!include docs/style.md\nafter\n',
    );

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', '01-rules.md'));
    expect(out).toContain('# Style');
    expect(out).toContain('- camelCase');
    expect(out).toContain('before');
    expect(out).toContain('after');
    expect(out).not.toMatch(/!\s*include/);
  });

  it('expands recursively (A → B → C)', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(join(dir, 'docs', 'c.md'), 'C-content\n');
    await write(join(dir, 'docs', 'b.md'), 'B-start\n!include docs/c.md\nB-end\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      'A-start\n!include docs/b.md\nA-end\n',
    );

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
    expect(out).toContain('A-start');
    expect(out).toContain('B-start');
    expect(out).toContain('C-content');
    expect(out).toContain('B-end');
    expect(out).toContain('A-end');
  });

  it('rejects circular includes (A ↔ B)', async () => {
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include specpower/custom/coding/b.md\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'b.md'),
      '!include specpower/custom/coding/a.md\n',
    );

    await expect(bake()).rejects.toThrow(/circular include/);
  });

  it('rejects includes deeper than max depth', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    // Build a chain of 11 files: 0 -> 1 -> ... -> 10. Expanding file 10
    // happens with 10 ancestors on the stack, tripping MAX_DEPTH (10).
    for (let i = 0; i < 10; i++) {
      await write(
        join(dir, 'docs', `n${i}.md`),
        `n${i}\n!include docs/n${i + 1}.md\n`,
      );
    }
    await write(join(dir, 'docs', 'n10.md'), 'leaf\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'chain.md'),
      '!include docs/n0.md\n',
    );

    await expect(bake()).rejects.toThrow(/too deep/);
  });

  it('expands a diamond include only once (once semantics)', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    // a -> b, a -> c, b -> d, c -> d. d's content must appear exactly once.
    await write(join(dir, 'docs', 'd.md'), 'D-MARKER\n');
    await write(
      join(dir, 'docs', 'b.md'),
      'B\n!include docs/d.md\n',
    );
    await write(
      join(dir, 'docs', 'c.md'),
      'C\n!include docs/d.md\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/b.md\n!include docs/c.md\n',
    );

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
    const occurrences = (out.match(/D-MARKER/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('throws on out-of-sandbox target (fail-fast, no leak)', async () => {
    // ../escape.md exists (in the project root's parent) but is outside
    // every include-root. Fail-fast: abort sync with a clear error naming
    // the directive — no out-of-sandbox content ever reaches the prompt,
    // and the consumer is forced to declare the root (or fix the path)
    // rather than silently shipping a skipped directive.
    await write(join(dir, '..', 'escape.md'), 'secret\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      'before\n!include ../escape.md\nafter\n',
    );

    await expect(bake()).rejects.toThrow(/outside include-roots/);
  });

  it('allows a target under a config-declared include-root', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\nversion: 0.0.0\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(join(dir, 'docs', 'x.md'), 'X-CONTENT\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/x.md\n',
    );

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
    expect(out).toContain('X-CONTENT');
  });

  it('throws on missing target (fail-fast)', async () => {
    // A missing target aborts sync (fail-fast) instead of degrading to a
    // comment. The error names the offending file, line, and directive so
    // the bad include is fixed at the source.
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      'before\n!include docs/does-not-exist.md\nafter\n',
    );

    await expect(bake()).rejects.toThrow(/file not found/);
  });

  it('rejects a directory include target', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    // A directory named *.md passes the extension check but must be rejected
    // by the isFile check.
    await fs.mkdir(join(dir, 'docs', 'fakedir.md'), { recursive: true });
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/fakedir.md\n',
    );

    await expect(bake()).rejects.toThrow(/not a regular file/);
  });

  it('wildcard include expands all matching .md in a directory (lexicographic)', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(join(dir, 'docs', 'rules', '02-arch.md'), 'ARCH\n');
    await write(join(dir, 'docs', 'rules', '01-naming.md'), 'NAMING\n');
    await write(join(dir, 'docs', 'rules', '10-security.md'), 'SECURITY\n');
    // non-.md files in the same dir are ignored by the wildcard
    await write(join(dir, 'docs', 'rules', 'README.txt'), 'IGNORED\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      'before\n!include docs/rules/*.md\nafter\n',
    );

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
    expect(out).toContain('before');
    expect(out).toContain('after');
    // Lexicographic order: 01- < 02- < 10-
    const namingIdx = out.indexOf('NAMING');
    const archIdx = out.indexOf('ARCH');
    const secIdx = out.indexOf('SECURITY');
    expect(namingIdx).toBeLessThan(archIdx);
    expect(archIdx).toBeLessThan(secIdx);
    expect(out).not.toContain('IGNORED'); // .txt filtered out
    expect(out).not.toMatch(/!\s*include/); // no directive residue
  });

  it('wildcard include throws on no matches (fail-fast)', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await fs.mkdir(join(dir, 'docs', 'rules'), { recursive: true }); // empty dir
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/rules/*.md\n',
    );

    await expect(bake()).rejects.toThrow(/no files matched/);
  });

  it('wildcard include throws when directory does not exist (fail-fast)', async () => {
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/nonexistent/*.md\n',
    );

    await expect(bake()).rejects.toThrow(/directory not found/);
  });

  it('wildcard include throws when directory is outside include-roots', async () => {
    await fs.mkdir(join(dir, '..', 'outside'), { recursive: true });
    await write(join(dir, '..', 'outside', 'a.md'), 'OUT\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include ../outside/*.md\n',
    );

    await expect(bake()).rejects.toThrow(/outside include-roots/);
  });

  it('rejects a file exceeding the per-file size limit', async () => {
    // 64 KB + 1 byte of content.
    const big = 'x'.repeat(64 * 1024 + 1);
    await write(join(dir, 'docs', 'big.md'), big + '\n');
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/big.md\n',
    );

    await expect(bake()).rejects.toThrow(/exceeds|too large/);
  });

  it('rejects a disallowed extension (.ts)', async () => {
    await write(join(dir, 'docs', 'index.ts'), 'export const x = 1;\n');
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include docs/index.ts\n',
    );

    await expect(bake()).rejects.toThrow(/extension .ts not allowed/);
  });

  it('rejects an absolute path', async () => {
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      '!include /etc/passwd\n',
    );

    await expect(bake()).rejects.toThrow(/relative to the project root/);
  });

  it('is a no-op when specpower/custom/ is absent', async () => {
    // No custom dir at all — must not throw.
    await expect(bake()).resolves.toBeUndefined();
  });

  it('leaves a file without directives byte-for-byte unchanged', async () => {
    const content = '# Rules\n- [Critical] use camelCase\n- plain rule\n';
    await write(join(dir, 'specpower', 'custom', 'coding', 'plain.md'), content);

    await bake();

    const out = await read(join(dir, 'specpower', 'custom', 'coding', 'plain.md'));
    expect(out).toBe(content);
  });

  it('does not dedup across top-level files (per-file seen)', async () => {
    // Each top-level custom md gets its own ctx (seen/stack fresh). coding/a
    // and review/b both !include the same shared doc — both must end up with
    // the shared content. (With the old global-seen, the second file would
    // get an empty expansion.)
    await write(
      join(dir, 'specpower', 'config.yaml'),
      'schema: specpower\ncustom:\n  include-roots: [docs/]\n',
    );
    await write(join(dir, 'docs', 'shared.md'), 'SHARED-MARKER\n');
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'a.md'),
      'A\n!include docs/shared.md\n',
    );
    await write(
      join(dir, 'specpower', 'custom', 'review', 'b.md'),
      'B\n!include docs/shared.md\n',
    );

    await bake();

    const codingOut = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
    const reviewOut = await read(join(dir, 'specpower', 'custom', 'review', 'b.md'));
    expect(codingOut).toContain('SHARED-MARKER');
    expect(reviewOut).toContain('SHARED-MARKER');
  });

  it('bakes prompt placeholders: coding custom replaces [CONTROLLER:...] in implementer-prompt', async () => {
    await write(join(dir, 'specpower', 'custom', 'coding', 'rules.md'), 'C-RULE\n');
    await write(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      'before\n[CONTROLLER: paste coding rules]\nafter\n',
    );

    await bake();

    const out = await read(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
    );
    expect(out).toContain('C-RULE');
    expect(out).not.toMatch(/\[CONTROLLER:/);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('bakes prompt placeholders: review custom replaces [CONTROLLER:...] in code-reviewer-prompt', async () => {
    await write(join(dir, 'specpower', 'custom', 'review', 'rules.md'), 'R-RULE\n');
    await write(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'code-reviewer-prompt.md'),
      '[CONTROLLER: paste review rules]\n',
    );

    await bake();

    const out = await read(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'code-reviewer-prompt.md'),
    );
    expect(out).toContain('R-RULE');
    expect(out).not.toMatch(/\[CONTROLLER:/);
  });

  it('bakes prompt placeholders: missing custom writes "none" into the placeholder', async () => {
    // No specpower/custom/coding dir at all -> the coding placeholder becomes
    // "none".
    await write(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      '[CONTROLLER: paste coding rules]\n',
    );

    await bake();

    const out = await read(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
    );
    expect(out.trim()).toBe('none');
    expect(out).not.toMatch(/\[CONTROLLER:/);
  });

  it('bakes prompt placeholders: skips prompt copies that do not exist', async () => {
    // No prompt copy on disk -> bakePrompts must not throw (project not
    // init'd).
    await write(join(dir, 'specpower', 'custom', 'coding', 'rules.md'), 'C-RULE\n');

    await expect(bake()).resolves.toBeUndefined();
  });

  it('does NOT swallow an inline `[CONTROLLER:` reference in prose (D9 self-check)', async () => {
    // Regression guard: the placeholder regex must match ONLY whole-line
    // `[CONTROLLER: ...]` placeholders, NOT a literal `[CONTROLLER:` that
    // appears inline in prose (e.g. the D9 self-check sentence "if you see
    // the literal `[CONTROLLER:`"). A greedy cross-line `[^\]]*` would eat
    // from the prose `[CONTROLLER:` into a later `]`, destroying content.
    await write(join(dir, 'specpower', 'config.yaml'), 'schema: specpower\n');
    await write(join(dir, 'specpower', 'custom', 'coding', 'rules.md'), 'C-RULE\n');
    await write(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      [
        'before',
        '    [CONTROLLER: paste coding rules here]',
        '    **D9 self-check:** if you see the literal `[CONTROLLER:` text,',
        '    report DONE_WITH_CONCERNS. See [Critical] and [Important] tags below.',
        'after',
      ].join('\n') + '\n',
    );

    await bake();

    const out = await read(join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'));
    // Whole-line placeholder replaced with custom content.
    expect(out).toContain('C-RULE');
    // Inline prose `[CONTROLLER:` reference preserved (NOT swallowed).
    expect(out).toContain('if you see the literal `[CONTROLLER:` text');
    // Surrounding prose with `]`-bearing tokens also intact.
    expect(out).toContain('[Critical] and [Important]');
    // No whole-line placeholder left.
    expect(out).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]]*\][ \t]*$/m);
  });

  it('integration: initProject bakes custom (skeleton has no includes, stays intact)', async () => {
    // initProject copies the package-root custom/ (skeletons, no includes)
    // and then bakes. Skeletons must pass through unchanged.
    await initProject(dir, PACKAGE_ROOT);

    const coding = await read(
      join(dir, 'specpower', 'custom', 'coding', 'coding-standards.md'),
    );
    // Skeleton has no !include directives; baking leaves it intact.
    expect(coding).not.toMatch(/!\s*include/);
    expect(coding).toContain('## Naming');
  });

  it('bakes [CONTROLLER: placeholders into a non-claude root (.cac) when rootDir is passed', async () => {
    // Regression: bakePrompts hardcoded `.claude/specpower/prompts/...`, so for
    // a cac project (prompts live under .cac/specpower/prompts/) the placeholder
    // bake was silently skipped and the [CONTROLLER: text shipped un-baked.
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'r.md'),
      '- C-RULE\n',
    );
    await write(
      join(dir, '.cac', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      'before\n[CONTROLLER: paste coding rules here]\nafter\n',
    );

    await bakeCustomIncludes(dir, '.cac');

    const out = await read(
      join(dir, '.cac', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
    );
    expect(out).toContain('C-RULE');
    expect(out).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]]*\][ \t]*$/m);
  });

  it('defaults to .claude root when rootDir is omitted (back-compat)', async () => {
    await write(
      join(dir, 'specpower', 'custom', 'coding', 'r.md'),
      '- C-RULE\n',
    );
    await write(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      '[CONTROLLER: paste coding rules here]\n',
    );

    await bakeCustomIncludes(dir); // no rootDir -> .claude (legacy default)

    const out = await read(
      join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
    );
    expect(out).toContain('C-RULE');
    expect(out).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]]*\][ \t]*$/m);
  });
});
