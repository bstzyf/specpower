import { describe, it, expect } from 'vitest';
import { parseTestPlan, findMalformedCases } from '../../../src/core/parsers/test-plan-parser.js';

const DOC = `# test-plan: demo

## Capability: tools

### Requirement: tool resolution → Scenario: unknown tool id throws

- **Case** T1: pass an unsupported id [negative]
  - Input: resolveTool('nope')
  - Expected: throw /Unknown tool 'nope'/
  - it(): throws on unknown tool id
  - file: src/core/tools/adapters.test.ts
`;

describe('parseTestPlan', () => {
  it('parses a well-formed case with all fields [add-test-plan-artifact-T2]', () => {
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

describe('findMalformedCases', () => {
  it('returns empty for well-formed T<n> ids', () => {
    const doc = `## Capability: c

### Requirement: r → Scenario: s

- **Case** T1: ok [positive]
  - Input: a
  - Expected: b
  - it(): n
`;
    expect(findMalformedCases(doc)).toEqual([]);
  });

  it('flags a Case whose id lacks the T<n> prefix (e.g. X1) [add-test-plan-artifact-T3]', () => {
    const doc = `## Capability: c

- **Case** X1: bad id [positive]
  - Input: a
  - Expected: b
  - it(): n
`;
    const hit = findMalformedCases(doc);
    expect(hit).toHaveLength(1);
    expect(hit[0].line).toBe(3);
    expect(hit[0].raw).toContain('X1');
  });

  it('flags a Case with no id before the colon', () => {
    const doc = `- **Case** : no id [positive]
`;
    const hit = findMalformedCases(doc);
    expect(hit).toHaveLength(1);
    expect(hit[0].line).toBe(1);
  });

  it('does not flag non-Case lines', () => {
    const doc = `some text
- not a case line
### Requirement: r → Scenario: s
`;
    expect(findMalformedCases(doc)).toEqual([]);
  });

  it('reports 1-based line numbers across multiple matches', () => {
    const doc = `- **Case** X1: a [positive]
- **Case** T1: ok [positive]
- **Case** Z9: b [positive]
`;
    const hit = findMalformedCases(doc);
    expect(hit.map((h) => h.line)).toEqual([1, 3]);
  });
});

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
