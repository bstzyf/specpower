# Plan Phase: First-Iteration Test-Plan Draft

> Draft `test-plan.md`: derive >=1 Case (positive + negative) per delta Scenario; assign stable ids `T<n>`; the token prefix is the change name. Reference Scenarios by name; do not copy WHEN/THEN.

## Prerequisites
- `specpower/changes/<name>/specs/**/*.md` exists (Stage 3 done).
- `templates/test-plan.md` scaffold exists.

## Process
1. Read `specpower/changes/<name>/specs/**/*.md`; extract every delta Scenario (`#### Scenario:`), its parent `### Requirement:`, and `## Capability:` (or derive capability from the spec file name).
2. For each Scenario produce >=1 Case:
   - Prefer 1 `[positive]` (include legitimate boundary values if the function accepts them).
   - For failure-admitting Requirements (side-effect/IO/state/contract-validating), >=1 `[negative]` (contract-violating or abnormal input).
   - See `prompts/reference/specpower/negative-testing-guide.md`; legitimate boundary values (empty/extreme/large) the contract accepts are `[positive]`, not negative.
3. Assign ids `T1, T2, …` (in Scenario order); **never renumber**; token = `[<changeName>-Tn]` (change name = the `<name>` of `specpower/changes/<name>`).
4. Write `specpower/changes/<name>/test-plan.md` per `templates/test-plan.md`: `## Capability:` → `### Requirement: <req> → Scenario: <scen>` → `- **Case** Tn: <desc> [mark]` with sub-items `Input:`/`Expected:`/`it():`/optional `file:`.
5. Run `specpower validate specpower/changes/<name>/specs/<cap>/spec.md` to confirm coverage (every Scenario >=1 Case; add missing negatives).

## Non-testable change (no delta Scenario)
If delta specs have no Scenario (pure refactor/docs), `test-plan.md` is **optional** — create it only to carry baseline-regression Cases (referencing `specpower/specs/` Scenarios); otherwise skip (do not create an empty file).

## Output
`specpower/changes/<name>/test-plan.md` (first-iteration draft; `refine` iterates it).
