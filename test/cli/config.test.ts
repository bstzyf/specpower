import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readUserConfig, writeUserConfig, userConfigPath } from '../../src/core/tools/adapters.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');
const DIST_ENTRY = join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
const distReady = existsSync(DIST_ENTRY);

/**
 * Runs the CLI `specpower config ...` in a child process whose HOME/USERPROFILE
 * point at a temp dir, so the real user config is never touched.
 */
function runConfig(args: string[], fakeHome: string): { code: number; out: string } {
  const bin = join(PACKAGE_ROOT, 'bin', 'specpower.js');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, SPECPOWER_TOOL: '' };
  const res = spawnSync(process.execPath, [bin, 'config', ...args], {
    env,
    encoding: 'utf-8',
  });
  return { code: res.status ?? -1, out: (res.stdout || '') + (res.stderr || '') };
}

describe('config command (unit, via adapters)', () => {
  let fakeHome: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-cfg-'));
    savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedHome;
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('persists tool via writeUserConfig and readUserConfig reads it back', async () => {
    expect((await readUserConfig()).tool).toBeUndefined();
    await writeUserConfig({ tool: 'opencode' });
    expect((await readUserConfig()).tool).toBe('opencode');
    expect(userConfigPath()).toBe(join(fakeHome, '.specpower', 'config.json'));
  });

  it('config file content is the expected shape', async () => {
    await writeUserConfig({ tool: 'cac' });
    const content = await fs.readFile(userConfigPath(), 'utf-8');
    expect(content).toContain('"tool": "cac"');
  });
});

describe.skipIf(!distReady)('config command (CLI binary)', () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-cfgcli-'));
  });

  afterEach(async () => {
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('config set tool opencode persists and echoes rootDir', async () => {
    const res = runConfig(['set', 'tool', 'opencode'], fakeHome);
    expect(res.code).toBe(0);
    expect(res.out).toContain('Set default tool to \'opencode\'');
    expect(res.out).toContain('.opencode');

    const cfg = JSON.parse(
      await fs.readFile(join(fakeHome, '.specpower', 'config.json'), 'utf-8'),
    );
    expect(cfg.tool).toBe('opencode');
  });

  it('config set rejects unknown tool (non-zero exit)', async () => {
    const res = runConfig(['set', 'tool', 'nope'], fakeHome);
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('Unknown tool');
    expect(existsSync(join(fakeHome, '.specpower', 'config.json'))).toBe(false);
  });

  it('config get tool prints claude by default', async () => {
    const res = runConfig(['get', 'tool'], fakeHome);
    expect(res.code).toBe(0);
    expect(res.out.trim()).toBe('claude');
  });

  it('config list shows all tools and marks the active one', async () => {
    // set to cac first
    runConfig(['set', 'tool', 'cac'], fakeHome);
    const res = runConfig(['list'], fakeHome);
    expect(res.code).toBe(0);
    expect(res.out).toContain('claude');
    expect(res.out).toContain('opencode');
    expect(res.out).toContain('cac');
    // the active one (cac) is marked with '*'
    expect(/\* cac/.test(res.out)).toBe(true);
  });
});

describe.skipIf(!distReady)('first-run hint on init (CLI binary)', () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-hintcli-'));
  });

  afterEach(async () => {
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  /** Run `specpower init` in a temp project with the given home + no tool configured. */
  function runInit(fakeHome: string, projectDir: string): { code: number; out: string } {
    const bin = join(PACKAGE_ROOT, 'bin', 'specpower.js');
    const env = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      SPECPOWER_TOOL: '',
    };
    const res = spawnSync(process.execPath, [bin, 'init'], {
      env,
      cwd: projectDir,
      encoding: 'utf-8',
    });
    return { code: res.status ?? -1, out: (res.stdout || '') + (res.stderr || '') };
  }

  it('prints the tool hint on the first init, then stays silent on the second', async () => {
    const project = await fs.mkdtemp(join(tmpdir(), 'specpower-hintproj-'));

    try {
      const first = runInit(fakeHome, project);
      expect(first.code).toBe(0);
      expect(first.out).toContain('默认目标工具为 claude');
      // marked hinted -> a second init does not nag
      const second = runInit(fakeHome, project);
      expect(second.code).toBe(0);
      expect(second.out).not.toContain('默认目标工具为 claude');

      const cfg = JSON.parse(
        await fs.readFile(join(fakeHome, '.specpower', 'config.json'), 'utf-8'),
      );
      expect(cfg.hinted).toBe(true);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });

  it('does not hint when SPECPOWER_TOOL is set', async () => {
    const project = await fs.mkdtemp(join(tmpdir(), 'specpower-hintproj2-'));
    try {
      const bin = join(PACKAGE_ROOT, 'bin', 'specpower.js');
      const env = {
        ...process.env,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        SPECPOWER_TOOL: 'opencode',
      };
      const res = spawnSync(process.execPath, [bin, 'init'], {
        env,
        cwd: project,
        encoding: 'utf-8',
      });
      const out = (res.stdout || '') + (res.stderr || '');
      expect(out).not.toContain('默认目标工具为 claude');
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});
