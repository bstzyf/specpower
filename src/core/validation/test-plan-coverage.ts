import type { TestCase } from '../parsers/test-plan-parser.js';
import type { TestPlanIssue, TestPlanIssueKind } from './types.js';

export interface CoverageInput {
  readonly deltaScenarios: ReadonlyArray<{ requirement: string; scenario: string }>;
  readonly cases: readonly TestCase[];
  readonly baselineScenarios?: ReadonlyArray<{ requirement: string; scenario: string }>;
  readonly failureAdmittingRequirements?: readonly string[];
}

export interface CoverageResult {
  readonly issues: readonly TestPlanIssue[];
}

export function checkCoverage(input: CoverageInput): CoverageResult {
  const issues: TestPlanIssue[] = [];
  const baseline = input.baselineScenarios ?? [];
  const admit = new Set(input.failureAdmittingRequirements ?? []);

  const allScenarioNames = new Set<string>();
  for (const s of input.deltaScenarios) allScenarioNames.add(s.scenario);
  for (const s of baseline) allScenarioNames.add(s.scenario);

  // orphan case: no scenario ref
  for (const c of input.cases) {
    if (!c.scenarioRef) {
      issues.push({ kind: 'test-plan', issue: 'orphan-case' as TestPlanIssueKind, message: `Case ${c.id} has no scenario reference`, caseId: c.id });
    }
  }

  // dangling ref
  for (const c of input.cases) {
    if (c.scenarioRef && !allScenarioNames.has(c.scenarioRef)) {
      issues.push({ kind: 'test-plan', issue: 'dangling-ref', message: `Case ${c.id} references non-existent scenario "${c.scenarioRef}"`, caseId: c.id, scenario: c.scenarioRef });
    }
  }

  // duplicate id
  const seenId = new Set<string>();
  for (const c of input.cases) {
    if (seenId.has(c.id)) {
      issues.push({ kind: 'test-plan', issue: 'duplicate-id', message: `Duplicate case id ${c.id}`, caseId: c.id });
    }
    seenId.add(c.id);
  }

  // duplicate it() name
  const seenIt = new Set<string>();
  for (const c of input.cases) {
    if (c.itName && seenIt.has(c.itName)) {
      issues.push({ kind: 'test-plan', issue: 'duplicate-it-name', message: `Duplicate it() name "${c.itName}"`, caseId: c.id });
    }
    seenIt.add(c.itName);
  }

  // uncovered delta scenario
  const coveredScenarios = new Set(input.cases.map((c) => c.scenarioRef));
  for (const s of input.deltaScenarios) {
    if (!coveredScenarios.has(s.scenario)) {
      issues.push({ kind: 'test-plan', issue: 'uncovered-scenario', message: `Scenario "${s.scenario}" has no case`, scenario: s.scenario });
    }
  }

  // missing negative per failure-admitting requirement
  const reqToNegCases: Record<string, number> = {};
  for (const c of input.cases) {
    if (c.mark === 'negative' && c.scenarioRef) {
      // map case→requirement via delta or baseline
      const ds = input.deltaScenarios.find((s) => s.scenario === c.scenarioRef);
      const bs = baseline.find((s) => s.scenario === c.scenarioRef);
      const req = (ds ?? bs)?.requirement;
      if (req) reqToNegCases[req] = (reqToNegCases[req] ?? 0) + 1;
    }
  }
  for (const req of admit) {
    if ((reqToNegCases[req] ?? 0) === 0) {
      issues.push({ kind: 'test-plan', issue: 'missing-negative', message: `Requirement "${req}" admits failure but has no negative case`, scenario: req });
    }
  }

  return { issues };
}
