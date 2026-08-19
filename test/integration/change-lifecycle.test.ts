/**
 * Integration test: Full change lifecycle.
 *
 * Exercises the complete flow:
 *   createChange → write artifacts → getChangeStatus → archiveChangeCommand
 *
 * All operations run against a real temp directory using the actual
 * CLI command functions (no shell exec, no mocks).
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createChange } from '../../src/cli/commands/change-new.js';
import { getChangeStatus } from '../../src/cli/commands/change-status.js';
import { archiveChangeCommand } from '../../src/cli/commands/change-archive.js';
import { updatePhase } from '../../src/utils/change-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sets up a minimal project skeleton in a temp directory.
 *
 * Layout:
 *   <tmpDir>/
 *     specpower/
 *       config.yaml
 *       specs/
 *         auth.md              (main spec with 1 requirement)
 *     schemas/
 *       specpower/
 *         schema.yaml          (copied from package)
 */
async function setupProject(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'lifecycle-test-'));

  // config.yaml
  await fs.mkdir(join(root, 'specpower'), { recursive: true });
  await fs.writeFile(
    join(root, 'specpower', 'config.yaml'),
    'schema: specpower\n',
    'utf-8',
  );

  // Main spec
  const specsDir = join(root, 'specpower', 'specs');
  await fs.mkdir(specsDir, { recursive: true });
  await fs.writeFile(
    join(specsDir, 'auth.md'),
    [
      '### Requirement: User Login',
      'The system SHALL authenticate users via email and password.',
      '',
      '#### Scenario: Successful login',
      '- **WHEN** user submits valid credentials',
      '- **THEN** system returns authentication token',
    ].join('\n'),
    'utf-8',
  );

  // Copy the package schema so resolveSchema can find it
  const packageSchemaPath = join(
    import.meta.dirname,
    '..',
    '..',
    'schemas',
    'specpower',
    'schema.yaml',
  );
  const destSchemaDir = join(root, 'specpower', 'schemas', 'specpower');
  await fs.mkdir(destSchemaDir, { recursive: true });
  await fs.copyFile(packageSchemaPath, join(destSchemaDir, 'schema.yaml'));

  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full change lifecycle', () => {
  it('creates a change, writes artifacts, reports status, and archives', async () => {
    const tmpDir = await setupProject();

    // 1. Create change
    await createChange('test-feature', tmpDir);

    const changeDir = join(tmpDir, 'specpower', 'changes', 'test-feature');
    const changeDirStat = await fs.stat(changeDir);
    expect(changeDirStat.isDirectory()).toBe(true);

    // 2. Write proposal.md
    await fs.writeFile(
      join(changeDir, 'proposal.md'),
      '# Proposal\n\nAdd SSO support to authentication.\n',
      'utf-8',
    );

    const statusAfterProposal = await getChangeStatus('test-feature', tmpDir);
    const proposalEntry = statusAfterProposal.artifacts.find(
      (a) => a.id === 'proposal',
    );
    expect(proposalEntry?.status).toBe('done');

    // 3. Write delta spec, design.md, tasks.md
    const changeSpecsDir = join(changeDir, 'specs');
    await fs.mkdir(changeSpecsDir, { recursive: true });
    await fs.writeFile(
      join(changeSpecsDir, 'auth.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: SSO Login',
        'The system SHALL support SSO authentication.',
        '',
        '#### Scenario: SSO provider redirect',
        '- **WHEN** user selects SSO provider',
        '- **THEN** system redirects to provider login page',
      ].join('\n'),
      'utf-8',
    );

    await fs.writeFile(
      join(changeDir, 'design.md'),
      '# Design\n\nImplement SAML 2.0 integration.\n',
      'utf-8',
    );

    await fs.writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n- [ ] Implement SSO callback handler\n- [ ] Add provider configuration\n',
      'utf-8',
    );

    // test-plan.md (required by the test-plan gate for testable changes)
    await fs.writeFile(
      join(changeDir, 'test-plan.md'),
      [
        '## Capability: auth',
        '',
        '### Requirement: SSO Login → Scenario: SSO provider redirect',
        '',
        '- **Case** T1: redirect [positive]',
        '  - Input: selectSSO()',
        '  - Expected: redirect to provider',
        '  - it(): redirects',
      ].join('\n'),
      'utf-8',
    );

    const statusAfterAll = await getChangeStatus('test-feature', tmpDir);

    // The "scan" artifact generates "specpower/specs/**/*.md" relative to
    // the change dir, so it will never be "done" inside a change context.
    // All other artifacts (proposal, specs, design, tasks) should be done.
    const changeArtifacts = statusAfterAll.artifacts.filter(
      (a) => a.id !== 'scan',
    );
    for (const artifact of changeArtifacts) {
      expect(artifact.status).toBe('done');
    }

    // isComplete is false because the scan artifact is not completed in
    // a change context. Verify the 4 change-level artifacts are all done.
    expect(changeArtifacts.every((a) => a.status === 'done')).toBe(true);

    // 4. Transition to built, then archive (simulates real /specpower:build)
    await updatePhase('test-feature', 'built', tmpDir);
    const archiveResult = await archiveChangeCommand('test-feature', tmpDir);
    expect(archiveResult.success).toBe(true);

    // 5. Delta spec merged into main spec
    const mainSpec = await fs.readFile(
      join(tmpDir, 'specpower', 'specs', 'auth.md'),
      'utf-8',
    );
    expect(mainSpec).toContain('SSO Login');
    expect(mainSpec).toContain('User Login');

    // 6. Change moved to archive
    const archiveDir = join(tmpDir, 'specpower', 'changes', 'archive');
    const archiveEntries = await fs.readdir(archiveDir);
    expect(archiveEntries.length).toBe(1);
    expect(archiveEntries[0]).toMatch(/^\d{4}-\d{2}-\d{2}-test-feature$/);

    // Original change dir should no longer exist
    const originalExists = await fs
      .stat(changeDir)
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(false);
  });
});
