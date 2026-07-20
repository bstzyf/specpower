import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initProject,
  detectVersionDrift,
  readStoredVersion,
  stampVersionInConfig,
} from '../../src/cli/commands/init.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');

describe('initProject', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-init-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates specpower/, specpower/changes/, specpower/specs/ directories', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const specpowerStat = await fs.stat(join(tmpDir, 'specpower'));
    expect(specpowerStat.isDirectory()).toBe(true);

    const changesStat = await fs.stat(join(tmpDir, 'specpower', 'changes'));
    expect(changesStat.isDirectory()).toBe(true);

    const specsStat = await fs.stat(join(tmpDir, 'specpower', 'specs'));
    expect(specsStat.isDirectory()).toBe(true);
  });

  it('creates specpower/config.yaml with schema: specpower', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const configContent = await fs.readFile(
      join(tmpDir, 'specpower', 'config.yaml'),
      'utf-8',
    );
    expect(configContent).toContain('schema: specpower');
  });

  it('creates .claude/skills/specpower-*/SKILL.md with 10 skill directories', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const skillsDir = join(tmpDir, '.claude', 'skills');
    const entries = await fs.readdir(skillsDir);
    const skillDirs = entries.filter((e) => e.startsWith('specpower-'));
    expect(skillDirs).toHaveLength(10);

    const expectedSkills = [
      'specpower-scan',
      'specpower-plan',
      'specpower-refine',
      'specpower-build',
      'specpower-review',
      'specpower-test',
      'specpower-verify',
      'specpower-done',
      'specpower-fix',
      'specpower-snap',
    ];

    for (const skill of expectedSkills) {
      const skillMdPath = join(skillsDir, skill, 'SKILL.md');
      const stat = await fs.stat(skillMdPath);
      expect(stat.isFile()).toBe(true);
    }
  });

  it('creates .claude/commands/specpower/ with 10 command alias .md files', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const commandsDir = join(tmpDir, '.claude', 'commands', 'specpower');
    const entries = await fs.readdir(commandsDir);
    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    expect(mdFiles).toHaveLength(10);

    const expectedCommands = [
      'scan',
      'plan',
      'refine',
      'build',
      'review',
      'test',
      'verify',
      'done',
      'fix',
      'snap',
    ];

    for (const cmd of expectedCommands) {
      const cmdPath = join(commandsDir, `${cmd}.md`);
      const content = await fs.readFile(cmdPath, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain(`specpower:${cmd}`);
    }
  });

  it('copies prompts to .claude/specpower/prompts/ with build/, refine/, shared/ subdirs', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const promptsDir = join(tmpDir, '.claude', 'specpower', 'prompts');
    const entries = await fs.readdir(promptsDir);

    expect(entries).toContain('build');
    expect(entries).toContain('refine');
    expect(entries).toContain('shared');

    // Verify at least one file exists in each expected subdir
    const buildEntries = await fs.readdir(join(promptsDir, 'build'));
    expect(buildEntries.length).toBeGreaterThan(0);

    const refineEntries = await fs.readdir(join(promptsDir, 'refine'));
    expect(refineEntries.length).toBeGreaterThan(0);

    const sharedEntries = await fs.readdir(join(promptsDir, 'shared'));
    expect(sharedEntries.length).toBeGreaterThan(0);
  });

  it('copies schema to .claude/specpower/schemas/specpower/schema.yaml', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const schemaPath = join(
      tmpDir,
      '.claude',
      'specpower',
      'schemas',
      'specpower',
      'schema.yaml',
    );
    const stat = await fs.stat(schemaPath);
    expect(stat.isFile()).toBe(true);

    const content = await fs.readFile(schemaPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('copies templates to .claude/specpower/templates/ with 4 .md files', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const templatesDir = join(tmpDir, '.claude', 'specpower', 'templates');
    const entries = await fs.readdir(templatesDir);
    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    expect(mdFiles).toHaveLength(4);

    const expectedTemplates = ['proposal.md', 'spec.md', 'design.md', 'tasks.md'];
    for (const tmpl of expectedTemplates) {
      expect(mdFiles).toContain(tmpl);
    }
  });

  it('re-running init returns already_initialized and does NOT overwrite', async () => {
    const firstResult = await initProject(tmpDir, PACKAGE_ROOT);
    expect(firstResult.status).toBe('initialized');

    // Write a marker into config to verify no overwrite
    const configPath = join(tmpDir, 'specpower', 'config.yaml');
    await fs.writeFile(configPath, 'schema: specpower\nmarker: original\n', 'utf-8');

    // Inject a declining confirm so the drift offer never blocks on a TTY.
    const secondResult = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => false,
    });
    expect(secondResult.status).toBe('already_initialized');
    expect(secondResult.message).toContain('already initialized');

    // Verify config was NOT overwritten
    const configContent = await fs.readFile(configPath, 'utf-8');
    expect(configContent).toContain('marker: original');
  });
});

