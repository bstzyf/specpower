import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveChangeCommand } from '../../src/cli/commands/change-archive.js';

/**
 * Creates a complete test project with:
 *   specpower/specs/auth.md (main spec)
 *   specpower/changes/my-change/specs/auth.md (valid delta spec)
 *   specpower/changes/my-change/.specpower.yaml
 *
 * @param phase - Phase to write into .specpower.yaml (default: "built")
 */
async function createCompleteProject(
  phase: string = 'built',
): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'change-archive-test-'));

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

  // Valid delta spec
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

  // Metadata
  await fs.writeFile(
    join(changeDir, '.specpower.yaml'),
    `schema: specpower\ncreated: "2026-04-25"\nphase: ${phase}\n`,
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

describe('archiveChangeCommand', () => {
  it('archives a completed change successfully', async () => {
    const root = await createCompleteProject();

    const result = await archiveChangeCommand('my-change', root);

    expect(result.success).toBe(true);

    // Delta merged into main spec
    const mainSpec = await fs.readFile(
      join(root, 'specpower', 'specs', 'auth.md'),
      'utf-8',
    );
    expect(mainSpec).toContain('Two Factor Auth');
    expect(mainSpec).toContain('User Login');

    // Change moved to archive
    const originalExists = await fs
      .stat(join(root, 'specpower', 'changes', 'my-change'))
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(false);

    const archiveDir = join(root, 'specpower', 'changes', 'archive');
    const entries = await fs.readdir(archiveDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^\d{4}-\d{2}-\d{2}-my-change$/);
  });

  it('throws on validation failure and does not move the change', async () => {
    const root = await createCompleteProject();

    // Overwrite delta with invalid content
    const changeSpecsDir = join(
      root,
      'specpower',
      'changes',
      'my-change',
      'specs',
    );
    await fs.writeFile(
      join(changeSpecsDir, 'auth.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Bad Feature',
        'Description.',
        '',
        '#### Scenario: No when clause',
        '- **THEN** something happens',
      ].join('\n'),
      'utf-8',
    );

    await expect(archiveChangeCommand('my-change', root)).rejects.toThrow();

    // Original directory should still exist
    const originalExists = await fs
      .stat(join(root, 'specpower', 'changes', 'my-change'))
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(true);
  });

  it('throws for non-existing change', async () => {
    const root = await createCompleteProject();

    await expect(
      archiveChangeCommand('non-existent', root),
    ).rejects.toThrow();
  });

  it('refuses to archive a change in phase=plan without --force', async () => {
    const root = await createCompleteProject('plan');

    await expect(
      archiveChangeCommand('my-change', root),
    ).rejects.toThrow(
      /Cannot archive: change 'my-change' is in phase 'plan', expected 'built'\. Complete '\/specpower:build' first, or pass '--force' to archive anyway\./,
    );
  });

  it('refuses to archive a change in phase=refined without --force', async () => {
    const root = await createCompleteProject('refined');

    await expect(
      archiveChangeCommand('my-change', root),
    ).rejects.toThrow(
      /Cannot archive: change 'my-change' is in phase 'refined', expected 'built'\. Complete '\/specpower:build' first, or pass '--force' to archive anyway\./,
    );
  });

  it('archives a change in phase=built without --force (default success path)', async () => {
    const root = await createCompleteProject('built');

    const result = await archiveChangeCommand('my-change', root);
    expect(result.success).toBe(true);
  });

  it('archives a change in phase=plan when --force is passed', async () => {
    const root = await createCompleteProject('plan');

    const result = await archiveChangeCommand('my-change', root, {
      force: true,
    });
    expect(result.success).toBe(true);
  });
});
