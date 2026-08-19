import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getToolAdapter,
  isToolId,
  resolveTool,
  readUserConfig,
  writeUserConfig,
  userConfigPath,
  allAdapters,
  TOOL_LISTINGS,
  shouldShowToolHint,
  markHinted,
  maybeToolHint,
} from '../../../src/core/tools/adapters.js';
import type { ToolId, SkillMeta, TransformCtx } from '../../../src/core/tools/types.js';

const PKG = '/X/specpower'; // synthetic package root; backslashes normalized away by adapters
const PLAN_SKILL = `---
name: specpower-plan
description: "First-iteration deep analysis"
---

Read the file at \`.claude/specpower/prompts/plan/proposal.md\` and follow it.
`;

const meta = (command: string): SkillMeta => ({
  name: `specpower-${command}`,
  description: 'First-iteration deep analysis',
  command,
});
const projectCtx = (packageRoot = PKG): TransformCtx => ({
  scope: 'project',
  packageRoot,
});
const userCtx = (packageRoot = PKG): TransformCtx => ({
  scope: 'user',
  packageRoot,
});

describe('adapter registry', () => {
  it('lists claude, opencode, cac, chrys and claude is the default', () => {
    const ids = allAdapters().map((a) => a.id);
    expect(ids).toEqual(['claude', 'opencode', 'cac', 'chrys']);
    expect(TOOL_LISTINGS.map((t) => t.id)).toEqual([
      'claude',
      'opencode',
      'cac',
      'chrys',
    ]);
    expect(isToolId('claude')).toBe(true);
    expect(isToolId('nope')).toBe(false);
  });

  it('getToolAdapter returns the right rootDir + layout', () => {
    expect(getToolAdapter('claude').rootDir).toBe('.claude');
    expect(getToolAdapter('cac').rootDir).toBe('.cac');
    expect(getToolAdapter('opencode').rootDir).toBe('.opencode');
    expect(getToolAdapter('chrys').rootDir).toBe('.agents');
    expect(getToolAdapter('opencode').skillLayout).toBe('flat');
    expect(getToolAdapter('claude').skillLayout).toBe('nested');
    expect(getToolAdapter('cac').skillLayout).toBe('nested');
    expect(getToolAdapter('chrys').skillLayout).toBe('nested');
  });

  it('skillDestRelPath matches each tool layout', () => {
    expect(getToolAdapter('claude').skillDestRelPath('specpower-plan')).toBe(
      'skills/specpower-plan/SKILL.md',
    );
    expect(getToolAdapter('cac').skillDestRelPath('specpower-plan')).toBe(
      'skills/specpower-plan/SKILL.md',
    );
    expect(getToolAdapter('opencode').skillDestRelPath('specpower-plan')).toBe(
      'agent/specpower-plan.md',
    );
    expect(getToolAdapter('chrys').skillDestRelPath('specpower-plan')).toBe(
      'skills/specpower-plan/SKILL.md',
    );
  });

  it('commandDestRelPath matches each tool layout', () => {
    expect(getToolAdapter('claude').commandDestRelPath('plan')).toBe(
      'commands/specpower/plan.md',
    );
    expect(getToolAdapter('opencode').commandDestRelPath('plan')).toBe('command/plan.md');
  });
});

