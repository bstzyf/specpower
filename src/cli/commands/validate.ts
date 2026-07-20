/**
 * CLI command: specpower validate <file>
 *
 * Validates a spec file for structural correctness.
 * With --strict, treats warnings (e.g., missing negative scenarios) as errors.
 */

import { promises as fs } from 'node:fs';
import type { Command } from 'commander';
import { validateSpec } from '../../core/validation/validator.js';
import type { ValidationResult } from '../../core/validation/types.js';

/**
 * Validates a spec file at the given path.
 *
 * Reads the file and runs the spec validator, returning structured results.
 *
 * @param filePath - Absolute path to the spec file
 * @returns Validation result with valid flag, errors, and warnings
 * @throws When the file cannot be read
 */
export async function validateSpecFile(filePath: string): Promise<ValidationResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  return validateSpec(content);
}

/**
 * Registers the `validate` command with Commander.
 */
export function registerValidateCommand(program: Command): void {
  program
    .command('validate <file>')
    .description('Validate a spec file for structural correctness')
    .option('--json', 'Output as JSON')
    .option('--strict', 'Treat warnings (e.g., missing negative scenarios) as errors')
    .action(async (file: string, opts: { json?: boolean; strict?: boolean }) => {
      const result = await validateSpecFile(file);

      // In strict mode, warnings become errors
      const strictErrors = opts.strict
        ? [...result.errors, ...result.warnings.map((w) => ({ message: w.message, line: w.line }))]
        : result.errors;
      const strictValid = opts.strict ? strictErrors.length === 0 : result.valid;

      const output: ValidationResult = {
        valid: strictValid,
        errors: strictErrors,
        warnings: opts.strict ? [] : result.warnings,
      };

      if (opts.json) {
        console.info(JSON.stringify(output, null, 2));
      } else if (output.valid && output.warnings.length === 0) {
        console.info('Valid: no errors or warnings found.');
      } else if (output.valid) {
        console.info('Valid: no errors found.');
        if (output.warnings.length > 0) {
          console.warn(`\n${output.warnings.length} warning(s):`);
          for (const w of output.warnings) {
            const lineInfo = w.line ? ` (line ${w.line})` : '';
            console.warn(`  ⚠ ${w.message}${lineInfo}`);
          }
        }
      } else {
        console.error(`Found ${output.errors.length} error(s):`);
        for (const err of output.errors) {
          const lineInfo = err.line ? ` (line ${err.line})` : '';
          console.error(`  - ${err.message}${lineInfo}`);
        }
        process.exitCode = 1;
      }
    });
}
