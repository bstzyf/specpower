# test-plan-artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use specpower:build Phase B (recommended) or specpower:build Phase B (inline mode) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-change `test-plan.md` artifact (NL test cases before code) + parser + validator coverage rules + lifecycle wiring + `rename-scenario` command.

**Architecture:** New `core/parsers/test-plan-parser.ts` extracts Cases (id/scenarioRef/mark/input/expected/itName/file?). `validator.ts` gains a coverage stage (every delta Scenario ≥1 Case; ≥1 negative per failure-admitting Requirement; orphan/duplicate/dangling rejected; missing-file warn, `--strict` error). `specs-apply.ts` adds test-plan to archive set (no merge). New `rename-scenario` command atomically renames a baseline Scenario + syncs all test-plan refs. Cases carry stable change-unique `id:` (`T<n>`); test code embeds a globally-unique token `[<changeName>-<id>]` (e.g. `[add-test-plan-artifact-T3]`); verify Step1 scans tokens, Step2 AST best-effort (v1 minimal-checkable).

**Tech Stack:** TypeScript/ESM, tsc, vitest, commander, zod, js-yaml. Project test script: `npm test` (`vitest run`).

**v1 decisions (Phase A commits):**
- Token grammar: `[<changeName>-<id>]`, id = `T<n>` (e.g. `[add-test-plan-artifact-T3]`). Token regex in code: `/\[(?<change>[A-Za-z0-9-]+)-T(?<n>\d+)\]/g`.
- `test-plan.md` format: `## Capability: <cap>` → `### Requirement: <req> → Scenario: <scen>` → `- **Case** <id>: <desc> <[positive]|[negative]>` with sub-bullets `Input:` / `Expected:` / `it():` / optional `file:`.
- `change new` creates NO test-plan placeholder (Stage 5 of plan creates it, like design/tasks). `fix` fast-track is exempt from test-plan (Q4 → exempt in v1).
- v2 AST Step2 frameworks deferred (Q3); v1 Step2 = best-effort warn.

---

## 1. Template & artifact format

### Task 1: test-plan.md scaffold template

**Files:**
- Create: `templates/test-plan.md`

- [ ] **Step 1: Write the template**

```markdown
# test-plan: <change-name>

<!-- Cases reference spec Scenario names (delta or baseline); do not copy WHEN/THEN.
     Each delta Scenario ≥1 Case; each failure-admitting Requirement ≥1 [negative].
     Case id is stable and change-unique; test code embeds token [<changeName>-<id>]. -->

## Capability: <capability>

### Requirement: <requirement name> → Scenario: <scenario name>

- **Case** T1: <one-line case description> [positive]
  - Input: <concrete input>
  - Expected: <expected result>
  - it(): <planned test name>
  - file: <optional: planned test-file path>

- **Case** T2: <one-line case description> [negative]
  - Input: <contract-violating input>
  - Expected: <error/rejection/degradation>
  - it(): <planned test name>
```

- [ ] **Step 2: Verify the file exists and is valid markdown**

Run: `test -f templates/test-plan.md && head -5 templates/test-plan.md`
Verify: exit 0, stdout contains `# test-plan:` and `## Capability:`

- [ ] **Step 3: Commit**

```bash
git add templates/test-plan.md
git commit -m "feat(test-plan): add templates/test-plan.md scaffold"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 2: Document the change artifact list

**Files:**
- Modify: `README.md` (add a test-plan row to the "initialization" checklist)

- [ ] **Step 1: Add a line to the README init checklist**

In the `### Initialization (once per project)` checklist, after the `tasks.md` line, add:

```markdown
- Generate `test-plan.md` (natural-language test cases, written before code; references spec scenarios, carries stable `[<changeName>-<id>]` tokens)
```

- [ ] **Step 2: Verify**

Run: `grep -n "test-plan.md" README.md`
Verify: exit 0, hits the init-checklist line

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document test-plan.md artifact in init checklist"
```
Verify: `git log -1 --oneline` shows the new commit

---

## 2. test-plan parser

### Task 3: Case type & parser skeleton

**Files:**
- Create: `src/core/parsers/test-plan-parser.ts`
- Test: `test/core/parsers/test-plan-parser.test.ts`

- [ ] **Step 1: Write a failing test (valid Case parsing)**

```typescript
import { describe, it, expect } from 'vitest';
import { parseTestPlan } from '../../../src/core/parsers/test-plan-parser.js';

