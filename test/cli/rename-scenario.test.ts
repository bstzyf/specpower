import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import {
  renameScenario,
  listAffectedTestPlans,
  syncTestPlanRefs,
  registerRenameScenarioCommand,
  shouldPromptForConfirmation,
} from '../../src/cli/commands/rename-scenario.js';

describe('renameScenario', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'rs-'));
    const specDir = join(root, 'specpower', 'specs', 'cap');
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(join(specDir, 'spec.md'),
      `### Requirement: r\n...\n#### Scenario: old name\n- **WHEN** x\n- **THEN** y\n`, 'utf-8');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('renames a baseline scenario in the spec file', async () => {
    await renameScenario(root, 'cap', 'old name', 'new name');
    const after = await fs.readFile(join(root, 'specpower', 'specs', 'cap', 'spec.md'), 'utf-8');
    expect(after).toContain('#### Scenario: new name');
    expect(after).not.toContain('#### Scenario: old name');
  });

  // Shared fixture for sync + dry-run: a baseline spec scenario "old name" plus
  // an active and an archived test-plan referencing "old name".
  async function buildSyncFixture(r: string): Promise<{ active: string; archived: string }> {
    // baseline spec already created in beforeEach with `#### Scenario: old name`
    // active change test-plan
    const activeDir = join(r, 'specpower', 'changes', 'mychange');
    await fs.mkdir(activeDir, { recursive: true });
    const active = join(activeDir, 'test-plan.md');
    await fs.writeFile(active,
      `## Capability: cap\n\n### Requirement: r → Scenario: old name\n\n- **Case** T1: x [positive]\n  - Input: a\n  - Expected: b\n  - it(): n\n`, 'utf-8');
    // archived change test-plan
    const archDir = join(r, 'specpower', 'changes', 'archive', '2026-01-01-old2');
    await fs.mkdir(archDir, { recursive: true });
    const archived = join(archDir, 'test-plan.md');
    await fs.writeFile(archived,
      `## Capability: cap\n\n### Requirement: r → Scenario: old name\n\n- **Case** T1: y [negative]\n  - Input: a\n  - Expected: b\n  - it(): n2\n`, 'utf-8');
    return { active, archived };
  }

  it('syncs test-plan references across active + archived changes [add-test-plan-artifact-T12]', async () => {
    const { active, archived } = await buildSyncFixture(root);
    await renameScenario(root, 'cap', 'old name', 'new name');
    const synced = await syncTestPlanRefs(root, 'old name', 'new name');
    expect(synced).toBe(2);
    const activeAfter = await fs.readFile(active, 'utf-8');
    const archivedAfter = await fs.readFile(archived, 'utf-8');
    expect(activeAfter).toContain('→ Scenario: new name');
    expect(activeAfter).not.toContain('→ Scenario: old name');
    expect(archivedAfter).toContain('→ Scenario: new name');
    expect(archivedAfter).not.toContain('→ Scenario: old name');
  });

  it('--dry-run lists affected files without writing [add-test-plan-artifact-T13]', async () => {
    const { active, archived } = await buildSyncFixture(root);
    const affected = await listAffectedTestPlans(root, 'old name');
    expect(affected).toHaveLength(2);
    expect(affected).toContain(active);
    expect(affected).toContain(archived);
    // files unchanged
    const activeAfter = await fs.readFile(active, 'utf-8');
    const archivedAfter = await fs.readFile(archived, 'utf-8');
    expect(activeAfter).toContain('→ Scenario: old name');
    expect(archivedAfter).toContain('→ Scenario: old name');
  });

  it('syncs ALL refs when one test-plan references the same scenario twice', async () => {
    // A single test-plan with two Cases (under two different Requirements)
    // both referencing the same baseline scenario "old name". rename + sync
    // must update BOTH refs, not just the first.
    const activeDir = join(root, 'specpower', 'changes', 'multi');
    await fs.mkdir(activeDir, { recursive: true });
    const tp = join(activeDir, 'test-plan.md');
    await fs.writeFile(tp,
      [
        '## Capability: cap',
        '',
        '### Requirement: r1 → Scenario: old name',
        '',
        '- **Case** T1: a [positive]',
        '  - Input: a',
        '  - Expected: b',
        '  - it(): n1',
        '',
        '### Requirement: r2 → Scenario: old name',
        '',
        '- **Case** T2: c [positive]',
        '  - Input: c',
        '  - Expected: d',
        '  - it(): n2',
        '',
      ].join('\n'), 'utf-8');

    await renameScenario(root, 'cap', 'old name', 'new name');
    const synced = await syncTestPlanRefs(root, 'old name', 'new name');
    expect(synced).toBe(1);

    const after = await fs.readFile(tp, 'utf-8');
    const occurrences = (after.match(/→ Scenario: new name/g) ?? []).length;
    expect(occurrences).toBe(2);
    expect(after).not.toContain('→ Scenario: old name');
  });
});

describe('rename-scenario confirmation gate', () => {
  let root: string;
  let cwd: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'rs-gate-'));
    cwd = process.cwd();
    const specDir = join(root, 'specpower', 'specs', 'cap');
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(join(specDir, 'spec.md'),
      `### Requirement: r\n...\n#### Scenario: old name\n- **WHEN** x\n- **THEN** y\n`, 'utf-8');
  });
  afterEach(async () => {
    process.chdir(cwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('shouldPromptForConfirmation: true only for TTY without --yes', () => {
    expect(shouldPromptForConfirmation({ yes: false }, true)).toBe(true);
    expect(shouldPromptForConfirmation({ yes: true }, true)).toBe(false);
    expect(shouldPromptForConfirmation({ yes: false }, undefined)).toBe(false);
    expect(shouldPromptForConfirmation({ yes: true }, undefined)).toBe(false);
  });

  it('non-TTY does not block: executes without --yes (behavior unchanged)', async () => {
    process.chdir(root);
    const program = new Command();
    registerRenameScenarioCommand(program);
    await program.parseAsync(['rename-scenario', 'cap', 'old name', 'new name'], { from: 'user' });

    const after = await fs.readFile(join(root, 'specpower', 'specs', 'cap', 'spec.md'), 'utf-8');
    expect(after).toContain('#### Scenario: new name');
    expect(after).not.toContain('#### Scenario: old name');
  });

  it('--yes skips confirmation and executes (even if isTTY were true)', async () => {
    process.chdir(root);
    const program = new Command();
    registerRenameScenarioCommand(program);
    await program.parseAsync(['rename-scenario', 'cap', 'old name', 'new name', '--yes'], { from: 'user' });

    const after = await fs.readFile(join(root, 'specpower', 'specs', 'cap', 'spec.md'), 'utf-8');
    expect(after).toContain('#### Scenario: new name');
  });
});