describe('initProject version stamping & drift handling', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-drift-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Run a fresh init so config.yaml + .claude/ exist, then return its path. */
  async function freshInit(): Promise<void> {
    await initProject(tmpDir, PACKAGE_ROOT);
  }

  /** Overwrite only the `version:` line of config.yaml. */
  async function setConfigVersion(version: string | null): Promise<void> {
    const configPath = join(tmpDir, 'specpower', 'config.yaml');
    let content = await fs.readFile(configPath, 'utf-8');
    // strip any existing version line
    content = content.replace(/^[ \t]*version:.*$\n?/m, '');
    if (version !== null) {
      content = `version: ${version}\n${content}`;
    }
    await fs.writeFile(configPath, content, 'utf-8');
  }

  it('stamps the installed package version into config.yaml on first init', async () => {
    await freshInit();
    const stored = readStoredVersion(tmpDir);
    // The repo's own package.json version (currently 0.2.3-0).
    const { readPackageVersion } = await import('../../src/cli/commands/init.js');
    expect(stored).toBe(readPackageVersion(PACKAGE_ROOT));

    const content = await fs.readFile(
      join(tmpDir, 'specpower', 'config.yaml'),
      'utf-8',
    );
    expect(content).toContain('schema: specpower');
    // comments preserved
    expect(content).toContain('# Project context');
  });

  it('detectVersionDrift: equal when recorded matches installed', async () => {
    await freshInit();
    const info = detectVersionDrift(tmpDir, PACKAGE_ROOT);
    expect(info.drift).toBe('equal');
    expect(info.stored).not.toBeNull();
  });

  it('detectVersionDrift: newer when installed is ahead of recorded', async () => {
    await freshInit();
    // pretend the project was init'd with an older version
    await setConfigVersion('0.0.1');
    const info = detectVersionDrift(tmpDir, PACKAGE_ROOT);
    expect(info.drift).toBe('newer');
  });

  it('detectVersionDrift: older when installed lags the recorded version', async () => {
    await freshInit();
    await setConfigVersion('999.0.0');
    const info = detectVersionDrift(tmpDir, PACKAGE_ROOT);
    expect(info.drift).toBe('older');
  });

  it('detectVersionDrift: unknown when no version is recorded', async () => {
    await freshInit();
    await setConfigVersion(null);
    const info = detectVersionDrift(tmpDir, PACKAGE_ROOT);
    expect(info.drift).toBe('unknown');
    expect(info.stored).toBeNull();
  });

  it('does NOT prompt when versions are equal (confirmSync untouched)', async () => {
    await freshInit();
    let called = false;
    const result = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => {
        called = true;
        return false;
      },
    });
    expect(called).toBe(false);
    expect(result.status).toBe('already_initialized');
    expect(result.drift?.drift).toBe('equal');
  });

  it('on newer + accepted confirm: syncs and stamps the config version forward', async () => {
    await freshInit();
    await setConfigVersion('0.0.1');

    const result = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => true,
    });

    expect(result.status).toBe('synced');
    expect(result.drift?.drift).toBe('newer');

    // sync refreshed skills + stamped config forward to the installed version
    const { readPackageVersion } = await import('../../src/cli/commands/init.js');
    expect(readStoredVersion(tmpDir)).toBe(readPackageVersion(PACKAGE_ROOT));
    await expect(
      fs.stat(join(tmpDir, '.claude', 'skills', 'specpower-plan', 'SKILL.md')),
    ).resolves.toBeDefined();

    // re-running init now sees equality → no offer, base message
    let called = false;
    const again = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => {
        called = true;
        return false;
      },
    });
    expect(called).toBe(false);
    expect(again.drift?.drift).toBe('equal');
  });

  it('on newer + declined confirm: stays already_initialized without syncing', async () => {
    await freshInit();
    await setConfigVersion('0.0.1');

    const before = await fs.stat(
      join(tmpDir, '.claude', 'skills', 'specpower-plan', 'SKILL.md'),
    );
    const result = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => false,
    });

    expect(result.status).toBe('already_initialized');
    expect(result.drift?.drift).toBe('newer');
    expect(result.message).toContain('sync');
    // config version NOT advanced (we declined)
    expect(readStoredVersion(tmpDir)).toBe('0.0.1');
    // skill file mtime unchanged (no sync ran)
    const after = await fs.stat(
      join(tmpDir, '.claude', 'skills', 'specpower-plan', 'SKILL.md'),
    );
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('on older installed: warns without offering to sync', async () => {
    await freshInit();
    await setConfigVersion('999.0.0');

    let called = false;
    const result = await initProject(tmpDir, PACKAGE_ROOT, {
      confirmSync: async () => {
        called = true;
        return true;
      },
    });

    expect(called).toBe(false); // older never offers sync
    expect(result.status).toBe('already_initialized');
    expect(result.drift?.drift).toBe('older');
    expect(result.message).toContain('OLDER');
    // config untouched
    expect(readStoredVersion(tmpDir)).toBe('999.0.0');
  });
});

describe('stampVersionInConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-stamp-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('inserts a version line after schema when none exists, preserving comments', async () => {
    await fs.mkdir(join(tmpDir, 'specpower'), { recursive: true });
    const configPath = join(tmpDir, 'specpower', 'config.yaml');
    await fs.writeFile(
      configPath,
      'schema: specpower\n\n# keep me\n# context: |\n',
      'utf-8',
    );

    await stampVersionInConfig(tmpDir, '0.2.3-0');

    const content = await fs.readFile(configPath, 'utf-8');
    const lines = content.split('\n');
    expect(lines[0]).toBe('schema: specpower');
    expect(lines[1]).toBe('version: 0.2.3-0');
    expect(content).toContain('# keep me');
  });

  it('replaces an existing version line in place', async () => {
    await fs.mkdir(join(tmpDir, 'specpower'), { recursive: true });
    const configPath = join(tmpDir, 'specpower', 'config.yaml');
    await fs.writeFile(
      configPath,
      'schema: specpower\nversion: 0.0.1\n# note\n',
      'utf-8',
    );

    await stampVersionInConfig(tmpDir, '0.2.3-0');

    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('version: 0.2.3-0');
    expect(content).not.toContain('version: 0.0.1');
    expect(content).toContain('# note');
  });

  it('is a no-op when there is no config.yaml', async () => {
    // user-level sync has no project config — stamp must not throw
    await expect(stampVersionInConfig(tmpDir, '0.2.3-0')).resolves.toBeUndefined();
  });
});
