/**
 * Validation types.
 *
 * Defines the result and error shapes returned by spec validation.
 */

export interface ValidationError {
  readonly message: string;
  readonly line?: number;
}

export interface ValidationWarning {
  readonly message: string;
  readonly line?: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

export type TestPlanIssueKind =
  | 'uncovered-scenario'
  | 'missing-negative'
  | 'orphan-case'
  | 'duplicate-id'
  | 'duplicate-it-name'
  | 'dangling-ref';

export interface TestPlanIssue {
  readonly kind: 'test-plan';
  readonly issue: TestPlanIssueKind;
  readonly message: string;
  readonly scenario?: string;
  readonly caseId?: string;
}
