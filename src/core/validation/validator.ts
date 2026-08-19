/**
 * Spec validator.
 *
 * Validates delta-spec markdown content for structural correctness:
 * - ADDED/MODIFIED sections must have requirements with scenarios
 * - Scenarios must use #### heading (not ###)
 * - Scenarios must have WHEN and THEN clauses
 * - REMOVED sections must have a Reason
 * - RENAMED sections must have FROM and TO lines
 * - Warns if requirements lack negative/error-path scenarios
 */

import type { ValidationError, ValidationResult, ValidationWarning } from './types.js';
import {
  SECTION_HEADER,
  REQUIREMENT_HEADER,
  SCENARIO_HEADER_CORRECT,
  SCENARIO_HEADER_WRONG_LEVEL,
  WHEN_LINE,
  THEN_LINE,
  REASON_LINE,
  FROM_LINE,
  TO_LINE,
} from './constants.js';

/**
 * Keywords that suggest a scenario is a negative/error-path test case.
 * These are checked against scenario names (after "Scenario:").
 *
 * Only UNAMBIGUOUS abnormal-handling keywords are included. Ambiguous terms
 * like "empty", "null", "boundary", "limit", "overflow" are intentionally
 * EXCLUDED because they also appear in legitimate-input scenarios (e.g.,
 * "Empty array returns empty" is a positive test — empty is a valid input).
 * Whether such a scenario is positive or negative depends on the function's
 * contract, which the validator cannot determine syntactically.
 *
 * See prompts/reference/specpower/negative-testing-guide.md for the
 * context-dependent classification rules.
 */
const NEGATIVE_SCENARIO_KEYWORDS = [
  'error',
  'fail',
  'invalid',
  'missing',
  'reject',
  'refuse',
  'deny',
  'denied',
  'exceed',
  'timeout',
  'exhaust',
  'malform',
  'corrupt',
  'wrong',
  'incorrect',
  'unauthorized',
  'forbidden',
  'conflict',
  'duplicate',
  'nonexistent',
  'not found',
  'not exist',
  'does not exist',
  'cannot',
  "can't",
  'unavailable',
  'out of range',
  'before init',
  'after close',
  'wrong state',
  'wrong phase',
  'throws',
  'exception',
];

/**
 * Check if a scenario name suggests a negative/error-path test case.
 * Only unambiguous abnormal-handling keywords count; legitimate-boundary
 * scenarios (empty input, extreme values, large input) are NOT flagged
 * because they are typically positive tests.
 */
function isLikelyNegativeScenario(scenarioName: string): boolean {
  const lower = scenarioName.toLowerCase();
  return NEGATIVE_SCENARIO_KEYWORDS.some((kw) => lower.includes(kw));
}

interface SectionSpan {
  readonly kind: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  readonly startLine: number;
  readonly lines: readonly string[];
}

function splitIntoSections(allLines: readonly string[]): readonly SectionSpan[] {
  const sections: SectionSpan[] = [];
  let current: { kind: SectionSpan['kind']; startLine: number; lines: string[] } | null = null;

  for (let i = 0; i < allLines.length; i++) {
    const match = SECTION_HEADER.exec(allLines[i]);
    if (match) {
      if (current) {
        sections.push({ kind: current.kind, startLine: current.startLine, lines: current.lines });
      }
      current = {
        kind: match[1].toUpperCase() as SectionSpan['kind'],
        startLine: i,
        lines: [],
      };
      continue;
    }
    if (current) {
      current.lines.push(allLines[i]);
    }
  }

  if (current) {
    sections.push({ kind: current.kind, startLine: current.startLine, lines: current.lines });
  }

  return sections;
}

interface RequirementCoverage {
  readonly name: string;
  readonly line: number;
  readonly totalScenarios: number;
  readonly negativeScenarios: number;
}