describe('transformSkill', () => {
  it('claude project = passthrough (byte-identical to source)', () => {
    const out = getToolAdapter('claude').transformSkill(
      PLAN_SKILL,
      meta('plan'),
      projectCtx(),
    );
    expect(out).toBe(PLAN_SKILL);
  });

  it('cac project rewrites prompt root .claude/ -> .cac/', () => {
    const out = getToolAdapter('cac').transformSkill(
      PLAN_SKILL,
      meta('plan'),
      projectCtx(),
    );
    expect(out).toContain('.cac/specpower/prompts/plan/proposal.md');
    expect(out).not.toContain('.claude/specpower/prompts/');
    // frontmatter untouched for cac
    expect(out).toContain('name: specpower-plan');
  });

  it('chrys project rewrites prompt root .claude/ -> .agents/', () => {
    const out = getToolAdapter('chrys').transformSkill(
      PLAN_SKILL,
      meta('plan'),
      projectCtx(),
    );
    expect(out).toContain('.agents/specpower/prompts/plan/proposal.md');
    expect(out).not.toContain('.claude/specpower/prompts/');
    // passthrough frontmatter
    expect(out).toContain('name: specpower-plan');
  });

  it('opencode project synthesizes agent frontmatter + rewrites refs', () => {
    const out = getToolAdapter('opencode').transformSkill(
      PLAN_SKILL,
      meta('plan'),
      projectCtx(),
    );
    // new opencode frontmatter
    expect(out).toContain('mode: primary');
    expect(out).toContain('tools:');
    expect(out).toContain('  - read');
    // old name: line dropped
    expect(out).not.toContain('name: specpower-plan');
    // description carried over
    expect(out).toContain('description: "First-iteration deep analysis"');
    // prompt ref rewritten to .opencode
    expect(out).toContain('.opencode/specpower/prompts/plan/proposal.md');
    expect(out).not.toContain('.claude/specpower/prompts/');
  });

  it('all tools: user scope rewrites refs to the installed package (forward-slash)', () => {
    for (const id of ['claude', 'opencode', 'cac', 'chrys'] as const) {
      const out = getToolAdapter(id).transformSkill(
        PLAN_SKILL,
        meta('plan'),
        userCtx('C:\\pkg\\specpower'),
      );
      expect(out).toContain('C:/pkg/specpower/prompts/plan/proposal.md');
      expect(out).not.toContain('.claude/specpower/prompts/');
    }
  });

  it('opencode transform keeps skill body after frontmatter', () => {
    const out = getToolAdapter('opencode').transformSkill(
      PLAN_SKILL,
      meta('plan'),
      projectCtx(),
    );
    expect(out).toContain('Read the file at');
  });

  it('does NOT rewrite specpower/custom/ refs (custom is project-cwd-relative, tool-agnostic)', () => {
    // custom refs use project-cwd-relative `specpower/custom/` (no .claude/ prefix),
    // so rewritePromptRefs (which only matches .claude/specpower/prompts/) leaves them
    // alone across all adapters and scopes — the load-bearing D10 property.
    const SRC =
      'Read `specpower/custom/review/` and `specpower/custom/coding/`, plus `.claude/specpower/prompts/review/`';
    for (const id of ['claude', 'cac', 'chrys', 'opencode'] as const) {
      const projOut = getToolAdapter(id).transformSkill(SRC, meta('plan'), projectCtx());
      expect(projOut).toContain('specpower/custom/review/');
      expect(projOut).toContain('specpower/custom/coding/');
      const userOut = getToolAdapter(id).transformSkill(SRC, meta('plan'), userCtx());
      expect(userOut).toContain('specpower/custom/review/');
      expect(userOut).toContain('specpower/custom/coding/');
    }
  });
});

// Regression: cac/chrys root-dir correctness. The rewrite must cover EVERY
// specpower-owned `.claude/` path form shipped in skills + prompts — not just
// `.claude/specpower/prompts/`. Before this fix, schemas/templates refs,
// `.claude/skills/`, `.claude/commands/`, and bare `.claude/` were left as
// `.claude/` in cac/chrys output, so generated skills pointed at the wrong
// (non-existent) root and cross-prompt reads 404'd.
describe('transformSkill — full .claude/ root rewrite (cac/chrys/opencode)', () => {
  // A skill body exercising every shipped ref form: the specpower subtree
  // (prompts/schemas/templates), the sibling skills + commands dirs, and a
  // bare descriptive `.claude/` (as in the archived example-design tree).
  const FULL_SRC = [
    'Read `.claude/specpower/prompts/plan/proposal.md`.',
    'Load `.claude/specpower/schemas/change.yaml` and `.claude/specpower/templates/spec.md`.',
    'init sets up `.claude/skills/` and `.claude/commands/`.',
    'See the `.claude/` directory tree.',
  ].join('\n');

  it('claude project = byte-identical passthrough for ALL ref forms', () => {
    const out = getToolAdapter('claude').transformSkill(
      FULL_SRC,
      meta('plan'),
      projectCtx(),
    );
    expect(out).toBe(FULL_SRC);
  });

  it('cac project rewrites every .claude/ form -> .cac/ (zero .claude/ left)', () => {
    const out = getToolAdapter('cac').transformSkill(
      FULL_SRC,
      meta('plan'),
      projectCtx(),
    );
    expect(out).not.toContain('.claude/');
    expect(out).toContain('.cac/specpower/prompts/plan/proposal.md');
    expect(out).toContain('.cac/specpower/schemas/change.yaml');
    expect(out).toContain('.cac/specpower/templates/spec.md');
    expect(out).toContain('.cac/skills/');
    expect(out).toContain('.cac/commands/');
    expect(out).toContain('the `.cac/` directory');
  });

  it('chrys project rewrites every .claude/ form -> .agents/', () => {
    const out = getToolAdapter('chrys').transformSkill(
      FULL_SRC,
      meta('plan'),
      projectCtx(),
    );
    expect(out).not.toContain('.claude/');
    expect(out).toContain('.agents/specpower/prompts/plan/proposal.md');
    expect(out).toContain('.agents/specpower/schemas/change.yaml');
    expect(out).toContain('.agents/specpower/templates/spec.md');
    expect(out).toContain('.agents/skills/');
    expect(out).toContain('.agents/commands/');
  });

  it('opencode project maps .claude/skills -> .opencode/agent, commands -> .opencode/command', () => {
    const out = getToolAdapter('opencode').transformSkill(
      FULL_SRC,
      meta('plan'),
      projectCtx(),
    );
    // opencode is flat-layout: skills live under agent/, commands under command/
    expect(out).toContain('.opencode/agent/');
    expect(out).toContain('.opencode/command/');
    expect(out).not.toContain('.claude/skills/');
    expect(out).not.toContain('.claude/commands/');
    // specpower subtree is uniform (root differs only)
    expect(out).toContain('.opencode/specpower/prompts/plan/proposal.md');
    expect(out).toContain('.opencode/specpower/schemas/change.yaml');
  });

  it('user scope: specpower subtree -> package; skills/commands -> rootDir (nested)', () => {
    const out = getToolAdapter('cac').transformSkill(
      FULL_SRC,
      meta('plan'),
      userCtx('C:\\pkg\\specpower'),
    );
    expect(out).toContain('C:/pkg/specpower/prompts/plan/proposal.md');
    expect(out).toContain('C:/pkg/specpower/schemas/change.yaml');
    expect(out).toContain('C:/pkg/specpower/templates/spec.md');
    // skills + commands are written per-user under ~/.<rootDir>, so they stay
    // root-relative (NOT package-relative).
    expect(out).toContain('.cac/skills/');
    expect(out).toContain('.cac/commands/');
    expect(out).not.toContain('.claude/');
  });
});

