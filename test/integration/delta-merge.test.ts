/**
 * Integration test: Delta merge round-trip.
 *
 * Verifies that ADDED, MODIFIED, and REMOVED delta operations
 * produce the correct merged main spec after archiving.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveChangeCommand } from '../../src/cli/commands/change-archive.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a project with 3 requirements in the main spec:
 *   User Login, User Logout, Password Reset
 *
 * Then creates a change with deltas:
 *   ADDED: Email Export
 *   MODIFIED: User Login (add SSO scenario)
 *   REMOVED: Password Reset
 */
async function setupDeltaMergeProject(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'delta-merge-test-'));

  // Project structure
  const specsDir = join(root, 'specpower', 'specs');
  await fs.mkdir(specsDir, { recursive: true });

  // Main spec with 3 requirements
  await fs.writeFile(
    join(specsDir, 'auth.md'),
    [
      '### Requirement: User Login',
      'The system SHALL authenticate users via email and password.',
      '',
      '#### Scenario: Successful login',
      '- **WHEN** user submits valid credentials',
      '- **THEN** system returns authentication token',
      '',
      '### Requirement: User Logout',
      'The system SHALL invalidate the session on logout.',
      '',
      '#### Scenario: Successful logout',
      '- **WHEN** user clicks logout',
      '- **THEN** session is invalidated',
      '',
      '### Requirement: Password Reset',
      'The system SHALL allow password reset via email.',
      '',
      '#### Scenario: Reset email sent',
      '- **WHEN** user requests password reset',
      '- **THEN** system sends reset email',
    ].join('\n'),
    'utf-8',
  );

  // Change directory with delta spec
  const changeDir = join(root, 'specpower', 'changes', 'sso-migration');
  const changeSpecsDir = join(changeDir, 'specs');
  await fs.mkdir(changeSpecsDir, { recursive: true });

  // Metadata (phase=built so the phase gate permits archive)
  await fs.writeFile(
    join(changeDir, '.specpower.yaml'),
    'schema: specpower\ncreated: "2026-04-25"\nphase: built\n',
    'utf-8',
  );

  // test-plan.md (required by the test-plan gate for testable changes)
  await fs.writeFile(
    join(changeDir, 'test-plan.md'),
    [
      '## Capability: auth',
      '',
      '### Requirement: Email Export → Scenario: Successful export',
      '',
      '- **Case** T1: export [positive]',
      '  - Input: clickExport()',
      '  - Expected: email sent',
      '  - it(): export works',
    ].join('\n'),
    'utf-8',
  );

  // Delta spec: ADDED + MODIFIED + REMOVED
  await fs.writeFile(
    join(changeSpecsDir, 'auth.md'),
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Email Export',
      'The system SHALL allow data export via email.',
      '',
      '#### Scenario: Successful export',
      '- **WHEN** user clicks export',
      '- **THEN** system sends email with CSV',
      '',
      '## MODIFIED Requirements',
      '',
      '### Requirement: User Login',
      'The system SHALL authenticate users via email, password, OR SSO.',
      '',
      '#### Scenario: Successful login',
      '- **WHEN** user submits valid credentials',
      '- **THEN** system returns JWT token',
      '',
      '#### Scenario: SSO login',
      '- **WHEN** user authenticates via SSO provider',
      '- **THEN** system returns JWT token',
      '',
      '## REMOVED Requirements',
      '',
      '### Requirement: Password Reset',
      '**Reason**: Replaced by SSO-based recovery',
      '**Migration**: Use SSO provider password recovery',
    ].join('\n'),
    'utf-8',
  );

  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Delta merge round-trip', () => {
  it('merges ADDED, MODIFIED, and REMOVED operations correctly', async () => {
    const tmpDir = await setupDeltaMergeProject();

    // Archive the change (applies deltas and moves to archive)
    const result = await archiveChangeCommand('sso-migration', tmpDir);
    expect(result.success).toBe(true);

    // Read the updated main spec
    const mainSpec = await fs.readFile(
      join(tmpDir, 'specpower', 'specs', 'auth.md'),
      'utf-8',
    );

    // User Login should be MODIFIED (now includes SSO)
    expect(mainSpec).toContain('User Login');
    expect(mainSpec).toContain('SSO');
    expect(mainSpec).toContain('JWT token');

    // User Logout should be UNTOUCHED
    expect(mainSpec).toContain('User Logout');
    expect(mainSpec).toContain('session is invalidated');

    // Email Export should be ADDED
    expect(mainSpec).toContain('Email Export');
    expect(mainSpec).toContain('email with CSV');

    // Password Reset should be REMOVED
    expect(mainSpec).not.toContain('Password Reset');

    // Count requirement headers to verify exactly 3 remain
    const requirementHeaders = mainSpec.match(
      /^### Requirement:/gm,
    );
    expect(requirementHeaders).toHaveLength(3);

    // Verify archived change location
    const archiveDir = join(tmpDir, 'specpower', 'changes', 'archive');
    const archiveEntries = await fs.readdir(archiveDir);
    expect(archiveEntries.length).toBe(1);
    expect(archiveEntries[0]).toMatch(/^\d{4}-\d{2}-\d{2}-sso-migration$/);

    // Original change directory should be gone
    const originalExists = await fs
      .stat(join(tmpDir, 'specpower', 'changes', 'sso-migration'))
      .then(() => true)
      .catch(() => false);
    expect(originalExists).toBe(false);
  });
});