function validateRequirementSection(
  section: SectionSpan,
  errors: ValidationError[],
  coverageTracker: RequirementCoverage[],
): void {
  const { lines, startLine } = section;

  // Check for scenarios at wrong heading level (### instead of ####)
  for (let i = 0; i < lines.length; i++) {
    if (SCENARIO_HEADER_WRONG_LEVEL.test(lines[i])) {
      errors.push({
        message: `Scenario has incorrect heading level (use #### not ###)`,
        line: startLine + 1 + i + 1,
      });
    }
  }

  // Check for orphan scenarios before any requirement header
  let foundFirstReq = false;
  for (let i = 0; i < lines.length; i++) {
    if (REQUIREMENT_HEADER.test(lines[i])) {
      foundFirstReq = true;
      break;
    }
    if (SCENARIO_HEADER_CORRECT.test(lines[i])) {
      errors.push({
        message: `Scenario found with missing requirement header`,
        line: startLine + 1 + i + 1,
      });
      break;
    }
  }

  // If section has no requirement headers at all but has content, skip req parsing
  const hasAnyRequirement = lines.some((l) => REQUIREMENT_HEADER.test(l));
  if (!hasAnyRequirement) {
    // If there are scenarios without a requirement, we already flagged it above
    return;
  }

  // Parse requirements and validate each has at least one scenario with WHEN/THEN
  let currentReqName: string | null = null;
  let currentReqLine = 0;
  let scenarioCount = 0;
  let negativeCount = 0;
  let scenariosForCurrent: { name: string; line: number; hasWhen: boolean; hasThen: boolean }[] = [];

  const flushReq = (): void => {
    if (currentReqName !== null) {
      if (scenarioCount === 0) {
        errors.push({
          message: `Requirement "${currentReqName}" has no scenarios`,
          line: currentReqLine,
        });
      }
      for (const sc of scenariosForCurrent) {
        if (!sc.hasWhen) {
          errors.push({
            message: `Scenario "${sc.name}" is missing WHEN clause`,
            line: sc.line,
          });
        }
        if (!sc.hasThen) {
          errors.push({
            message: `Scenario "${sc.name}" is missing THEN clause`,
            line: sc.line,
          });
        }
      }
      // Track coverage for negative-scenario warning
      coverageTracker.push({
        name: currentReqName,
        line: currentReqLine,
        totalScenarios: scenarioCount,
        negativeScenarios: negativeCount,
      });
    }
  };

  let currentScenario: { name: string; line: number; hasWhen: boolean; hasThen: boolean } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = startLine + 1 + i + 1;
    const line = lines[i];

    const reqMatch = REQUIREMENT_HEADER.exec(line);
    if (reqMatch) {
      // Flush previous scenario into list
      if (currentScenario) {
        scenariosForCurrent.push(currentScenario);
        currentScenario = null;
      }
      flushReq();
      currentReqName = reqMatch[1].trim();
      currentReqLine = lineNum;
      scenarioCount = 0;
      negativeCount = 0;
      scenariosForCurrent = [];
      continue;
    }

    const scMatch = SCENARIO_HEADER_CORRECT.exec(line);
    if (scMatch && currentReqName !== null) {
      if (currentScenario) {
        scenariosForCurrent.push(currentScenario);
      }
      scenarioCount++;
      const scenarioName = scMatch[1].trim();
      if (isLikelyNegativeScenario(scenarioName)) {
        negativeCount++;
      }
      currentScenario = { name: scenarioName, line: lineNum, hasWhen: false, hasThen: false };
      continue;
    }

    if (currentScenario !== null) {
      const hasWhen: boolean = currentScenario.hasWhen || WHEN_LINE.test(line);
      const hasThen: boolean = currentScenario.hasThen || THEN_LINE.test(line);
      if (hasWhen !== currentScenario.hasWhen || hasThen !== currentScenario.hasThen) {
        currentScenario = {
          name: currentScenario.name,
          line: currentScenario.line,
          hasWhen,
          hasThen,
        };
      }
    }
  }

  // Flush last scenario and requirement
  if (currentScenario) {
    scenariosForCurrent.push(currentScenario);
  }
  flushReq();
}

