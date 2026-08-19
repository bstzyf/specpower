import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveChange } from '../../src/core/archive.js';
import { parseTestPlan } from '../../src/core/parsers/test-plan-parser.js';

/**
 * Create a minimal project structure for archive tests.
 *
 * Layout:
 *   <tmpDir>/
 *     specpower/
 *       specs/
 *         auth.md           (main spec)
 *       changes/
 *         my-change/
 *           .specpower.yaml
 *           specs/
 *             auth.md       (delta spec)
 */
async function createTestProject(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'archive-test-'));

  const mainSpecDir = join(root, 'specpower', 'specs');
  const changeDir = join(root, 'specpower', 'changes', 'my-change');
  const changeSpecsDir = join(changeDir, 'specs');

  await fs.mkdir(mainSpecDir, { recursive: true });
  await fs.mkdir(changeSpecsDir, { recursive: true });

  // Main spec
  await fs.writeFile(
    join(mainSpecDir, 'auth.md'),
    [
      '### Requirement: User Login',
      'The system SHALL authenticate users.',
      '',
      '#### Scenario: Successful login',
      '- **WHEN** user submits credentials',
      '- **THEN** system returns token',
    ].join('\n'),
    'utf-8',
  );

  // Delta spec
  await fs.writeFile(
    join(changeSpecsDir, 'auth.md'),
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Two Factor Auth',
      'The system SHALL support 2FA.',
      '',
      '#### Scenario: Enable 2FA',
      '- **WHEN** user enables 2FA',
      '- **THEN** system requires OTP on next login',
    ].join('\n'),
    'utf-8',
  );

  // .specpower.yaml
  await fs.writeFile(
    join(changeDir, '.specpower.yaml'),
    'schema: specpower\ncreated: "2026-04-25"\nphase: built\n',
    'utf-8',
  );

  // test-plan.md covering the delta scenario (required by the test-plan gate)
  await fs.writeFile(
    join(changeDir, 'test-plan.md'),
    [
      '# test-plan: my-change',
      '',
      '## Capability: auth',
      '',
      '### Requirement: Two Factor Auth → Scenario: Enable 2FA',
      '',
      '- **Case** T1: user enables 2FA [positive]',
      '  - Input: enable2FA()',
      '  - Expected: requires OTP',
      '  - it(): enables [my-change-T1]',
    ].join('\n'),
    'utf-8',
  );

  return root;
}

