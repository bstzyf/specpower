import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { syncAssets, isInsideWorktree } from '../../src/cli/commands/sync.js';
import { initProject, readStoredVersion, readPackageVersion } from '../../src/cli/commands/init.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');
const DIST_ENTRY = resolve(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
const distReady = existsSync(DIST_ENTRY);

/**
 * The user-level sync targets `~/.claude`, which `os.homedir()` resolves via
 * USERPROFILE on Windows and HOME on POSIX. We run `syncAssets` inside a
 * spawned child with the profile/home env vars redirected at a temp dir so
 * the real user config is never touched.
 */
function syncUserInFakeHome(fakeHome: string): void {
  const bin = resolve(PACKAGE_ROOT, 'bin', 'specpower.js');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const result = spawnSync(process.execPath, [bin, 'sync', '--user'], {
    env,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`sync --user failed: ${result.stderr}`);
  }
}

/**
 * Thin wrapper around `git` for the worktree test fixture: runs the args in
 * `cwd`, pipes stdio to keep stderr out of the test output, and throws on
 * non-zero exit so setup failures surface clearly.
 */
function git(args: string[], cwd: string): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${(r.stderr || r.stdout).trim()}`,
    );
  }
  return (r.stdout || '').trim();
}

describe('syncAssets (project scope, model C)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-sync-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is unguarded: refreshes skills + commands + assets without an init marker', async () => {
    // No specpower/config.yaml, no prior init — sync must still succeed.
    const result = await syncAssets({ projectRoot: tmpDir });

    expect(result.status).toBe('synced');
    expect(result.scope).toBe('project');

    const skillsDir = join(tmpDir, '.claude', 'skills');
    const skillDirs = (await fs.readdir(skillsDir)).filter((e) =>
      e.startsWith('specpower-'),
    );
    expect(skillDirs).toHaveLength(10);

    // prompts/schemas/templates are copied for project scope (relative refs)
    for (const asset of ['prompts', 'schemas', 'templates']) {
      const stat = await fs.stat(join(tmpDir, '.claude', 'specpower', asset));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('keeps SKILL.md prompt paths relative in project scope', async () => {
    await syncAssets({ projectRoot: tmpDir });

    const skill = await fs.readFile(
      join(tmpDir, '.claude', 'skills', 'specpower-build', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('.claude/specpower/prompts/build/phase-a-plan.md');
    // must NOT be rewritten to an absolute package path
    expect(skill).not.toContain(`${PACKAGE_ROOT.replace(/\\/g, '/')}/prompts/`);
  });

  it('removes stale skill dirs and command files from a previous version', async () => {
    // Seed a stale skill dir + stale command alias left by an older version
    await fs.mkdir(
      join(tmpDir, '.claude', 'skills', 'specpower-deprecated'),
      { recursive: true },
    );
    await fs.writeFile(
      join(tmpDir, '.claude', 'skills', 'specpower-deprecated', 'SKILL.md'),
      'stale',
      'utf-8',
    );
    await fs.mkdir(
      join(tmpDir, '.claude', 'commands', 'specpower'),
      { recursive: true },
    );
    await fs.writeFile(
      join(tmpDir, '.claude', 'commands', 'specpower', 'oldthing.md'),
      'stale',
      'utf-8',
    );

    const result = await syncAssets({ projectRoot: tmpDir });

    expect(result.removed).toEqual(
      expect.arrayContaining([
        'skills/specpower-deprecated',
        'commands/specpower/oldthing.md',
      ]),
    );

    await expect(
      fs.stat(join(tmpDir, '.claude', 'skills', 'specpower-deprecated')),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(tmpDir, '.claude', 'commands', 'specpower', 'oldthing.md')),
    ).rejects.toThrow();

    // canonical skills survive
    await expect(
      fs.stat(join(tmpDir, '.claude', 'skills', 'specpower-plan', 'SKILL.md')),
    ).resolves.toBeDefined();
  });

  it('leaves non-specpower entries in .claude untouched', async () => {
    await fs.mkdir(join(tmpDir, '.claude', 'skills', 'my-own-skill'), {
      recursive: true,
    });
    await fs.writeFile(
      join(tmpDir, '.claude', 'skills', 'my-own-skill', 'SKILL.md'),
      'mine',
      'utf-8',
    );

    await syncAssets({ projectRoot: tmpDir });

    const stat = await fs.stat(
      join(tmpDir, '.claude', 'skills', 'my-own-skill', 'SKILL.md'),
    );
    expect(stat.isFile()).toBe(true);
  });

  it('stamps config.yaml forward to the installed version on project sync', async () => {
    // init creates config.yaml with the current version
    await initProject(tmpDir, PACKAGE_ROOT);

    // simulate a project init'd by an older version
    const configPath = join(tmpDir, 'specpower', 'config.yaml');
    let content = await fs.readFile(configPath, 'utf-8');
    content = content.replace(/^[ \t]*version:.*$\n?/m, 'version: 0.0.1\n');
    await fs.writeFile(configPath, content, 'utf-8');
    expect(readStoredVersion(tmpDir)).toBe('0.0.1');

    await syncAssets({ projectRoot: tmpDir });

    expect(readStoredVersion(tmpDir)).toBe(readPackageVersion(PACKAGE_ROOT));
    // comments preserved through the surgical stamp
    const after = await fs.readFile(configPath, 'utf-8');
    expect(after).toContain('# Project context');
  });

  it('does not create config.yaml when the project has none (user-like)', async () => {
    // a bare project that was never init'd: sync should refresh assets but not
    // invent a config.yaml
    await syncAssets({ projectRoot: tmpDir });
    await expect(fs.stat(join(tmpDir, 'specpower', 'config.yaml'))).rejects.toThrow();
  });

  it('sync refreshes <projectRoot>/specpower/custom/ via clear-then-copy', async () => {
    await syncAssets({ projectRoot: tmpDir });
    const customDir = join(tmpDir, 'specpower', 'custom');
    expect((await fs.stat(join(customDir, 'README.md'))).isFile()).toBe(true);

    // a file not in the package root should be cleared on re-sync
    await fs.mkdir(join(customDir, 'review'), { recursive: true });
    await fs.writeFile(join(customDir, 'review', 'stale.md'), 'x', 'utf-8');

    await syncAssets({ projectRoot: tmpDir });

    await expect(
      fs.stat(join(customDir, 'review', 'stale.md')),
    ).rejects.toThrow();
    expect(
      (await fs.stat(join(customDir, 'review', 'review-rules.md'))).isFile(),
    ).toBe(true);
  });
});

describe('syncAssets (user scope, model B)', () => {
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-home-'));
    // syncAssets reads process.cwd() only for project scope; for user scope
    // it reads os.homedir(). Run inside the project cwd but override HOME so
    // homedir() resolves to our temp dir.
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedUserProfile;
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('writes skills + commands under ~/.claude but NOT prompts/schemas/templates', async () => {
    const result = await syncAssets({ user: true });

    expect(result.status).toBe('synced');
    expect(result.scope).toBe('user');
    expect(result.target).toBe(join(fakeHome, '.claude'));

    const skillDirs = (await fs.readdir(join(fakeHome, '.claude', 'skills'))).filter(
      (e) => e.startsWith('specpower-'),
    );
    expect(skillDirs).toHaveLength(10);

    const cmds = (await fs.readdir(join(fakeHome, '.claude', 'commands', 'specpower'))).filter(
      (e) => e.endsWith('.md'),
    );
    expect(cmds).toHaveLength(10);

    // prompts/schemas/templates are NOT copied per-user (sourced from package)
    await expect(fs.stat(join(fakeHome, '.claude', 'specpower'))).rejects.toThrow();
  });

  it('rewrites SKILL.md prompt paths to point at the installed package', async () => {
    await syncAssets({ user: true });

    const skill = await fs.readFile(
      join(fakeHome, '.claude', 'skills', 'specpower-build', 'SKILL.md'),
      'utf-8',
    );
    const pkgForward = PACKAGE_ROOT.replace(/\\/g, '/');
    expect(skill).toContain(`${pkgForward}/prompts/build/phase-a-plan.md`);
    expect(skill).not.toContain('.claude/specpower/prompts/');
  });

  it.skipIf(!distReady)('works via the CLI binary with redirected HOME/USERPROFILE', async () => {
    syncUserInFakeHome(fakeHome);

    const skillDirs = (await fs.readdir(join(fakeHome, '.claude', 'skills'))).filter(
      (e) => e.startsWith('specpower-'),
    );
    expect(skillDirs).toHaveLength(10);
  });

  it('user scope does not distribute custom/ and cleanStale does not touch project custom/', async () => {
    const tmpProject = await fs.mkdtemp(join(tmpdir(), 'specpower-usercustom-'));
    try {
      // pre-create project specpower/custom/ (simulating prior project-scope sync)
      await fs.mkdir(join(tmpProject, 'specpower', 'custom', 'review'), { recursive: true });
      await fs.writeFile(join(tmpProject, 'specpower', 'custom', 'review', 'keep.md'), 'x', 'utf-8');

      const result = await syncAssets({ user: true, projectRoot: tmpProject });
      expect(result.refreshed).not.toContain('custom');
      // user scope did not create specpower/custom/ in project, nor delete the pre-existing one
      expect(await fs.readFile(join(tmpProject, 'specpower', 'custom', 'review', 'keep.md'), 'utf-8')).toBe('x');
    } finally {
      await fs.rm(tmpProject, { recursive: true, force: true });
    }
  });
});

describe('syncAssets in a git worktree', () => {
  let repoDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(join(tmpdir(), 'specpower-wt-repo-'));
    // bootstrap a throwaway git repo with a committed specpower/config.yaml
    git(['init'], repoDir);
    git(['config', 'user.email', 'test@example.com'], repoDir);
    git(['config', 'user.name', 'Specpower Test'], repoDir);
    await fs.mkdir(join(repoDir, 'specpower'), { recursive: true });
    await fs.writeFile(
      join(repoDir, 'specpower', 'config.yaml'),
      'version: 0.0.1\n# Project context\n',
      'utf-8',
    );
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'init'], repoDir);
    // carve out a linked worktree off the main repo
    worktreeDir = join(repoDir, 'wt');
    git(['worktree', 'add', worktreeDir], repoDir);
  });

  afterEach(async () => {
    // drop the worktree first so the repo dir is removable on Windows
    try {
      git(['worktree', 'remove', '--force', worktreeDir], repoDir);
    } catch {
      // ignore — worktree may already be gone
    }
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('isInsideWorktree returns true for a path inside a linked worktree', () => {
    expect(isInsideWorktree(worktreeDir)).toBe(true);
  });

  it('isInsideWorktree returns false for a plain non-repo directory', async () => {
    const plain = await fs.mkdtemp(join(tmpdir(), 'specpower-nowt-'));
    try {
      expect(isInsideWorktree(plain)).toBe(false);
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  it('does NOT stamp config.yaml version when syncing inside a worktree', async () => {
    // syncAssets runs copyCustom + bake; if it also stamped, the committed
    // config.yaml would gain a modified `version:` line.
    await syncAssets({ projectRoot: worktreeDir });

    const cfg = await fs.readFile(
      join(worktreeDir, 'specpower', 'config.yaml'),
      'utf-8',
    );
    expect(cfg).toMatch(/^version: 0\.0\.1$/m);

    // `git diff --exit-code` = 0 means no tracked changes to config.yaml
    const r = spawnSync(
      'git',
      ['-C', worktreeDir, 'diff', '--exit-code', '--', 'specpower/config.yaml'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(r.status).toBe(0);
  });
});

describe('syncAssets per tool (SPECPOWER_TOOL, project scope)', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-sync-tool-'));
    savedEnv = process.env.SPECPOWER_TOOL;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.SPECPOWER_TOOL;
    else process.env.SPECPOWER_TOOL = savedEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('opencode: syncs to .opencode/agent (flat), prunes stale flat agent file', async () => {
    process.env.SPECPOWER_TOOL = 'opencode';
    // seed a stale flat agent file from an older version
    await fs.mkdir(join(tmpDir, '.opencode', 'agent'), { recursive: true });
    await fs.writeFile(
      join(tmpDir, '.opencode', 'agent', 'specpower-deprecated.md'),
      'stale',
      'utf-8',
    );

    const res = await syncAssets({ projectRoot: tmpDir });
    expect(res.tool).toBe('opencode');
    expect(res.target).toContain('.opencode');

    await expect(
      fs.stat(join(tmpDir, '.opencode', 'agent', 'specpower-plan.md')),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(join(tmpDir, '.opencode', 'command', 'plan.md')),
    ).resolves.toBeDefined();
    // prompts copied under .opencode/specpower
    await expect(
      fs.stat(join(tmpDir, '.opencode', 'specpower', 'prompts')),
    ).resolves.toBeDefined();
    // stale flat agent pruned
    await expect(
      fs.stat(join(tmpDir, '.opencode', 'agent', 'specpower-deprecated.md')),
    ).rejects.toThrow();
    expect(res.removed).toContain('agent/specpower-deprecated.md');
    // no .claude
    await expect(fs.stat(join(tmpDir, '.claude'))).rejects.toThrow();
  });

  it('cac: syncs to .cac/skills/<dir>/SKILL.md', async () => {
    process.env.SPECPOWER_TOOL = 'cac';
    const res = await syncAssets({ projectRoot: tmpDir });
    expect(res.tool).toBe('cac');
    const skill = await fs.readFile(
      join(tmpDir, '.cac', 'skills', 'specpower-plan', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('.cac/specpower/prompts/');
  });

  it('chrys: syncs to .agents/skills/<dir>/SKILL.md', async () => {
    process.env.SPECPOWER_TOOL = 'chrys';
    const res = await syncAssets({ projectRoot: tmpDir });
    expect(res.tool).toBe('chrys');
    const skill = await fs.readFile(
      join(tmpDir, '.agents', 'skills', 'specpower-plan', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('.agents/specpower/prompts/');
  });
});

// Regression for cac/chrys root-dir correctness. Before the fix, sync copied
// prompt files verbatim (so cross-prompt `.claude/specpower/prompts/...` refs
// survived into `.cac/` projects) AND `bakePrompts` looked for prompt copies
// only under the hardcoded `.claude/` root (so cac/chrys projects shipped
// un-baked `[CONTROLLER:` placeholders). These exercise the full pipeline.
describe('syncAssets per tool — prompt transform + custom bake', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-sync-refs-'));
    savedEnv = process.env.SPECPOWER_TOOL;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.SPECPOWER_TOOL;
    else process.env.SPECPOWER_TOOL = savedEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('cac: copied prompts reference .cac/ (no stray .claude/) and bake [CONTROLLER: placeholders', async () => {
    process.env.SPECPOWER_TOOL = 'cac';
    await syncAssets({ projectRoot: tmpDir });

    // cross-prompt refs in phase-b-execute rewritten to the cac root
    const exec = await fs.readFile(
      join(tmpDir, '.cac', 'specpower', 'prompts', 'build', 'phase-b-execute.md'),
      'utf-8',
    );
    expect(exec).not.toContain('.claude/');
    expect(exec).toContain('.cac/specpower/prompts/shared/implementer-prompt.md');

    // schemas/templates refs in phase-b-worktree rewritten (not just /prompts/)
    const wt = await fs.readFile(
      join(tmpDir, '.cac', 'specpower', 'prompts', 'build', 'phase-b-worktree.md'),
      'utf-8',
    );
    expect(wt).not.toContain('.claude/');
    expect(wt).toContain('.cac/specpower/schemas/');
    expect(wt).toContain('.cac/specpower/templates/');

    // specpower's own archived design doc (bare .claude/ tree nodes) rewritten
    const design = await fs.readFile(
      join(tmpDir, '.cac', 'specpower', 'prompts', 'reference', 'specpower', 'example-design.md'),
      'utf-8',
    );
    expect(design).not.toContain('.claude/');

    // the 4 custom-rule placeholder prompts are baked under .cac/ (no [CONTROLLER: left)
    const impl = await fs.readFile(
      join(tmpDir, '.cac', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      'utf-8',
    );
    expect(impl).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]\n]*\][ \t]*$/m);
    // package ships custom/coding/coding-standards.md, so it must be baked in
    expect(impl).toContain('Coding Standards');
  });

  it('cac: vendored reference/superpowers/ docs are NOT rewritten (third-party Claude Code conventions)', async () => {
    process.env.SPECPOWER_TOOL = 'cac';
    await syncAssets({ projectRoot: tmpDir });

    const ws = await fs.readFile(
      join(tmpDir, '.cac', 'specpower', 'prompts', 'reference', 'superpowers', 'writing-skills.md'),
      'utf-8',
    );
    // `~/.claude/skills` describes Claude Code the product — must stay literal.
    expect(ws).toContain('~/.claude/skills');
    expect(ws).not.toContain('~/.cac/skills');
  });

  it('chrys: copied prompts reference .agents/ and bake placeholders', async () => {
    process.env.SPECPOWER_TOOL = 'chrys';
    await syncAssets({ projectRoot: tmpDir });

    const exec = await fs.readFile(
      join(tmpDir, '.agents', 'specpower', 'prompts', 'build', 'phase-b-execute.md'),
      'utf-8',
    );
    expect(exec).not.toContain('.claude/');
    expect(exec).toContain('.agents/specpower/prompts/shared/implementer-prompt.md');

    const impl = await fs.readFile(
      join(tmpDir, '.agents', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
      'utf-8',
    );
    expect(impl).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]\n]*\][ \t]*$/m);
  });
});
