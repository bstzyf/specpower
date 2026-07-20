import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { syncAssets } from '../../src/cli/commands/sync.js';
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
});
