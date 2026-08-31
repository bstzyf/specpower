import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  initProject,
  detectVersionDrift,
  readStoredVersion,
  stampVersionInConfig,
  generateCommandAlias,
  COMMAND_NAMES,
} from '../../src/cli/commands/init.js';
import { getToolAdapter } from '../../src/core/tools/adapters.js';
import type { TransformCtx } from '../../src/core/tools/types.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');

const projectCtx: TransformCtx = {
  scope: 'project',
  packageRoot: PACKAGE_ROOT,
};
const userCtx: TransformCtx = { scope: 'user', packageRoot: PACKAGE_ROOT };

// --- isolate the user-level specpower config (~/.specpower/config.json) ---
//
// `initProject` resolves the active tool via `resolveTool()`, which falls back to
// the persisted user config (`~/.specpower/config.json`) when no
// `SPECPOWER_TOOL` env override is set. Without isolation, a developer whose
// global config pins a non-claude tool (e.g. `tool: "chrys"`) makes every
// "default → .claude/ layout" assertion read `.agents/` instead and fail — a
// machine-specific failure that never surfaces on a clean machine or CI.
//
// Redirect the home directory to a fresh temp dir for the whole suite so
// `readUserConfig()` always sees no persisted tool → claude default. Restored
// in afterEach. (Windows resolves the home from USERPROFILE; POSIX from HOME.)
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  const isolatedHome = await fs.mkdtemp(join(tmpdir(), 'specpower-test-home-'));
  process.env.HOME = isolatedHome;
  process.env.USERPROFILE = isolatedHome;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
});

