import { promises as fs } from 'node:fs';

export interface TestCase {
  readonly id: string;
  readonly capability: string;
  readonly requirement: string;
  readonly scenarioRef: string;
  readonly mark: 'positive' | 'negative';
  readonly input: string;
  readonly expected: string;
  readonly itName: string;
  readonly file?: string;
}

const CASE_LINE = /^-\s+\*\*Case\*\*\s+(?<id>T\d+):\s+(?<desc>.+?)\s+\[(?<mark>positive|negative)\]\s*$/;
const FIELD_LINE = /^\s+-\s+(?<k>Input|Expected|it\(\)|file):\s*(?<v>.+?)\s*$/;
const CAPABILITY = /^##\s+Capability:\s*(?<cap>.+?)\s*$/;
const REQ_SCEN = /^###\s+Requirement:\s*(?<req>.+?)\s+→\s+Scenario:\s*(?<scen>.+?)\s*$/;

export function parseTestPlan(content: string): TestCase[] {
  const lines = content.split(/\r?\n/);
  const cases: TestCase[] = [];
  let cap = '';
  let req = '';
  let scen = '';
  let cur: (TestCase & { _fields: Record<string, string> }) | null = null;

  const flush = () => {
    if (!cur) return;
    cases.push({
      id: cur.id, capability: cap, requirement: req, scenarioRef: scen,
      mark: cur.mark, input: cur._fields['Input'] ?? '',
      expected: cur._fields['Expected'] ?? '',
      itName: cur._fields['it()'] ?? '',
      file: cur._fields['file'],
    });
    cur = null;
  };

  for (const line of lines) {
    const cm = CAPABILITY.exec(line);
    if (cm) { flush(); cap = cm.groups!.cap; continue; }
    const rsm = REQ_SCEN.exec(line);
    if (rsm) { flush(); req = rsm.groups!.req; scen = rsm.groups!.scen; continue; }
    const cl = CASE_LINE.exec(line);
    if (cl) {
      flush();
      cur = {
        id: cl.groups!.id, capability: cap, requirement: req, scenarioRef: scen,
        mark: cl.groups!.mark as 'positive' | 'negative',
        input: '', expected: '', itName: '', _fields: {},
      };
      continue;
    }
    if (cur) {
      const fl = FIELD_LINE.exec(line);
      if (fl) cur._fields[fl.groups!.k] = fl.groups!.v;
    }
  }
  flush();
  return cases;
}

export async function parseTestPlanFile(path: string): Promise<TestCase[]> {
  const content = await fs.readFile(path, 'utf-8');
  return parseTestPlan(content);
}

/**
 * Matches a line that looks like a Case header (`- **Case** ...`) so we can
 * inspect the id portion without also matching the stricter `CASE_LINE`
 * (which requires `T<n>`).
 */
const CASE_PREFIX = /^-\s+\*\*Case\*\*\s+(?<rest>.+?)\s*$/;

/**
 * Scan test-plan content for Case lines whose id is missing or not of the
 * form `T<n>`. Such lines are silently skipped by `parseTestPlan` (the
 * `CASE_LINE` regex requires `T\d+`), so this function surfaces them so the
 * validator can reject them instead of dropping coverage.
 *
 * Returns 1-based line numbers and the raw line text for each malformed Case.
 */
export function findMalformedCases(
  content: string,
): { line: number; raw: string }[] {
  const lines = content.split(/\r?\n/);
  const out: { line: number; raw: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CASE_PREFIX.exec(lines[i]);
    if (!m) continue;
    // The id is the token up to the first ':' (or the whole rest if no colon).
    const rest = m.groups!.rest;
    const colonIdx = rest.indexOf(':');
    const idPart = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
    if (!/^T\d+$/.test(idPart.trim())) {
      out.push({ line: i + 1, raw: lines[i] });
    }
  }
  return out;
}