function validateRemovedSection(
  section: SectionSpan,
  errors: ValidationError[],
): void {
  const { lines, startLine } = section;

  let currentReqName: string | null = null;
  let currentReqLine = 0;
  let hasReason = false;

  const flushRemoved = (): void => {
    if (currentReqName !== null && !hasReason) {
      errors.push({
        message: `REMOVED requirement "${currentReqName}" is missing Reason`,
        line: currentReqLine,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = startLine + 1 + i + 1;
    const line = lines[i];

    const reqMatch = REQUIREMENT_HEADER.exec(line);
    if (reqMatch) {
      flushRemoved();
      currentReqName = reqMatch[1].trim();
      currentReqLine = lineNum;
      hasReason = false;
      continue;
    }

    if (REASON_LINE.test(line)) {
      hasReason = true;
    }
  }

  flushRemoved();
}

function validateRenamedSection(
  section: SectionSpan,
  errors: ValidationError[],
): void {
  const { lines, startLine } = section;

  let hasFrom = false;
  let hasTo = false;
  let fromLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FROM_LINE.test(line)) {
      // If we had a previous FROM without TO, report it
      if (hasFrom && !hasTo) {
        errors.push({
          message: `RENAMED entry is missing TO (has FROM but no TO)`,
          line: startLine + 1 + fromLine + 1,
        });
      }
      hasFrom = true;
      hasTo = false;
      fromLine = i;
    }

    if (TO_LINE.test(line)) {
      hasTo = true;
    }
  }

  // Check last pair
  if (hasFrom && !hasTo) {
    errors.push({
      message: `RENAMED entry is missing TO (has FROM but no TO)`,
      line: startLine + 1 + fromLine + 1,
    });
  }

  // If no FROM found at all
  if (!hasFrom) {
    const hasContent = lines.some((l) => l.trim().length > 0);
    if (hasContent) {
      errors.push({
        message: `RENAMED section is missing FROM/TO entries`,
        line: startLine + 1,
      });
    }
  }
}

/**
 * Validate a delta-spec markdown content string.
 *
 * Checks structural rules including:
 * - ADDED/MODIFIED requirements must have scenarios with WHEN/THEN
 * - Scenarios must use #### heading level
 * - REMOVED requirements must have a Reason
 * - RENAMED entries must have FROM and TO
 * - Warns if requirements lack negative/error-path scenarios
 *
 * @param content - The raw markdown content of a delta spec
 * @returns A ValidationResult with valid flag, errors, and warnings
 */
export function validateSpec(content: string): ValidationResult {
  const normalized = content.replace(/\r\n?/g, '\n');
  const allLines = normalized.split('\n');
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const coverageTracker: RequirementCoverage[] = [];

  const sections = splitIntoSections(allLines);

  for (const section of sections) {
    switch (section.kind) {
      case 'ADDED':
      case 'MODIFIED':
        validateRequirementSection(section, errors, coverageTracker);
        break;
      case 'REMOVED':
        validateRemovedSection(section, errors);
        break;
      case 'RENAMED':
        validateRenamedSection(section, errors);
        break;
    }
  }

  // Generate warnings for requirements lacking any negative/error-path scenario.
  // Note: we only warn when there are ZERO negative scenarios — we do NOT warn
  // on ratio, because whether a scenario is positive or negative depends on the
  // function's contract (legitimate boundary values are positive), which the
  // validator cannot determine syntactically. Ratio auditing is left to
  // code review / refine, guided by negative-testing-guide.md.
  for (const req of coverageTracker) {
    if (req.totalScenarios > 0 && req.negativeScenarios === 0) {
      warnings.push({
        message: `Requirement "${req.name}" has no error-path scenarios (rejects/throws/invalid/missing/etc.). Consider adding at least one scenario covering a contract-violating or abnormal input. See negative-testing-guide.md for the positive/negative distinction.`,
        line: req.line,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