void homedir;

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
      // claude default → skill-tool mechanism: body names the skill (hyphen,
      // the canonical skill-dir name) and tells the model to call the Skill tool.
      expect(content).toContain(`specpower-${cmd}`);
      // The alias body MUST drive the model to actually load the skill and run
      // every stage — a bare "Invoke the specpower:X skill." sentence is too
      // weak and the model skips the Skill tool or skips stages.
      expect(content).toMatch(/Skill tool/i);
      expect(content).toMatch(/every stage/i);
      expect(content).toMatch(/do not skip/i);
      expect(content).toMatch(/ARGUMENTS/i);
    }
  });

  it('generateCommandAlias: skill-tool tools (claude/cac/chrys) name the skill + Skill tool + every stage, no path', () => {
    for (const id of ['claude', 'cac', 'chrys'] as const) {
      const tool = getToolAdapter(id);
      for (const cmd of COMMAND_NAMES) {
        const body = generateCommandAlias(cmd, 'desc', tool, projectCtx);

        // Frontmatter carries the description.
        expect(body.startsWith('---\n')).toBe(true);
        expect(body).toContain(`description: "desc"`);

        // Body names the target skill (hyphen = canonical skill-dir name) + Skill tool.
        expect(body).toContain(`specpower-${cmd}`);
        expect(body).toMatch(/Skill tool/i);

        // Body forbids skipping/abbreviating stages and forwards ARGUMENTS.
        expect(body).toMatch(/every stage/i);
        expect(body).toMatch(/do not skip/i);
        expect(body).toMatch(/ARGUMENTS/i);
        expect(body).toMatch(/do not act on it directly/i);

        // skill-tool body is path-free (scope-agnostic, no `~` expansion risk).
        expect(body).not.toMatch(/Read `/);
      }
    }
  });

  it('generateCommandAlias: opencode (read-file) points at the flat agent path, no Skill tool', () => {
    const tool = getToolAdapter('opencode');
    for (const cmd of COMMAND_NAMES) {
      // project scope → cwd-relative path
      const proj = generateCommandAlias(cmd, 'desc', tool, projectCtx);
      expect(proj).toContain(
        `Read \`.opencode/agent/specpower-${cmd}.md\``,
      );
      expect(proj).toMatch(/every stage/i);
      expect(proj).toMatch(/do not skip/i);
      expect(proj).toMatch(/ARGUMENTS/i);
      expect(proj).toMatch(/do not act on it directly/i);
      // opencode exposes no Skill tool — the body must not reference one.
      expect(proj).not.toMatch(/Skill tool/i);

      // user scope → ~/ prefix (user-scope skills live under the home dir)
      const usr = generateCommandAlias(cmd, 'desc', tool, userCtx);
      expect(usr).toContain(
        `Read \`~/.opencode/agent/specpower-${cmd}.md\``,
      );
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

  it('copies templates to .claude/specpower/templates/ with 5 .md files (incl. test-plan.md)', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const templatesDir = join(tmpDir, '.claude', 'specpower', 'templates');
    const entries = await fs.readdir(templatesDir);
    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    expect(mdFiles).toHaveLength(5);

    const expectedTemplates = ['proposal.md', 'spec.md', 'design.md', 'tasks.md', 'test-plan.md'];
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

  it('init copies package-root custom/ to <projectRoot>/specpower/custom/ and gitignores it', async () => {
    await initProject(tmpDir, PACKAGE_ROOT);

    const customDir = join(tmpDir, 'specpower', 'custom');
    expect((await fs.stat(join(customDir, 'README.md'))).isFile()).toBe(true);
    expect(
      (await fs.stat(join(customDir, 'coding', 'coding-standards.md'))).isFile(),
    ).toBe(true);
    expect(
      (await fs.stat(join(customDir, 'review', 'review-rules.md'))).isFile(),
    ).toBe(true);

    const gi = await fs.readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(gi).toContain('specpower/custom/');
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

describe('initProject per-tool output (SPECPOWER_TOOL)', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'specpower-tool-init-'));
    savedEnv = process.env.SPECPOWER_TOOL;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.SPECPOWER_TOOL;
    else process.env.SPECPOWER_TOOL = savedEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('opencode: emits .opencode/agent/*.md + .opencode/command/*.md + assets, no .claude/', async () => {
    process.env.SPECPOWER_TOOL = 'opencode';
    const res = await initProject(tmpDir, PACKAGE_ROOT);
    expect(res.message).toContain('tool: opencode');

    // flat agent file (not skills/<dir>/SKILL.md)
    const agentPath = join(tmpDir, '.opencode', 'agent', 'specpower-plan.md');
    const stat = await fs.stat(agentPath);
    expect(stat.isFile()).toBe(true);

    // command alias under command/ (not commands/specpower/)
    await expect(
      fs.stat(join(tmpDir, '.opencode', 'command', 'plan.md')),
    ).resolves.toBeDefined();

    // opencode command alias body uses the read-file mechanism: it tells the
    // model to Read the flat agent file (opencode exposes no Skill tool).
    const opencodeAlias = await fs.readFile(
      join(tmpDir, '.opencode', 'command', 'plan.md'),
      'utf-8',
    );
    expect(opencodeAlias).toContain(
      'Read `.opencode/agent/specpower-plan.md`',
    );
    expect(opencodeAlias).toMatch(/every stage/i);
    expect(opencodeAlias).not.toMatch(/Skill tool/i);

    // prompts/schemas/templates under .opencode/specpower/
    await expect(
      fs.stat(join(tmpDir, '.opencode', 'specpower', 'prompts')),
    ).resolves.toBeDefined();

    // agent frontmatter is opencode's
    const agent = await fs.readFile(agentPath, 'utf-8');
    expect(agent).toContain('mode: primary');
    expect(agent).toContain('tools:');
    // prompt ref rewritten to .opencode
    expect(agent).toContain('.opencode/specpower/prompts/');

    // no .claude was created
    await expect(fs.stat(join(tmpDir, '.claude'))).rejects.toThrow();

    // .gitignore block targets .opencode (not .claude)
    const gi = await fs.readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(gi).toContain('.opencode/specpower/prompts/');
    expect(gi).not.toContain('.claude/specpower/');
  });

  it('cac: emits .cac/skills/<dir>/SKILL.md with .cac/ prompt refs', async () => {
    process.env.SPECPOWER_TOOL = 'cac';
    await initProject(tmpDir, PACKAGE_ROOT);

    const skill = await fs.readFile(
      join(tmpDir, '.cac', 'skills', 'specpower-plan', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('.cac/specpower/prompts/');
    expect(skill).not.toContain('.claude/specpower/prompts/');
    await expect(
      fs.stat(join(tmpDir, '.cac', 'commands', 'specpower', 'plan.md')),
    ).resolves.toBeDefined();
  });

  it('chrys: emits .agents/skills/<dir>/SKILL.md with .agents/ prompt refs', async () => {
    process.env.SPECPOWER_TOOL = 'chrys';
    await initProject(tmpDir, PACKAGE_ROOT);

    const skill = await fs.readFile(
      join(tmpDir, '.agents', 'skills', 'specpower-plan', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('.agents/specpower/prompts/');
    expect(skill).not.toContain('.claude/specpower/prompts/');
    await expect(
      fs.stat(join(tmpDir, '.agents', 'commands', 'specpower', 'plan.md')),
    ).resolves.toBeDefined();
    // no .claude created
    await expect(fs.stat(join(tmpDir, '.claude'))).rejects.toThrow();
    // .gitignore targets .agents
    const gi = await fs.readFile(join(tmpDir, '.gitignore'), 'utf-8');
    expect(gi).toContain('.agents/specpower/prompts/');
  });

  it('default (no env): unchanged .claude/ layout', async () => {
    delete process.env.SPECPOWER_TOOL;
    await initProject(tmpDir, PACKAGE_ROOT);
    await expect(
      fs.stat(join(tmpDir, '.claude', 'skills', 'specpower-plan', 'SKILL.md')),
    ).resolves.toBeDefined();
    await expect(fs.stat(join(tmpDir, '.opencode'))).rejects.toThrow();
    await expect(fs.stat(join(tmpDir, '.cac'))).rejects.toThrow();
  });

});
