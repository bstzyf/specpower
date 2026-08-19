/**
 * CLI command: specpower validate <file>
 *
 * Validates a spec file for structural correctness.
 * With --strict, treats warnings (e.g., missing negative scenarios) as errors.
 *
 * Test-plan coverage stage: if the spec belongs to a change directory (a
 * `.specpower.yaml` marker or a `changes/<name>/` ancestor is found), the
 * validator additionally checks the change's `test-plan.md`:
 * - present  → run checkCoverage and add its issues as errors
 * - absent   → warn (promoted to error under --strict) when the delta has scenarios
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Command } from 'commander';
import { validateSpec } from '../../core/validation/validator.js';
import {
  SCENARIO_HEADER_CORRECT,
  REQUIREMENT_HEADER,
} from '../../core/validation/constants.js';
import type { ValidationError, ValidationResult, ValidationWarning } from '../../core/validation/types.js';
import { parseTestPlanFile, findMalformedCases } from '../../core/parsers/test-plan-parser.js';
import { checkCoverage } from '../../core/validation/test-plan-coverage.js';

/**
 * Validates a spec file at the given path.
 *
 * Reads the file and runs the spec validator, then (if the file belongs to a
 * change directory) runs the test-plan coverage stage. Under `strict`, all
 * warnings are promoted to errors.
 *
 * @param filePath - Absolute path to the spec file
 * @param opts - Optional flags; `strict` promotes warnings to errors
 * @returns Validation result with valid flag, errors, and warnings
 * @throws When the file cannot be read
 */
export async function validateSpecFile(
  filePath: string,
  opts?: { strict?: boolean },
): Promise<ValidationResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const base = validateSpec(content);

  const tp = await checkTestPlan(filePath, content);

  const errors: ValidationError[] = [...base.errors, ...tp.errors];
  const warnings: ValidationWarning[] = [...base.warnings, ...tp.warnings];

  if (opts?.strict) {
    errors.push(...warnings.map((w) => ({ message: w.message, line: w.line })));
    warnings.length = 0;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Locate the change directory a spec file belongs to.
 *
 * Walks up from the spec file's directory; a directory is the change root if
 * it contains a `.specpower.yaml` marker, or its parent is named `changes`
 * (i.e. it sits at `changes/<name>/`). Returns the change root path, or
 * `null` if the spec does not belong to any change.
 */
function findChangeRoot(specPath: string): string | null {
  let dir = dirname(specPath);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, '.specpower.yaml'))) {
      return dir;
    }
    if (basename(dirname(dir)) === 'changes') {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Extract delta scenarios (requirement + scenario name pairs) from a spec
 * markdown string by scanning `### Requirement:` and `#### Scenario:` headers.
 */
function extractDeltaScenarios(content: string): { requirement: string; scenario: string }[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out: { requirement: string; scenario: string }[] = [];
  let currentReq = '';
  for (const line of lines) {
    const rm = REQUIREMENT_HEADER.exec(line);
    if (rm) {
      currentReq = rm[1].trim();
      continue;
    }
    const sm = SCENARIO_HEADER_CORRECT.exec(line);
    if (sm) {
      out.push({ requirement: currentReq, scenario: sm[1].trim() });
    }
  }
  return out;
}

/**
 * Run the test-plan coverage stage for a spec file.
 *
 * Returns errors (from checkCoverage when a test-plan.md exists, plus
 * malformed-id Case lines) and a warning when a testable change lacks a
 * test-plan.md. The warning is NOT promoted to an error here; `--strict`
 * promotion happens in `validateSpecFile` (the caller), which maps all
 * warnings to errors after this function returns.
 */
async function checkTestPlan(
  specPath: string,
  content: string,
): Promise<{ errors: ValidationError[]; warnings: ValidationWarning[] }> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const changeRoot = findChangeRoot(specPath);
  if (!changeRoot) return { errors, warnings };

  const deltaScenarios = extractDeltaScenarios(content);
  if (deltaScenarios.length === 0) return { errors, warnings };

  const changeName = basename(changeRoot);
  const testPlanPath = join(changeRoot, 'test-plan.md');

  if (!existsSync(testPlanPath)) {
    warnings.push({
      message: `test-plan.md missing for change ${changeName} (run plan Stage 5b; --strict to enforce)`,
    });
    return { errors, warnings };
  }

  const testPlanContent = await fs.readFile(testPlanPath, 'utf-8');
  for (const m of findMalformedCases(testPlanContent)) {
    errors.push({
      message: `Case line ${m.line} has malformed/missing id (expected T<n>): ${m.raw}`,
    });
  }

  const cases = await parseTestPlanFile(testPlanPath);
  const baselineScenarios = await loadBaselineScenarios(changeRoot);
  const failureAdmittingRequirements = collectFailureAdmittingRequirements(deltaScenarios);
  const result = checkCoverage({
    deltaScenarios,
    cases,
    baselineScenarios,
    failureAdmittingRequirements,
  });
  for (const issue of result.issues) {
    errors.push({ message: issue.message });
  }
  return { errors, warnings };
}

