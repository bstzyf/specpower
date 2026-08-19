import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSpecFile } from '../../src/cli/commands/validate.js';

describe('validateSpecFile', () => {
  it('returns valid result for a correct spec file', async () => {
    const tmpDir = await fs.mkdtemp(join(tmpdir(), 'validate-test-'));
    const specPath = join(tmpDir, 'valid.md');

    await fs.writeFile(
      specPath,
      [
        '## ADDED Requirements',
        '',
        '### Requirement: User Login',
        'The system SHALL authenticate users.',
        '',
        '#### Scenario: Successful login',
        '- **WHEN** user submits credentials',
        '- **THEN** system returns token',
      ].join('\n'),
      'utf-8',
    );

    const result = await validateSpecFile(specPath);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns invalid result with errors for a broken spec file', async () => {
    const tmpDir = await fs.mkdtemp(join(tmpdir(), 'validate-test-'));
    const specPath = join(tmpDir, 'invalid.md');

    await fs.writeFile(
      specPath,
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Bad Feature',
        'Description.',
        '',
        '#### Scenario: Missing when',
        '- **THEN** something happens',
      ].join('\n'),
      'utf-8',
    );

    const result = await validateSpecFile(specPath);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message.includes('WHEN'))).toBe(true);
  });
});

describe('validate test-plan integration', () => {
  const withPlanSpec = join(
    import.meta.dirname,
    '..',
    'fixtures',
    'test-plan',
    'with-plan',
    'specs',
    'cap',
    'spec.md',
  );
  const withoutPlanSpec = join(
    import.meta.dirname,
    '..',
    'fixtures',
    'test-plan',
    'without-plan',
    'specs',
    'cap',
    'spec.md',
  );

  it('passes (valid) when a change has a covering test-plan.md [add-test-plan-artifact-T15]', async () => {
    const res = await validateSpecFile(withPlanSpec);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('warns (not errors) when a testable change lacks test-plan.md [add-test-plan-artifact-T1]', async () => {
    const res = await validateSpecFile(withoutPlanSpec);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /test-plan/i.test(w.message))).toBe(true);
  });

  it('promotes the missing test-plan warning to an error under --strict [add-test-plan-artifact-T17]', async () => {
    const res = await validateSpecFile(withoutPlanSpec, { strict: true });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /test-plan/i.test(e.message))).toBe(true);
  });

  it('does not flag baseline-regression refs as dangling when baseline specs exist [add-test-plan-artifact-T6]', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'validate-baseline-'));
    // baseline spec
    const baselineDir = join(root, 'specpower', 'specs');
    await fs.mkdir(baselineDir, { recursive: true });
    await fs.writeFile(
      join(baselineDir, 'cap.md'),
      [
        '### Requirement: Baseline Req',
        'System SHALL ...',
        '',
        '#### Scenario: existing baseline scenario',
        '- **WHEN** x',
        '- **THEN** y',
      ].join('\n'),
      'utf-8',
    );
    // change dir with delta spec + test-plan
    const changeDir = join(root, 'specpower', 'changes', 'c1');
    const deltaSpecsDir = join(changeDir, 'specs');
    await fs.mkdir(deltaSpecsDir, { recursive: true });
    await fs.writeFile(
      join(deltaSpecsDir, 'cap.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: New Req',
        'System SHALL new.',
        '',
        '#### Scenario: new scenario',
        '- **WHEN** a',
        '- **THEN** b',
      ].join('\n'),
      'utf-8',
    );
    await fs.writeFile(
      join(changeDir, '.specpower.yaml'),
      'schema: specpower\nphase: built\n',
      'utf-8',
    );
    await fs.writeFile(
      join(changeDir, 'test-plan.md'),
      [
        '## Capability: cap',
        '',
        '### Requirement: New Req → Scenario: new scenario',
        '',
        '- **Case** T1: covers new [positive]',
        '  - Input: do()',
        '  - Expected: ok',
        '  - it(): new case',
        '',
        '### Requirement: Baseline Req → Scenario: existing baseline scenario',
        '',
        '- **Case** T2: regression for baseline [positive]',
        '  - Input: do2()',
        '  - Expected: ok2',
        '  - it(): baseline regression',
      ].join('\n'),
      'utf-8',
    );

    const res = await validateSpecFile(join(deltaSpecsDir, 'cap.md'));
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports missing-negative when a failure-admitting requirement lacks a negative case', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'validate-neg-'));
    const changeDir = join(root, 'specpower', 'changes', 'c2');
    const deltaSpecsDir = join(changeDir, 'specs');
    await fs.mkdir(deltaSpecsDir, { recursive: true });
    await fs.writeFile(
      join(deltaSpecsDir, 'cap.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Neg Req',
        'System SHALL reject invalid input.',
        '',
        '#### Scenario: rejects invalid input',
        '- **WHEN** bad input',
        '- **THEN** system rejects',
      ].join('\n'),
      'utf-8',
    );
    await fs.writeFile(
      join(changeDir, '.specpower.yaml'),
      'schema: specpower\nphase: built\n',
      'utf-8',
    );
    // test-plan covers the scenario with a POSITIVE case only — no negative case
    await fs.writeFile(
      join(changeDir, 'test-plan.md'),
      [
        '## Capability: cap',
        '',
        '### Requirement: Neg Req → Scenario: rejects invalid input',
        '',
        '- **Case** T1: happy path [positive]',
        '  - Input: valid()',
        '  - Expected: ok',
        '  - it(): happy',
      ].join('\n'),
      'utf-8',
    );

    const res = await validateSpecFile(join(deltaSpecsDir, 'cap.md'));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /no negative case/i.test(e.message))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports malformed-id Case lines in test-plan.md instead of silently dropping them [add-test-plan-artifact-T16]', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'validate-malformed-'));
    const changeDir = join(root, 'specpower', 'changes', 'c3');
    const deltaSpecsDir = join(changeDir, 'specs');
    await fs.mkdir(deltaSpecsDir, { recursive: true });
    await fs.writeFile(
      join(deltaSpecsDir, 'cap.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Demo Req',
        'System SHALL do something.',
        '',
        '#### Scenario: happy path',
        '- **WHEN** good input',
        '- **THEN** system works',
      ].join('\n'),
      'utf-8',
    );
    await fs.writeFile(
      join(changeDir, '.specpower.yaml'),
      'schema: specpower\nphase: built\n',
      'utf-8',
    );
    // test-plan with a malformed-id Case (X1 instead of T1) — silently dropped
    // by the parser, but the validator must surface it.
    await fs.writeFile(
      join(changeDir, 'test-plan.md'),
      [
        '## Capability: cap',
        '',
        '### Requirement: Demo Req → Scenario: happy path',
        '',
        '- **Case** X1: bad id [positive]',
        '  - Input: do()',
        '  - Expected: ok',
        '  - it(): bad case',
      ].join('\n'),
      'utf-8',
    );

    const res = await validateSpecFile(join(deltaSpecsDir, 'cap.md'));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /malformed.*id/i.test(e.message))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