const DOC = `# test-plan: demo

## Capability: tools

### Requirement: tool resolution → Scenario: unknown tool id throws

- **Case** T1: pass nope [negative]
  - Input: resolveTool('nope')
  - Expected: throw /Unknown tool 'nope'/
  - it(): throws on unknown tool id
  - file: src/core/tools/adapters.test.ts
`;

describe('parseTestPlan', () => {
  it('parses a well-formed case with all fields', () => {
    const cases = parseTestPlan(DOC);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toEqual({
      id: 'T1',
      capability: 'tools',
      requirement: 'tool resolution',
      scenarioRef: 'unknown tool id throws',
      mark: 'negative',
      input: "resolveTool('nope')",
      expected: "throw /Unknown tool 'nope'/",
      itName: 'throws on unknown tool id',
      file: 'src/core/tools/adapters.test.ts',
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/core/parsers/test-plan-parser.test.ts`
Verify: FAIL — `Cannot find module '../../../src/core/parsers/test-plan-parser.js'`

- [ ] **Step 3: Write the minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/core/parsers/test-plan-parser.test.ts`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/parsers/test-plan-parser.ts test/core/parsers/test-plan-parser.test.ts
git commit -m "feat(parser): add test-plan-parser extracting Cases"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 4: Parser edge cases

**Files:**
- Test: `test/core/parsers/test-plan-parser.test.ts` (append)

- [ ] **Step 1: Append edge-case tests (missing field/orphan/duplicate id)**

```typescript
const NO_ID = `## Capability: c

### Requirement: r → Scenario: s

- **Case** X1: no id prefix [positive]
  - Input: a
  - Expected: b
  - it(): n
`;

const DUP = `## Capability: c

### Requirement: r → Scenario: s

- **Case** T1: a [positive]
  - Input: a
  - Expected: b
  - it(): n

- **Case** T1: dup [positive]
  - Input: a
  - Expected: b
  - it(): n2
`;

describe('parseTestPlan edge', () => {
  it('skips lines that do not match the Case pattern', () => {
    expect(parseTestPlan(NO_ID)).toEqual([]);
  });
  it('parses duplicate ids as separate entries (dedup is validator concern)', () => {
    expect(parseTestPlan(DUP).map((c) => c.id)).toEqual(['T1', 'T1']);
  });
  it('parses multiple capabilities', () => {
    const two = `## Capability: a

### Requirement: r → Scenario: s
- **Case** T1: x [positive]
  - Input: a
  - Expected: b
  - it(): n

## Capability: b

### Requirement: r2 → Scenario: s2
- **Case** T2: y [positive]
  - Input: a
  - Expected: b
  - it(): n2
`;
    const cases = parseTestPlan(two);
    expect(cases.map((c) => `${c.capability}/${c.id}`)).toEqual(['a/T1', 'b/T2']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run test/core/parsers/test-plan-parser.test.ts`
Verify: PASS (3 edge cases)

- [ ] **Step 3: Commit**

```bash
git add test/core/parsers/test-plan-parser.test.ts
git commit -m "test(parser): cover edge cases (no-id, dup, multi-capability)"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 5: Change-prefixed token helpers

**Files:**
- Create: `src/core/parsers/test-plan-token.ts`
- Test: `test/core/parsers/test-plan-token.test.ts`

- [ ] **Step 1: Write a failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { caseToken, TOKEN_RE, findTokens } from '../../../src/core/parsers/test-plan-token.js';

describe('test-plan-token', () => {
  it('builds a change-prefixed token from change name + id', () => {
    expect(caseToken('add-test-plan-artifact', 'T3')).toBe('[add-test-plan-artifact-T3]');
  });
  it('TOKEN_RE matches and captures change + id', () => {
    const m = TOKEN_RE.exec('it("foo [add-test-plan-artifact-T3]", ...)');
    expect(m?.groups).toEqual({ change: 'add-test-plan-artifact', n: '3' });
  });
  it('findTokens returns all tokens in a blob', () => {
    const out = findTokens('a [c1-T1] b [c2-T2] [c1-T1]');
    expect(out.map((t) => t.token)).toEqual(['[c1-T1]', '[c2-T2]', '[c1-T1]']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/core/parsers/test-plan-token.test.ts`
Verify: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
export const TOKEN_RE = /\[(?<change>[A-Za-z0-9-]+)-T(?<n>\d+)\]/g;

export interface FoundToken { readonly token: string; readonly change: string; readonly id: string; }

export function caseToken(changeName: string, id: string): string {
  return `[${changeName}-${id}]`;
}

export function findTokens(blob: string): FoundToken[] {
  const out: FoundToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(blob)) !== null) {
    out.push({ token: m[0], change: m.groups!.change, id: `T${m.groups!.n}` });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/core/parsers/test-plan-token.test.ts`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/parsers/test-plan-token.ts test/core/parsers/test-plan-token.test.ts
git commit -m "feat(parser): add change-prefixed case-token helpers"
```
Verify: `git log -1 --oneline` shows the new commit

---

## 3. validator coverage check

### Task 6: Extend validation result types

**Files:**
- Modify: `src/core/validation/types.ts`
- Test: `test/core/validation/test-plan-coverage.test.ts` (new, type placeholder only; filled in next task)

- [ ] **Step 1: Add test-plan coverage issue types to `types.ts`**

Add the following members to the existing `ValidationIssue` union (keep existing members, append):

```typescript
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
```

(If `ValidationIssue` is already a union, add `TestPlanIssue` to the union; otherwise append per the existing pattern. The implementer aligns with the actual structure of `types.ts`.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Verify: exit 0 (tsc has no errors)

- [ ] **Step 3: Commit**

```bash
git add src/core/validation/types.ts
git commit -m "feat(validation): add test-plan coverage issue types"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 7: Coverage check function

**Files:**
- Create: `src/core/validation/test-plan-coverage.ts`
- Test: `test/core/validation/test-plan-coverage.test.ts`

- [ ] **Step 1: Write a failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { checkCoverage } from '../../../src/core/validation/test-plan-coverage.js';
import type { TestCase } from '../../../src/core/parsers/test-plan-parser.js';

const mk = (o: Partial<TestCase>): TestCase => ({
  id: o.id ?? 'T1', capability: 'c', requirement: 'r', scenarioRef: 's',
  mark: o.mark ?? 'positive', input: 'i', expected: 'e', itName: 'n', ...o,
});

describe('checkCoverage', () => {
  it('passes when every delta scenario has a case and negatives present', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ scenarioRef: 's', mark: 'negative' })],
    });
    expect(r.issues).toEqual([]);
  });
  it('flags uncovered scenario', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [],
    });
    expect(r.issues.some((i) => i.issue === 'uncovered-scenario')).toBe(true);
  });
  it('flags missing-negative for failure-admitting requirement', () => {
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
  it('flags dangling ref (scenario not in delta or baseline)', () => {
    const r = checkCoverage({
      deltaScenarios: [{ requirement: 'r', scenario: 's' }],
      cases: [mk({ scenarioRef: 'nope', mark: 'negative' })],
      baselineScenarios: [],
    });
    expect(r.issues.some((i) => i.issue === 'dangling-ref')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/core/validation/test-plan-coverage.test.ts`
Verify: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/core/validation/test-plan-coverage.test.ts`
Verify: PASS (5 cases)

- [ ] **Step 5: Commit**

```bash
git add src/core/validation/test-plan-coverage.ts test/core/validation/test-plan-coverage.test.ts
git commit -m "feat(validation): add test-plan coverage check (uncovered/missing-neg/dup/dangling)"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 8: Wire coverage check into validator + missing-file warn/strict

**Files:**
- Modify: `src/cli/commands/validate.ts`
- Test: `test/cli/validate.test.ts` (append; create if absent)

- [ ] **Step 1: Write a failing test (test-plan missing → warn; --strict → error)**

```typescript
import { describe, it, expect } from 'vitest';
import { validateSpecFile } from '../../../src/cli/commands/validate.js';

describe('validate test-plan integration', () => {
  it('warns (not errors) when a testable change lacks test-plan.md', async () => {
    // Use an existing fixture spec that has a scenario, but whose change directory has no test-plan.md
    const res = await validateSpecFile('<path-to-fixture-spec>');
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /test-plan/i.test(w))).toBe(true);
  });
});
```

(The implementer fills in `<path-to-fixture-spec>` with an existing fixture path; if no suitable fixture exists, create one in `test/fixtures/` — a spec with a Scenario + a change directory without a test-plan.)

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/cli/validate.test.ts`
Verify: FAIL — current validate does not produce a test-plan warning

- [ ] **Step 3: Modify validate.ts to integrate**

In `validateSpecFile`, after parsing the spec, if the spec path belongs to a change directory (walk up to find `.specpower.yaml` or `changes/`):
- Read that change's delta scenarios (extract with `requirement-blocks`).
- If the change has `test-plan.md` → `parseTestPlanFile` + `checkCoverage`, converting issues to errors.
- If there is no `test-plan.md` and the delta has a scenario → add a warning `test-plan.md missing for change <name> (--strict upgrades to error)`.
- Under `--strict`, upgrade that warning to an error.

Concretely: at the end of `validateSpecFile`, before returning, call a new private function `checkTestPlan(specPath, strict)` and merge its results.

- [ ] **Step 4: Run the test to confirm it passes + full regression**

Run: `npm test`
Verify: PASS (new test passes, existing tests do not regress)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/validate.ts test/cli/validate.test.ts
git commit -m "feat(validate): integrate test-plan coverage + missing-file warn/strict"
```
Verify: `git log -1 --oneline` shows the new commit

---

## 4. Process lifecycle wiring

### Task 9: plan generates test-plan.md (Stage 5)

**Files:**
- Create: `prompts/plan/test-plan-draft.md`
- Modify: `.claude/skills/specpower-plan/SKILL.md` (if present; otherwise the repo `skills/specpower-plan/SKILL.md`)
- Modify: `prompts/plan/specs.md` (append a pointer to test-plan-draft at the end)

- [ ] **Step 1: Write the test-plan-draft prompt**

```markdown
# Plan Phase: First-Iteration Test-Plan Draft

> Draft `test-plan.md`: derive ≥1 Case (positive/negative) from each Scenario in the delta specs; auto-assign stable ids `T<n>`; token prefix = change name. Reference Scenario names; do not copy WHEN/THEN.

## Process
1. Read `specpower/changes/<name>/specs/**/*.md` and extract every delta Scenario.
2. Produce ≥1 Case per Scenario (prefer 1 positive + ≥1 negative for failure-admitting requirements).
3. Assign ids `T1, T2, …` (no renumbering).
4. Write `specpower/changes/<name>/test-plan.md` following the `templates/test-plan.md` format.
5. Run `specpower validate <spec>` to confirm coverage.
```

- [ ] **Step 2: Append a pointer at the end of specs.md**

Append to `prompts/plan/specs.md`:

```markdown
## Next Step (test-plan draft)
After finishing specs, read `prompts/plan/test-plan-draft.md` and draft `test-plan.md` (NL cases before code).
```

- [ ] **Step 3: Add Stage 5b (generate test-plan) to the specpower-plan SKILL.md after Stage 5**

Insert after the tasks Stage (Stage 5) in the `specpower-plan` SKILL.md:

```markdown
## Stage 5b: Generate test-plan (first-iteration)

Read the file at `.claude/specpower/prompts/plan/test-plan-draft.md` and follow its instructions.

Generate `specpower/changes/<name>/test-plan.md` from the delta specs' Scenarios. Each Scenario → ≥1 Case with stable id `T<n>`; failure-admitting Requirements get ≥1 negative Case. Run `specpower validate <spec>` to confirm coverage.

**No gate here.** Continue to the final review.
```

- [ ] **Step 4: Verify the files exist**

Run: `test -f prompts/plan/test-plan-draft.md && grep -c "Stage 5b" skills/specpower-plan/SKILL.md`
Verify: exit 0, and the second command's stdout ≥ 1

- [ ] **Step 5: Commit**

```bash
git add prompts/plan/test-plan-draft.md prompts/plan/specs.md skills/specpower-plan/SKILL.md
git commit -m "feat(plan): add Stage 5b test-plan draft generation"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 10: refine iterates test-plan

**Files:**
- Modify: `prompts/refine/update-artifacts.md`

- [ ] **Step 1: Add a test-plan row to the route table in update-artifacts.md**

Append to the route table:

```markdown
| Test-case add/merge/edit (preserve id + scenarioRef)  | `test-plan.md`            |
```

And add a `### test-plan.md` subsection under "Format Preservation Rules":

```markdown
### `test-plan.md`
- Preserve the `## Capability:` / `### Requirement: … → Scenario: …` structure and the `- **Case** <id>:` lines.
- Do not renumber or reuse existing `id:`s; allocate the next unused `T<n>` to new Cases.
- A Case must have scenarioRef (delta or baseline), `[positive]`/`[negative]`, input/expected/it().
- After editing, run `specpower validate <spec>` to confirm coverage.
```

- [ ] **Step 2: Verify**

Run: `grep -n "test-plan.md" prompts/refine/update-artifacts.md`
Verify: exit 0, hits both the route-table row and the format subsection

- [ ] **Step 3: Commit**

```bash
git add prompts/refine/update-artifacts.md
git commit -m "feat(refine): route/format-preserve test-plan.md updates"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 11: build Phase B consumes Cases (embed tokens in it())

**Files:**
- Modify: `prompts/build/phase-b-execute.md`

- [ ] **Step 1: Add test-plan consumption to the implementer instructions in phase-b-execute.md**

Append to the implementer subagent instructions:

```markdown
## Test-plan consumption (if change has test-plan.md)
- Read `specpower/changes/<name>/test-plan.md`; each Case drives one `it()` test.
- The `it()` name embeds the token `[<changeName>-<id>]` (e.g. `it('throws on unknown [add-test-plan-artifact-T3]', …)`).
- A `[negative]` Case writes a test reproducing a contract violation.
- Follow TDD: write the test and watch it fail, then implement and watch it pass.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Test-plan consumption" prompts/build/phase-b-execute.md`
Verify: exit 0

- [ ] **Step 3: Commit**

```bash
git add prompts/build/phase-b-execute.md
git commit -m "feat(build): Phase B consumes test-plan cases as id-tagged it() tests"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 12: verify two-step coverage

**Files:**
- Modify: `.claude/specpower/prompts/verify/*.md` (or `skills/specpower-verify/SKILL.md`) — whichever the actual verify prompt location is

- [ ] **Step 1: Add two-step instructions to the verify prompt**

```markdown
## Test-plan two-step coverage (if change has test-plan.md)
- **Step 1 — omission:** For each Case's token `[<changeName>-Tn]` in the test-plan, grep the test suite (`*.test.ts`/`*.spec.ts`) to confirm each token appears. Missing → report FAIL naming that Case.
- **Step 2 — AST best-effort:** Locate that `it()` by prefix token, AST-parse, and check the minimal-checkable items (it() exists, is parseable, calls the function under test, touches the Case's input). If it cannot be confirmed → warning with the gap (not a fail).
```

- [ ] **Step 2: Verify**

Run: `grep -rn "two-step coverage" skills/specpower-verify/ prompts/ 2>/dev/null`
Verify: exit 0, a hit

- [ ] **Step 3: Commit**

```bash
git add skills/specpower-verify/ prompts/
git commit -m "feat(verify): two-step case coverage (token omission + AST best-effort)"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 13: done archives test-plan (no merge)

**Files:**
- Modify: `src/core/specs-apply.ts` (archive set, not merge set)
- Modify: `src/core/archive.ts` (if archiving has an explicit artifact list)
- Test: `test/core/archive.test.ts` (append)

- [ ] **Step 1: Write a failing test (test-plan moves with archive, is NOT merged into baseline)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Reuse the existing archive test-fixture structure

describe('archive test-plan', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(join(tmpdir(), 'tp-arc-')); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('test-plan.md moves to archive and is NOT merged into baseline', async () => {
    // Build a change directory containing test-plan.md + a delta spec; run archiveChange;
    // assert archive/<date>-<name>/test-plan.md exists;
    // assert specpower/specs/<cap>/spec.md does not contain test-plan content.
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/core/archive.test.ts`
Verify: FAIL (test-plan is not specially handled by the archive logic, or an assertion does not hold)

- [ ] **Step 3: Modify archive.ts/specs-apply.ts**

- `archive.ts`'s `archiveChange` step 5 moves the whole directory, which already carries `test-plan.md` (it is in the change directory) — confirm no extra code is needed; if archiving has an explicit "artifact list", add `test-plan.md` to it.
- `specs-apply.ts`'s `applyDeltaSpec` only handles spec deltas and does **not** touch `test-plan.md` — confirm no change is needed, or add a comment clarifying "test-plan is not merged".

(If the current state is already "move the whole directory + merge only spec deltas", this task is mostly about adding test assertions for that behavior, not changing code.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/core/archive.test.ts`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/archive.ts src/core/specs-apply.ts test/core/archive.test.ts
git commit -m "feat(archive): archive test-plan.md (no baseline merge) + test"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 14: change-new rejects reused names (including archived) + optional placeholder

**Files:**
- Modify: `src/cli/commands/change-new.ts`
- Modify: `src/utils/change-utils.ts` (`validateChangeName` or a new `isChangeNameUsed`)
- Test: `test/cli/change-new.test.ts` (append)

- [ ] **Step 1: Write a failing test (reused name is rejected)**

```typescript
import { describe, it, expect } from 'vitest';
import { isChangeNameUsed } from '../../../src/utils/change-utils.js';

describe('change name uniqueness', () => {
  it('returns true when name exists in active changes', () => {
    // fixture: specpower/changes/exists/ exists
    expect(isChangeNameUsed('exists', '<fixture-root>')).toBe(true);
  });
  it('returns true when name exists in archive', () => {
    // fixture: specpower/changes/archive/2026-01-01-old/ exists
    expect(isChangeNameUsed('old', '<fixture-root>')).toBe(true);
  });
  it('returns false for a fresh name', () => {
    expect(isChangeNameUsed('brand-new', '<fixture-root>')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/cli/change-new.test.ts`
Verify: FAIL — `isChangeNameUsed` does not exist

- [ ] **Step 3: Write the implementation**

In `change-utils.ts`:

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as fs from 'node:fs';

export function isChangeNameUsed(name: string, projectRoot: string): boolean {
  const active = join(projectRoot, 'specpower', 'changes', name);
  if (existsSync(active)) return true;
  const archiveDir = join(projectRoot, 'specpower', 'changes', 'archive');
  if (!existsSync(archiveDir)) return false;
  const entries = fs.readdirSync(archiveDir);
  // archive directory name format: <date>-<name>
  return entries.some((e) => e.endsWith(`-${name}`) && existsSync(join(archiveDir, e)));
}
```

At the start of `createChange` in `change-new.ts` add:

```typescript
if (isChangeNameUsed(name, projectRoot)) {
  throw new Error(`Change name '${name}' is already used (active or archived). Choose a unique name — the test-plan token prefix depends on it.`);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/cli/change-new.test.ts`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/change-utils.ts src/cli/commands/change-new.ts test/cli/change-new.test.ts
git commit -m "feat(change): reject reused change names (active+archive) for token-prefix uniqueness"
```
Verify: `git log -1 --oneline` shows the new commit

---

## 5. rename-scenario command (D8)

### Task 15: rename-scenario CLI skeleton + edit baseline spec

**Files:**
- Create: `src/cli/commands/rename-scenario.ts`
- Modify: `src/cli/index.ts` (register the command)
- Test: `test/cli/rename-scenario.test.ts`

- [ ] **Step 1: Write a failing test (rename a baseline spec scenario)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renameScenario } from '../../../src/cli/commands/rename-scenario.js';

describe('renameScenario', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'rs-'));
    const specDir = join(root, 'specpower', 'specs', 'cap');
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(join(specDir, 'spec.md'),
      `### Requirement: r\n...\n#### Scenario: old name\n- **WHEN** x\n- **THEN** y\n`, 'utf-8');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('renames a baseline scenario in the spec file', async () => {
    await renameScenario(root, 'cap', 'old name', 'new name');
    const after = await fs.readFile(join(root, 'specpower', 'specs', 'cap', 'spec.md'), 'utf-8');
    expect(after).toContain('#### Scenario: new name');
    expect(after).not.toContain('#### Scenario: old name');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/cli/rename-scenario.test.ts`
Verify: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

export async function renameScenario(
  projectRoot: string,
  capability: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const specPath = join(projectRoot, 'specpower', 'specs', capability, 'spec.md');
  let content = await fs.readFile(specPath, 'utf-8');
  // Atomically change `#### Scenario: <oldName>` → `#### Scenario: <newName>`
  const re = new RegExp(`^(#### Scenario:\\s*)${escapeRegExp(oldName)}(\\s*)$`, 'm');
  if (!re.test(content)) {
    throw new Error(`Scenario "${oldName}" not found in ${specPath}`);
  }
  content = content.replace(re, `$1${newName}$2`);
  await fs.writeFile(specPath, content, 'utf-8');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerRenameScenarioCommand(program: Command): void {
  program
    .command('rename-scenario <capability> <old> <new>')
    .description('Atomically rename a baseline Scenario and sync test-plan references')
    .option('--dry-run', 'Preview affected files without writing')
    .action(async (capability: string, old: string, next: string, opts: { dryRun?: boolean }) => {
      const projectRoot = process.cwd();
      if (opts.dryRun) {
        const affected = await listAffectedTestPlans(projectRoot, old);
        console.info(`Would rename "${old}" → "${next}" in baseline spec + ${affected.length} test-plan(s):`);
        affected.forEach((p) => console.info(`  ${p}`));
        return;
      }
      await renameScenario(projectRoot, capability, old, next);
      const synced = await syncTestPlanRefs(projectRoot, old, next);
      console.info(`Renamed "${old}" → "${next}"; synced ${synced} test-plan reference(s).`);
    });
}

// Task 16 implementation
async function listAffectedTestPlans(_root: string, _old: string): Promise<string[]> { return []; }
async function syncTestPlanRefs(_root: string, _old: string, _new: string): Promise<number> { return 0; }
```

Register in `src/cli/index.ts`:

```typescript
import { registerRenameScenarioCommand } from './commands/rename-scenario.js';
// ...
registerRenameScenarioCommand(program);
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/cli/rename-scenario.test.ts`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/rename-scenario.ts src/cli/index.ts test/cli/rename-scenario.test.ts
git commit -m "feat(rename-scenario): CLI + baseline scenario rename"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 16: Sync references across test-plans

**Files:**
- Modify: `src/cli/commands/rename-scenario.ts` (implement `listAffectedTestPlans` + `syncTestPlanRefs`)
- Test: `test/cli/rename-scenario.test.ts` (append)

- [ ] **Step 1: Write a failing test (sync in-flight + archived test-plan references)**

```typescript
  it('syncs test-plan references across active + archived changes', async () => {
    // Build a change directory containing test-plan.md whose Case scenarioRef = "old name"
    // Build archive/<date>-old2/test-plan.md with scenarioRef = "old name"
    // renameScenario(root, 'cap', 'old name', 'new name')
    // Assert both test-plans' scenarioRef changed to "new name"
  });
  it('--dry-run lists affected files without writing', async () => {
    // Same fixture; run listAffectedTestPlans; assert it returns two paths and the files are unchanged
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run test/cli/rename-scenario.test.ts`
Verify: FAIL (sync returns 0, files unchanged)

- [ ] **Step 3: Implement syncTestPlanRefs + listAffectedTestPlans**

```typescript
async function listAffectedTestPlans(root: string, old: string): Promise<string[]> {
  const found: string[] = [];
  for await (const tp of findTestPlans(root)) {
    const content = await fs.readFile(tp, 'utf-8');
    if (new RegExp(`→\\s+Scenario:\\s*${escapeRegExp(old)}\\s*$`, 'm').test(content)) {
      found.push(tp);
    }
  }
  return found;
}

async function syncTestPlanRefs(root: string, old: string, newName: string): Promise<number> {
  const affected = await listAffectedTestPlans(root, old);
  for (const tp of affected) {
    let content = await fs.readFile(tp, 'utf-8');
    const re = new RegExp(`(→\\s+Scenario:\\s*)${escapeRegExp(old)}(\\s*)$`, 'm');
    content = content.replace(re, `$1${newName}$2`);
    await fs.writeFile(tp, content, 'utf-8');
  }
  return affected.length;
}

async function* findTestPlans(root: string): AsyncIterable<string> {
  const changesDir = join(root, 'specpower', 'changes');
  if (!await dirExists(changesDir)) return;
  // in-flight
  for (const entry of await fs.readdir(changesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'archive') {
      const tp = join(changesDir, entry.name, 'test-plan.md');
      if (await fileExists(tp)) yield tp;
    }
  }
  // archived
  const archiveDir = join(changesDir, 'archive');
  if (await dirExists(archiveDir)) {
    for (const entry of await fs.readdir(archiveDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const tp = join(archiveDir, entry.name, 'test-plan.md');
        if (await fileExists(tp)) yield tp;
      }
    }
  }
}

async function dirExists(p: string): Promise<boolean> { try { return (await fs.stat(p)).isDirectory(); } catch { return false; } }
async function fileExists(p: string): Promise<boolean> { try { return (await fs.stat(p)).isFile(); } catch { return false; } }
```

Replace the `listAffectedTestPlans`/`syncTestPlanRefs` stubs with the above implementation (remove the `return []`/`return 0` placeholders).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/cli/rename-scenario.test.ts`
Verify: PASS (including sync + dry-run)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/rename-scenario.ts test/cli/rename-scenario.test.ts
git commit -m "feat(rename-scenario): sync test-plan refs across active+archived + dry-run"
```
Verify: `git log -1 --oneline` shows the new commit

---

## 6. Tests & docs

### Task 17: End-to-end integration test

**Files:**
- Create: `test/integration/test-plan-lifecycle.test.ts`

- [ ] **Step 1: Write an E2E test (plan draft → validate coverage → rename-scenario sync)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTestPlan } from '../../src/core/parsers/test-plan-parser.js';
import { checkCoverage } from '../../src/core/validation/test-plan-coverage.js';
import { renameScenario } from '../../src/cli/commands/rename-scenario.js';

describe('test-plan lifecycle (e2e)', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'tp-e2e-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('plan-drafted test-plan passes coverage and rename syncs refs', async () => {
    // 1. Build a change + delta spec (1 scenario) + test-plan.md (1 negative case ref'ing it)
    // 2. parseTestPlan + checkCoverage → no issues
    // 3. renameScenario renames the baseline scenario → the test-plan's scenarioRef syncs
    // 4. parseTestPlan again → scenarioRef is the new name
  });
});
```

(The implementer fills in fixture setup + assertion details.)

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/integration/test-plan-lifecycle.test.ts`
Verify: PASS

- [ ] **Step 3: Commit**

```bash
git add test/integration/test-plan-lifecycle.test.ts
git commit -m "test: end-to-end test-plan lifecycle (draft→validate→rename sync)"
```
Verify: `git log -1 --oneline` shows the new commit

### Task 18: README + CONTRIBUTING docs

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Add a test-plan.md section to README**

After the "Using in a project" section in README, add a section explaining the test-plan.md artifact, the `[<changeName>-Tn]` token convention, `--strict`, and `rename-scenario`.

- [ ] **Step 2: Add a "writing a test-plan" guide to CONTRIBUTING**

Add a section to CONTRIBUTING.md: when to write a test-plan (plan Stage 5b), Case format, id stability, token embedding.

- [ ] **Step 3: Verify**

Run: `grep -n "test-plan.md" README.md CONTRIBUTING.md`
Verify: exit 0, both files hit

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: test-plan.md usage + contribution guide"
```
Verify: `git log -1 --oneline` shows the new commit

---

## Completion Criteria

- `npm run build` passes.
- `npm test` is fully green (new parser/coverage/validate/rename/e2e tests + no existing-test regression).
- `specpower validate` can run test-plan coverage checks.
- `specpower rename-scenario` can atomically rename + sync.
- `specpower change new` rejects reused names.
```
