import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSpec } from '../../../src/core/validation/validator.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'fixtures');

async function loadFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, name), 'utf-8');
}

describe('validateSpec', () => {
  it('returns valid for a well-formed spec', async () => {
    const content = await loadFixture('valid-spec.md');
    const result = validateSpec(content);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error when requirement header is missing', () => {
    const content = [
      '## ADDED Requirements',
      '',
      'Some text without a requirement header.',
      '',
      '#### Scenario: Orphan scenario',
      '- **WHEN** something happens',
      '- **THEN** something results',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('missing requirement header'))).toBe(true);
  });

  it('reports error when scenario uses ### instead of ####', async () => {
    const content = await loadFixture('invalid-spec-wrong-heading.md');
    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('incorrect heading level'))).toBe(true);
  });

  it('reports error when requirement has zero scenarios', async () => {
    const content = await loadFixture('invalid-spec-no-scenario.md');
    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('has no scenarios'))).toBe(true);
  });

  it('reports error when scenario is missing WHEN', () => {
    const content = [
      '## ADDED Requirements',
      '',
      '### Requirement: No When',
      'Description.',
      '',
      '#### Scenario: Missing when clause',
      '- **THEN** something happens',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('missing WHEN'))).toBe(true);
  });

  it('reports error when scenario is missing THEN', () => {
    const content = [
      '## ADDED Requirements',
      '',
      '### Requirement: No Then',
      'Description.',
      '',
      '#### Scenario: Missing then clause',
      '- **WHEN** something happens',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('missing THEN'))).toBe(true);
  });

  it('reports error when REMOVED section is missing Reason', () => {
    const content = [
      '## REMOVED Requirements',
      '',
      '### Requirement: Gone Feature',
      '**Migration**: Use the new thing',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.toLowerCase().includes('reason'))).toBe(true);
  });

  it('reports error when RENAMED section is missing FROM/TO', () => {
    const content = [
      '## RENAMED Requirements',
      '',
      'FROM: Old Name',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) =>
      e.message.toLowerCase().includes('from') || e.message.toLowerCase().includes('to')
    )).toBe(true);
  });

  // Negative scenario coverage warnings

  it('warns when a requirement has no error-path scenarios', () => {
    const content = [
      '## ADDED Requirements',
      '',
      '### Requirement: User Creation',
      'The system SHALL create users.',
      '',
      '#### Scenario: Successful user creation',
      '- **WHEN** valid user data is provided',
      '- **THEN** user is created and returned',
      '',
      '#### Scenario: User with display name',
      '- **WHEN** user data includes a display name',
      '- **THEN** user is created with the display name',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) =>
      w.message.includes('no error-path scenarios') && w.message.includes('User Creation')
    )).toBe(true);
  });

  it('does not warn when a requirement has negative scenarios', () => {
    const content = [
      '## ADDED Requirements',
      '',
      '### Requirement: User Creation',
      'The system SHALL create users.',
      '',
      '#### Scenario: Successful user creation',
      '- **WHEN** valid user data is provided',
      '- **THEN** user is created and returned',
      '',
      '#### Scenario: Duplicate email rejected',
      '- **WHEN** an email that already exists is provided',
      '- **THEN** the system rejects the request with a conflict error',
    ].join('\n');

    const result = validateSpec(content);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('recognizes unambiguous negative keywords (reject/error/invalid/missing/throws)', () => {
    const negativeNames = [
      'Error on invalid input',
      'Fails when data is missing',
      'Rejects unauthorized access',
      'Timeout on slow response',
      'Invalid state before init',
      'Refuses duplicate entry',
      'Throws on null pointer',
    ];

    for (const name of negativeNames) {
      const content = [
        '## ADDED Requirements',
        '',
        '### Requirement: Feature',
        'Description.',
        '',
        `#### Scenario: ${name}`,
        '- **WHEN** condition',
        '- **THEN** outcome',
      ].join('\n');

      const result = validateSpec(content);
      // A scenario with an unambiguous negative keyword should NOT trigger the
      // "no error-path scenarios" warning.
      const negativeWarning = result.warnings.find((w) =>
        w.message.includes('no error-path scenarios'),
      );
      expect(negativeWarning).toBeUndefined();
    }
  });

  it('does NOT treat legitimate-boundary scenarios as negative (empty/extreme/large input)', () => {
    // These scenario names use ambiguous terms (empty, extreme, large) that
    // appear in POSITIVE boundary tests. The validator must NOT count them as
    // negative, so a requirement with only these should trigger the
    // "no error-path scenarios" warning.
    const positiveBoundaryNames = [
      'Empty array returns empty',
      'Sorts extreme numeric values',
      'Handles large sorted array without overflow',
      'Single-element array returns itself',
    ];

    for (const name of positiveBoundaryNames) {
      const content = [
        '## ADDED Requirements',
        '',
        '### Requirement: Feature',
        'Description.',
        '',
        `#### Scenario: ${name}`,
        '- **WHEN** condition',
        '- **THEN** outcome',
      ].join('\n');

      const result = validateSpec(content);
      const warning = result.warnings.find((w) =>
        w.message.includes('no error-path scenarios'),
      );
      expect(warning, `expected warning for legitimate-boundary scenario "${name}"`).toBeDefined();
    }
  });
});
