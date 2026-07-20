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