/**
 * Negative/error-path scenario keywords. A Requirement whose delta scenario
 * name contains any of these is treated as failure-admitting: its test-plan
 * must include at least one `[negative]` Case, or `missing-negative` is reported.
 * Mirrors the validator's NEGATIVE_SCENARIO_KEYWORDS set (inlined here because
 * that constant is not exported).
 */
const NEGATIVE_SCENARIO_KEYWORDS = [
  'throw', 'reject', 'invalid', 'missing', 'fail', 'error', 'deny',
  'forbidden', 'timeout', 'exhaust', 'malform', 'corrupt', 'wrong',
  'incorrect', 'duplicate', 'nonexistent',
];

/**
 * Heuristic: collect the set of Requirement names that own at least one delta
 * scenario whose name suggests a negative/error path (and thus the Requirement
 * admits failure). These are passed to checkCoverage so a missing-negative
 * error is raised when no `[negative]` Case covers the Requirement.
 */
function collectFailureAdmittingRequirements(
  deltaScenarios: readonly { requirement: string; scenario: string }[],
): string[] {
  const out = new Set<string>();
  for (const s of deltaScenarios) {
    if (isLikelyNegativeScenario(s.scenario)) {
      out.add(s.requirement);
    }
  }
  return [...out];
}

function isLikelyNegativeScenario(scenarioName: string): boolean {
  const lower = scenarioName.toLowerCase();
  return NEGATIVE_SCENARIO_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Walk up from a change root to locate the project's baseline specs directory
 * (`<projectRoot>/specpower/specs`). Returns null when no such directory exists
 * (e.g. the fixture-style layout without a `specpower/` wrapper), in which case
 * no baseline scenarios are loaded and baseline-regression refs would be
 * reported as dangling — but only for layouts that genuinely lack baseline specs.
 */
function findBaselineSpecsDir(changeRoot: string): string | null {
  let dir = changeRoot;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'specpower', 'specs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Load all baseline `{requirement, scenario}` pairs from the project's
 * `specpower/specs/` tree by scanning `### Requirement:` + `#### Scenario:`
 * headers in every `.md` file. Returns an empty array when the baseline specs
 * directory cannot be found.
 */
async function loadBaselineScenarios(
  changeRoot: string,
): Promise<{ requirement: string; scenario: string }[]> {
  const specsDir = findBaselineSpecsDir(changeRoot);
  if (!specsDir) return [];
  const files = await listMarkdownFiles(specsDir);
  const out: { requirement: string; scenario: string }[] = [];
  for (const rel of files) {
    const content = await fs.readFile(join(specsDir, rel), 'utf-8');
    out.push(...extractDeltaScenarios(content));
  }
  return out;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(full)).map((p) => join(entry.name, p)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(entry.name);
    }
  }
  return out;
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
      const result = await validateSpecFile(file, { strict: opts.strict });

      const output: ValidationResult = result;

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
