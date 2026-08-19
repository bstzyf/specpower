/**
 * Integration test: test-plan lifecycle (end-to-end).
 *
 * Exercises the full plan→validate→rename-sync flow against a real temp
 * project:
 *   1. Build a change directory (delta spec + test-plan.md) and a baseline
 *      spec carrying the same Scenario name.
 *   2. parseTestPlan reads the drafted test-plan → Cases.
 *   3. checkCoverage confirms the drafted plan covers the delta (no issues).
 *   4. renameScenario renames the baseline Scenario + syncTestPlanRefs rewrites
 *      the test-plan's scenarioRef to match.
 *   5. parseTestPlan re-reads the test-plan → scenarioRef is the new name.
 *
 * No mocks: real filesystem, real parser/validator/rename functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTestPlan } from '../../src/core/parsers/test-plan-parser.js';
import { checkCoverage } from '../../src/core/validation/test-plan-coverage.js';
import {
  renameScenario,
  syncTestPlanRefs,
} from '../../src/cli/commands/rename-scenario.js';

describe('test-plan lifecycle (e2e)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'tp-e2e-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('plan-drafted test-plan passes coverage and rename syncs refs', async () => {
    // 1. Build a change directory: delta spec + test-plan.md, plus a baseline
    //    spec carrying the same Scenario name (target of rename-scenario).
    const changeSpecsDir = join(
      root,
      'specpower',
      'changes',
      'demo',
      'specs',
      'cap',
    );
    await fs.mkdir(changeSpecsDir, { recursive: true });
    await fs.writeFile(
      join(changeSpecsDir, 'spec.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: r',
        '',
        'The system SHALL reject unknown tool ids.',
        '',
        '#### Scenario: unknown tool id throws',
        '- **WHEN** caller passes a tool id the system does not know',
        '- **THEN** the system throws an UnknownTool error',
      ].join('\n'),
      'utf-8',
    );

    const changeDir = join(root, 'specpower', 'changes', 'demo');
    await fs.writeFile(
      join(changeDir, 'test-plan.md'),
      [
        '# test-plan: demo',
        '',
        '## Capability: cap',
        '',
        '### Requirement: r → Scenario: unknown tool id throws',
        '',
        '- **Case** T1: unknown tool id is rejected [negative]',
        '  - Input: resolveTool("nope")',
        '  - Expected: throw /Unknown tool "nope"/',
        '  - it(): throws on unknown tool id [demo-T1]',
      ].join('\n'),
      'utf-8',
    );

    // Baseline spec with the same Scenario name; rename-scenario will rewrite
    // this heading and sync the test-plan reference.
    const baselineSpecDir = join(root, 'specpower', 'specs', 'cap');
    await fs.mkdir(baselineSpecDir, { recursive: true });
    await fs.writeFile(
      join(baselineSpecDir, 'spec.md'),
      [
        '### Requirement: r',
        '',
        'Existing baseline behavior for tool resolution.',
        '',
        '#### Scenario: unknown tool id throws',
        '- **WHEN** caller passes a tool id the system does not know',
        '- **THEN** the system throws an UnknownTool error',
      ].join('\n'),
      'utf-8',
    );

    // 2. Read the drafted test-plan and parse its Cases.
    const testPlanPath = join(changeDir, 'test-plan.md');
    const drafted = await fs.readFile(testPlanPath, 'utf-8');
    const cases = parseTestPlan(drafted);
    expect(cases).toHaveLength(1);
    expect(cases[0].scenarioRef).toBe('unknown tool id throws');
    expect(cases[0].mark).toBe('negative');

    // 3. Coverage check: delta scenario is covered by the negative case.
    const coverage = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 'unknown tool id throws' }],
      cases,
      baselineScenarios: [],
    });
    expect(coverage.issues).toEqual([]);

    // 4. renameScenario renames the baseline Scenario heading; syncTestPlanRefs
    //    rewrites the test-plan's `→ Scenario:` reference to match (this is the
    //    exact sequence the `rename-scenario` CLI action performs).
    await renameScenario(root, 'cap', 'unknown tool id throws', 'renamed throws');
    const synced = await syncTestPlanRefs(
      root,
      'unknown tool id throws',
      'renamed throws',
    );
    expect(synced).toBe(1);

    // Baseline spec heading was rewritten.
    const baselineAfter = await fs.readFile(
      join(baselineSpecDir, 'spec.md'),
      'utf-8',
    );
    expect(baselineAfter).toContain('#### Scenario: renamed throws');
    expect(baselineAfter).not.toContain('#### Scenario: unknown tool id throws');

    // 5. Re-parse the test-plan → scenarioRef is the new name.
    const reparsed = parseTestPlan(await fs.readFile(testPlanPath, 'utf-8'));
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].scenarioRef).toBe('renamed throws');
  });
});