describe('archiveChange', () => {
  it('validates delta specs before applying', async () => {
    const root = await createTestProject();

    // Write an invalid delta spec (missing WHEN)
    const changeSpecsDir = join(root, 'specpower', 'changes', 'my-change', 'specs');
    await fs.writeFile(
      join(changeSpecsDir, 'auth.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Bad Feature',
        'Description.',
        '',
        '#### Scenario: No when',
        '- **THEN** something happens',
      ].join('\n'),
      'utf-8',
    );

    const result = await archiveChange('my-change', root);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('WHEN'))).toBe(true);
  });

  it('applies deltas and updates the main spec', async () => {
    const root = await createTestProject();

    const result = await archiveChange('my-change', root);

    expect(result.success).toBe(true);

    const mainSpec = await fs.readFile(
      join(root, 'specpower', 'specs', 'auth.md'),
      'utf-8',
    );
    expect(mainSpec).toContain('Two Factor Auth');
    expect(mainSpec).toContain('User Login');
  });

  it('moves change dir to archive with date prefix', async () => {
    const root = await createTestProject();

    await archiveChange('my-change', root);

    // Original change directory should no longer exist
    const originalExists = await fs
      .stat(join(root, 'specpower', 'changes', 'my-change'))
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(false);

    // Archived directory should exist under archive/ with date prefix
    const archiveDir = join(root, 'specpower', 'changes', 'archive');
    const entries = await fs.readdir(archiveDir);
    expect(entries.length).toBe(1);
    // Format: YYYY-MM-DD-my-change
    expect(entries[0]).toMatch(/^\d{4}-\d{2}-\d{2}-my-change$/);
  });

  it('does not move directory when validation fails', async () => {
    const root = await createTestProject();

    // Write an invalid delta spec
    const changeSpecsDir = join(root, 'specpower', 'changes', 'my-change', 'specs');
    await fs.writeFile(
      join(changeSpecsDir, 'auth.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Broken',
        'No scenarios here.',
      ].join('\n'),
      'utf-8',
    );

    await archiveChange('my-change', root);

    // Original should still exist
    const originalExists = await fs
      .stat(join(root, 'specpower', 'changes', 'my-change'))
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(true);

    // Archive should NOT exist
    const archiveExists = await fs
      .stat(join(root, 'specpower', 'changes', 'archive'))
      .then(() => true)
      .catch(() => false);
    expect(archiveExists).toBe(false);
  });

  it('sets phase=archived in the archived change .specpower.yaml', async () => {
    const root = await createTestProject();

    const result = await archiveChange('my-change', root);
    expect(result.success).toBe(true);

    const archiveDir = join(root, 'specpower', 'changes', 'archive');
    const entries = await fs.readdir(archiveDir);
    expect(entries.length).toBe(1);

    const metaPath = join(archiveDir, entries[0], '.specpower.yaml');
    const content = await fs.readFile(metaPath, 'utf-8');
    expect(content).toContain('phase: archived');
  });

  it('blocks archive of a testable change (has scenario) lacking test-plan.md [add-test-plan-artifact-T14]', async () => {
    const root = await createTestProject();
    // remove the test-plan.md so the change is testable (has scenarios) but
    // lacks the required test-plan artifact
    await fs.rm(join(root, 'specpower', 'changes', 'my-change', 'test-plan.md'));

    const result = await archiveChange('my-change', root);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /test-plan\.md missing/i.test(e))).toBe(true);

    // original change dir still present (not moved)
    const stillExists = await fs
      .stat(join(root, 'specpower', 'changes', 'my-change'))
      .then(() => true)
      .catch(() => false);
    expect(stillExists).toBe(true);
  });

  it('--force archives a testable change even without test-plan.md', async () => {
    const root = await createTestProject();
    await fs.rm(join(root, 'specpower', 'changes', 'my-change', 'test-plan.md'));

    const result = await archiveChange('my-change', root, { force: true });
    expect(result.success).toBe(true);
  });

  it('moves test-plan.md into archive and does NOT merge it into baseline [add-test-plan-artifact-T11]', async () => {
    const root = await createTestProject();

    // Add a test-plan.md alongside the delta spec in the change directory.
    const changeDir = join(root, 'specpower', 'changes', 'my-change');
    const testPlanContent = [
      '# test-plan: my-change',
      '',
      '<!-- TP_UNMERGED_MARKER: this content must never reach baseline specs -->',
      '',
      '## Capability: auth',
      '',
      '### Requirement: Two Factor Auth → Scenario: Enable 2FA',
      '',
      '- **Case** T1: user enables 2FA [negative]',
      '  - Input: enable2FA()',
      '  - Expected: requires OTP',
      "  - it(): throws on unknown [my-change-T1]",
    ].join('\n');
    await fs.writeFile(join(changeDir, 'test-plan.md'), testPlanContent, 'utf-8');

    const result = await archiveChange('my-change', root);
    expect(result.success).toBe(true);

    // 1. test-plan.md moved to archive (rode along with the whole change dir).
    const archiveDir = join(root, 'specpower', 'changes', 'archive');
    const entries = await fs.readdir(archiveDir);
    expect(entries.length).toBe(1);
    const archivedTestPlan = join(archiveDir, entries[0], 'test-plan.md');
    const movedContent = await fs.readFile(archivedTestPlan, 'utf-8');
    expect(movedContent).toContain('TP_UNMERGED_MARKER');
    expect(movedContent).toContain('# test-plan: my-change');

    // 2. Baseline spec does NOT contain test-plan content (only the delta spec
    //    requirement block is merged; test-plan.md is never merged).
    const baselineSpec = await fs.readFile(
      join(root, 'specpower', 'specs', 'auth.md'),
      'utf-8',
    );
    expect(baselineSpec).toContain('Two Factor Auth'); // delta was merged
    expect(baselineSpec).not.toContain('TP_UNMERGED_MARKER');
    expect(baselineSpec).not.toContain('test-plan');
    expect(baselineSpec).not.toContain('[my-change-T1]');

    // 3. The archived test-plan must use the English field names the parser
    //    recognizes (Input/Expected) — Chinese 输入/预期 would be silently
    //    dropped, producing empty input/expected on the parsed Case.
    const parsed = parseTestPlan(movedContent);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].input).toBe('enable2FA()');
    expect(parsed[0].expected).toBe('requires OTP');
  });
});