describe('resolveTool', () => {
  let savedHome: string | undefined;
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-tool-'));
    savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedHome;
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('defaults to claude when nothing is configured', async () => {
    delete process.env.SPECPOWER_TOOL;
    const t = await resolveTool(undefined);
    expect(t.id).toBe('claude');
  });

  it('env override beats user config', async () => {
    await writeUserConfig({ tool: 'cac' });
    process.env.SPECPOWER_TOOL = 'opencode';
    const t = await resolveTool(process.env.SPECPOWER_TOOL);
    expect(t.id).toBe('opencode');
  });

  it('user config is used when no env override', async () => {
    delete process.env.SPECPOWER_TOOL;
    await writeUserConfig({ tool: 'cac' });
    const t = await resolveTool(undefined);
    expect(t.id).toBe('cac');
  });

  it('invalid env override throws', async () => {
    await expect(resolveTool('nope')).rejects.toThrow(/Unknown tool 'nope'/);
  });

  it('corrupted user config falls back to claude (never throws)', async () => {
    delete process.env.SPECPOWER_TOOL;
    const path = userConfigPath();
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, '{ not valid json', 'utf-8');
    const t = await resolveTool(undefined);
    expect(t.id).toBe('claude');
  });

  it('writeUserConfig + readUserConfig round-trip', async () => {
    await writeUserConfig({ tool: 'opencode' });
    expect((await readUserConfig()).tool).toBe('opencode');
    expect(userConfigPath()).toContain('.specpower');
  });
});

describe('first-run hint', () => {
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(join(tmpdir(), 'specpower-hint-'));
    savedHome = process.env.HOME;
    savedEnv = process.env.SPECPOWER_TOOL;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.SPECPOWER_TOOL;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedHome;
    if (savedEnv === undefined) delete process.env.SPECPOWER_TOOL;
    else process.env.SPECPOWER_TOOL = savedEnv;
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('shouldShowToolHint is true when nothing is configured', async () => {
    expect(await shouldShowToolHint()).toBe(true);
  });

  it('env override suppresses the hint', async () => {
    process.env.SPECPOWER_TOOL = 'opencode';
    expect(await shouldShowToolHint()).toBe(false);
  });

  it('a configured tool suppresses the hint', async () => {
    await writeUserConfig({ tool: 'cac' });
    expect(await shouldShowToolHint()).toBe(false);
  });

  it('markHinted suppresses the hint and preserves an existing tool', async () => {
    await writeUserConfig({ tool: 'opencode' });
    await markHinted();
    expect(await shouldShowToolHint()).toBe(false);
    expect((await readUserConfig()).tool).toBe('opencode');
    expect((await readUserConfig()).hinted).toBe(true);
  });

  it('maybeToolHint prints once then is silent on the next call', async () => {
    const before = (await readUserConfig()).hinted;
    expect(before).toBeUndefined();

    const out1: string[] = [];
    const origInfo = console.info;
    console.info = (s: string) => out1.push(s);
    try {
      await maybeToolHint();
      await maybeToolHint(); // second call should be a no-op
    } finally {
      console.info = origInfo;
    }
    expect(out1.join('').includes('默认目标工具为 claude')).toBe(true);
    expect(await shouldShowToolHint()).toBe(false);
    expect((await readUserConfig()).hinted).toBe(true);
  });
});
