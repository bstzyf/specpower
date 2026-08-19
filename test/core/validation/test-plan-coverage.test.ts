import { describe, it, expect } from 'vitest';
import { checkCoverage } from '../../../src/core/validation/test-plan-coverage.js';
import type { TestCase } from '../../../src/core/parsers/test-plan-parser.js';

const mk = (o: Partial<TestCase>): TestCase => ({
  id: o.id ?? 'T1', capability: 'c', requirement: 'r', scenarioRef: 's',
  mark: o.mark ?? 'positive', input: 'i', expected: 'e', itName: 'n', ...o,
});

describe('checkCoverage', () => {
  it('passes when every delta scenario has a case and negatives present [add-test-plan-artifact-T8]', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ scenarioRef: 's', mark: 'negative' })],
    });
    expect(r.issues).toEqual([]);
  });
  it('flags uncovered scenario [add-test-plan-artifact-T9]', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [],
    });
    expect(r.issues.some((i) => i.issue === 'uncovered-scenario')).toBe(true);
  });
  it('flags missing-negative for failure-admitting requirement [add-test-plan-artifact-T10]', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ scenarioRef: 's', mark: 'positive' })],
      failureAdmittingRequirements: ['r'],
    });
    expect(r.issues.some((i) => i.issue === 'missing-negative')).toBe(true);
  });
  it('flags duplicate id', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ id: 'T1', mark: 'negative' }), mk({ id: 'T1', scenarioRef: 's', mark: 'positive' })],
    });
    expect(r.issues.some((i) => i.issue === 'duplicate-id')).toBe(true);
  });
  it('flags dangling ref (scenario not in delta or baseline) [add-test-plan-artifact-T7]', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ scenarioRef: 'nope', mark: 'negative' })],
      baselineScenarios: [],
    });
    expect(r.issues.some((i) => i.issue === 'dangling-ref')).toBe(true);
  });
});
