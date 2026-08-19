# Design: test-plan-artifact (test-case plan artifact)

> Initial draft. `/specpower:refine` will challenge assumptions and probe boundaries from here.

## 1. Background

specpower's current TDD pipeline has two NL test-intent landing points:

- The `#### Scenario` block in `spec.md` — requirement-level behavioral intent (WHEN/THEN), validated by `core/validation/validator.ts` and parsed by `core/parsers/requirement-blocks.ts`.
- The `it()`/`test()` names in test code — written by the `build` Phase B implementer subagent during TDD, scattered across project test files.

There is no artifact between the two. Consequence: a reviewer cannot quickly see "which cases to cover this time, the positive/negative distribution, and which `it()` each case maps to"; `verify` cannot mechanically check "every Scenario became a test"; negative-test discipline (`prompts/reference/specpower/negative-testing-guide.md`) relies only on prompt reminders, with no enforced artifact.

This change adds a per-change `test-plan.md` — a parseable NL case list — generated in `plan`, iterated in `refine`, consumed by `build` Phase B, coverage-checked by `verify`, and archived by `done`. It is embedded in the existing 4-artifact change directory (proposal/specs/design/tasks) and reuses the existing validation infrastructure (validator + requirement-blocks parser + the negative-scenario rules introduced by the validation commit).

Constraints: TypeScript/ESM, tsc, vitest; a markdown-parseable spec format (the CLI parses a precise heading structure); backward compatibility with existing changes that predate this capability.

## 2. Goals / Non-Goals

**Goals**
- A machine-parseable `test-plan.md`: Cases reference spec Scenarios by name, carry `[positive]`/`[negative]` markers, input/expected, a stable `id:`, and the planned `it()` name.
- `plan` generates (first draft); `refine` iterates; `build` Phase B consumes it as a TDD case list; `verify` cross-checks Case→`it()` coverage; `done` archives (does not merge into baseline).
- `validate` enforces: every Scenario has ≥1 Case; every failure-admitting Requirement has ≥1 negative Case; orphan/duplicate/dangling references are rejected.
- Backward compatible: existing changes without a `test-plan.md` degrade to a warning, not an error.

**Non-Goals**
- Automatically **semantically** deciding "whether a `[negative]` Case is a genuine contract violation vs. a legitimate boundary mislabeled" — that needs human/semantic review (refine + review). The validator only handles structure, not semantics (see R1).
- Generating test **code** — `test-plan.md` is NL; `build` Phase B writes the code.
- Integrating a test runner or coverage **metrics** — `verify` does Case→`it()` matching by id, not line-coverage aggregation.
- In v1, extending to non-markdown spec formats or non-JS/TS test frameworks (`[Tn]` scanning and AST are cross-framework in principle, but v1 defaults to JS/TS `it`/`test`).

## 3. Design Decisions

### D1: `test-plan.md` as a peer per-change artifact
**Options**
- (a) A peer file `changes/<name>/test-plan.md` — selected.
- (b) A `## Test Cases` section inside `spec.md`.
- (c) An `## Acceptance Tests` section inside `tasks.md`.

**Selected**: (a).
**Rationale**: `spec.md` is a validated requirements contract with a fixed format coupled to the parser (`### Requirement`/`#### Scenario`) — pasting concrete cases in would bloat the contract and risk parser coupling. `tasks.md` is implementation steps, not case intent. A standalone artifact has its own parseable format and its own lifecycle (archived, not merged), without distorting the existing two. This matches the existing 4-artifact pattern (each artifact = one abstraction layer).

### D2: Cases reference Scenarios by name (no copy)
**Options**
- (a) Reference by Scenario name — selected.
- (b) Copy the Scenario's WHEN/THEN into the Case.
- (c) A synthesized stable scenario id.

**Selected**: (a).
**Rationale**: the spec is the single source of behavioral intent; copying WHEN/THEN into Cases creates two copies that drift under `refine`. The Scenario name is already a human-stable identifier in `spec.md`. A synthesized id adds authoring cost with no benefit at this scale. Referencing by name lets the validator catch dangling references at validation time (D4/R3).

### D3: Structured markdown case format + a standalone parser
**Options**
- (a) Structured markdown list (Capability > Requirement > Scenario reference block > Case entries with fields) — selected.
- (b) A YAML frontmatter block per Case.
- (c) A markdown table.

**Selected**: (a).
**Rationale**: matches specpower's existing parseable-markdown style — `core/parsers/requirement-blocks.ts` already extracts `### Requirement`/`#### Scenario`; a new `core/parsers/test-plan-parser.ts` similarly extracts Case blocks and reuses the markdown-parser utilities. YAML-per-Case is heavier to author in the plan/refine flow; a table cannot carry multi-field cases. **Case shape (refined in R1)**: each Case carries a stable, change-unique `id:` (e.g. `T1`, unrelated to the `it()` name — see D5), a Scenario reference (delta or baseline — see D7), a `[positive]`/`[negative]` marker, input, expected, the planned `it()` name, and an optional `file:` (planned test-file path). One `test-plan.md` per change, sectioned by `## Capability: <cap>`. The precise field syntax is finalized at implementation time (open question Q1).

### D4: Coverage strictness — warn by default, `--strict` upgrades
**Options**
- (a) A testable change lacking `test-plan.md` → warning; `--strict` → error — selected.
- (b) Missing = hard error.
- (c) Silently skip (don't check).

**Selected**: (a).
**Rationale**: changes that predate this capability have no `test-plan.md`; (b) would retroactively invalidate them and break the `done`/`validate` of existing in-flight changes. (c) has no enforcing power. (a) pushes new changes while leaving `--strict` for CI/`done` gating. Structural violations (orphan Case, uncovered Scenario, missing negative case) are hard errors — only **file absence** is the warn/strict-upgradable condition, because absence is a backward-compat case.

### D5: `verify` Case↔test linkage — stable Case id + two-step check
**Options**
- (a) Match by `it()` name string (regex scan) — *rejected*: name drift (renames, parameterized/generated names, framework phrasing) → high false negatives.
- (b) Name match + optional `file:` field — *rejected*: still name-coupled; reduces but does not eliminate drift.
- (c) No Case→`it()` matching (only Case→Scenario structural coverage) — *rejected*: loses the "every case becomes a test" signal.
- (d) Pure AST / framework adapters — *rejected*: cross-framework AST is brittle and a heavy dependency, with no stable linkage anchor.
- (e) **Stable Case id + two-step check** — selected (refined in R2).

**Selected**: (e).
**Design**: each Case carries a stable, change-unique `id:` (e.g. `T1`/`C-003`), **unrelated to the `it()` name**. **id-embedding convention (set in R2, refined in R4)**: the token embedded in test code is **globally unique** and carries a change prefix — `[<changeName>-<id>]`, e.g. `[add-test-plan-artifact-T3]`; `plan` derives the prefix from the change name automatically, authors do not write it by hand. `verify` Step1 scans for **this change's prefix token** (not bare `[Tn]`). **Why globally unique (R4)**: if ids were only change-unique, with multiple changes coexisting A/B both have `[T1]`, Step1 would hit each other and could not distinguish them, and when A is unimplemented but B is implemented it would falsely report "A's T1 is covered" → miss the gap; Step2's token-located test lookup would be similarly ambiguous. A change-prefixed token resolves this at once. **id stability (set in R2)**: once assigned, an id is stable — `plan` assigns automatically, `refine` should not renumber when adding/merging/editing Cases (analogous to keeping Scenario names stable; the change prefix is also stable, since the change name does not change). `verify` two steps:
- **Step1 — no-omission/no-coverage (cheap, reliable)**: every Case's **prefix token** must appear in the test suite (scan `[<changeName>-Tn]`); missing → fail and name that case. Reliable, because the token is globally unique and does not drift.
- **Step2 — Semantic match (deep, fails on mismatch)**: locate that Case's test by prefix token, read the test code, and verify its semantics match the Case's definition: (a) the test calls the function-under-test with the Case's `Input`; (b) the test asserts the Case's `Expected` outcome. **Mismatch (test asserts a different outcome than the plan) → FAIL.** Genuinely cannot determine correspondence (complex setup, framework idiom) → warning. This IS semantic judgment — verify is AI-driven, so the AI reads the Case's `Input`/`Expected` and the `it()` code and judges correspondence directly (not a code AST function, which is why semantic match is achievable here, unlike the "not fully automatable" caveat that applied to a pure-code matcher).
**Rationale**: a stable id decouples case identity from test naming — kills the name-drift false negatives of (a)/(b); **R4's change prefix** lifts the token from "change-unique" to "globally unique," killing cross-change collisions and false reports. Step1 cheaply gives a reliable no-omission signal (scan prefix token, no AST). Step2 (AST) gives the "test matches plan" semantic check users want, and staging means v1 can ship Step1 alone. (e) is a synthesis of (a)'s cheapness, (b)'s precision, (c)'s "simple where it should be," and (d)'s depth — avoiding each one's fatal shortcoming.
**Open**: the precise token syntax (`<changeName>-Tn` vs `<changeName>/Tn` vs `Tn@<changeName>`) and the AST frameworks supported by v2 Step2 — see open questions Q1/Q3. ("change-prefixed, globally unique" and id stability are already decided.)

### D6: New parser module + extend validator; specs-apply archives
**Options**
- (a) New `core/parsers/test-plan-parser.ts`; `validator.ts` gains a coverage stage; `specs-apply.ts` adds `test-plan.md` to the archive set (no merge) — selected.
- (b) Fold Case parsing into `requirement-blocks.ts`.
- (c) An external linter package.

**Selected**: (a).
**Rationale**: `test-plan.md` has a different structure from spec requirement-blocks; a standalone parser keeps `requirement-blocks.ts` focused and testable. `validator.ts` already has negative-scenario infrastructure (validation commit) and can be extended with Case-coverage rules. `specs-apply.ts` already manages the change→baseline merge/archive pipeline; adding `test-plan.md` to the archive set (explicitly not to the merge set) is the correct minimal integration.

### D7: Regression scope — delta + baseline scenario references
**Options**
- (a) Delta scenarios only (new/modified behavior) — *rejected*: regressions of touched existing code have no coverage.
- (b) Delta + baseline regressions (Cases may reference baseline scenarios) — selected.
- (c) Delta + a free-form "regression notes" area (not coupled to scenarios) — *rejected*: unstructured, not mechanically checkable.

**Selected**: (b).
**Rationale*: regressions of touched existing code are the highest-value automated signal a test-plan can carry. Coupling to baseline `specpower/specs/` is acceptable because the baseline is the contract. The coverage rule still applies only to deltas (every delta Scenario ≥1 Case), but a Case may additionally reference a baseline Scenario for regression; the validator resolves Case→Scenario references in both delta and baseline directions.

### D8: `specpower rename-scenario` — atomic baseline Scenario rename + cross-test-plan sync
**Options**
- (a) Command-driven atomic rename: `specpower rename-scenario <cap> <old> <new>` changes the baseline spec's Scenario name + scans all test-plans (in-flight + archived) referencing the old name and syncs them — selected.
- (b) No command, only `validate` flags dangles — *rejected*: archived test-plans don't run `validate`, so dangles fail silently (D7's regression references would rot).
- (c) Implicit detection at `done`/`sync` time — *rejected*: implicit, uncontrollable, discovered too late.

**Selected**: (a).
**Rationale**: D7 lets Cases reference baseline scenarios for regression; if a later change renames a baseline Scenario, those references in archived + in-flight test-plans would dangle (R3 only covers delta-scenario drift, not baseline). Without an atomic rename, regression references would silently rot as the baseline evolves — hollowing out D7's value. (a) makes "change the baseline spec name" and "sync all test-plan references" a single atomic operation, a necessary precondition for D7 not to rot. It is a tightly coupled part of this change (not split out).
**Implementation notes**: `--dry-run` previews affected files + a confirmation gate + reliance on git reversibility (see R6).

### D5 supplement: Step2 minimal-checkable items + change-name uniqueness + id persistence (set in R5)
- **Step2 semantic match**: Step2 reads the located `it()`'s code and verifies it calls the function-under-test with the Case's `Input` and asserts the Case's `Expected` outcome. **Mismatch → fail** (the test does not verify what the plan says). Cannot determine → warn. Step2 IS a semantic judgment — verify is AI-driven, so the AI compares the Case's definition to the test code directly. (Earlier R2 "not fully automatable" applied to a pure-code AST matcher; an AI-driven check can judge correspondence.)
- **Change name globally unique**: `change new` should reject names already used (including within `archive/`); the token prefix `<changeName>-` depends on this guarantee for global uniqueness (R4). An archived old change's tests remain in the codebase; if a new change reuses the same name → token collision, verify false reports.
- **id persistence**: when `plan`/`refine` regenerates `test-plan.md`, it **should read the old file and preserve existing ids**, allocating only to new Cases; avoiding regeneration-induced old-token mismatch (R2's "id stable" also holds on the regeneration path).

## 4. Risks / Trade-offs

- **R1 — weak automatic misclassification detection (closed in R1)**. The validator only enforces **structure** (every Case has a marker; every failure-admitting Requirement ≥1 `[negative]`; every Case has an `id:`); it **does not judge** whether a `[negative]` Case is a genuine contract violation vs. a legitimate boundary mislabel — that is semantic. **Mitigation**: validator is structure-only; misclassification is a `refine`/review responsibility. The spec's "mislabeled negative is rejected" scenario is softened to a review-check item (not auto-rejected). Note: D5 Step2 (AI-driven semantic match) **does** verify "the test code asserts what the plan's Case says" — that is a checkable correspondence (test matches plan), distinct from "classification correctness" (which stays review-only).
- **R2 — `verify` Step2 now does semantic match (revised)**. Earlier R2 softened Step2 to "best-effort warn, never fail" because it assumed Step2 was a pure-code AST matcher (NL↔code "not fully automatable"). Revised: verify is **AI-driven**, so Step2 reads the Case's `Input`/`Expected` and the `it()` code and judges correspondence directly — **mismatch → fail**, can't-determine → warn. This is the semantic check users want; it's achievable because the AI (not a code function) does the comparison. Residual: the AI may occasionally can't-determine (complex setup) → warn (not a false pass).
- **R3 — Scenario name drift (R5 extended to baseline)**. `refine` renaming a delta Scenario → Case reference dangles (`validate` rejects, already covered); a **baseline** Scenario renamed by a later change → the baseline-regression references of archived/in-flight test-plans dangle. **Mitigation**: D8 `rename-scenario` atomically renames + syncs across test-plans, covering both delta and baseline drift; running `validate` after `refine` remains the recommended flow.
- **R4 — prompt/skill surface spread**. Touching the prompts + skills of plan/build/verify/done/test is a wide, inconsistency-prone change. **Mitigation**: each prompt's reference to test-plan is minimal and consistently worded; one parser serves all consumers; one integration test exercises the full lifecycle.
- **R5 — adoption friction**. Authors now have to write Cases (with stable ids + change-prefix tokens) before writing code — an extra step. **Mitigation**: `plan` generates the first draft from Scenarios (with auto-assigned ids + derived prefix tokens), lowering authoring cost; the default-warn path (D4) means this step is encouraged, not blocking, until CI turns on `--strict`.
- **R6 — `rename-scenario` is a cross-file destructive operation**. Renaming + scanning/editing all test-plans (including archived) has a large blast radius if it goes wrong. **Mitigation**: `--dry-run` previews the affected-file list, a confirmation gate, reliance on git reversibility, and running `validate` afterward to confirm no dangling references.

## 5. Migration Plan

Greenfield capability — no data migration. Existing in-flight changes (predating this capability) have no `test-plan.md`; per D4, `validate`/`verify` degrades to a warning and does not block `done` (unless `--strict`/`--force` gating is configured). No config-file changes needed.

## 6. Open Questions

- **Q1 — precise Case-block syntax**: the delimiter for input/expected (indented sub-items vs. inline); whether the planned `it()` name is required (leaning yes, secondary to `id:`). The `id:` field is **decided required** (D5); `file:` is optional. To be drafted in `templates/test-plan.md`.
- **Q2 — `change new` behavior**: should `specpower change new` create a `test-plan.md` placeholder, or only create it in `plan` Stage 5 (same as `design.md`/`tasks.md`)? Leaning Stage 5.
- **Q3 — Step2 framework/language scope**: Step2 is AI-driven (reads Case + test code, judges correspondence), so it is not tied to a specific AST framework — the AI can read any language's test code. Residual concern: very large test suites or heavily indirect setups where the AI can't determine correspondence → warn. (The `[Tn]`-name id-embedding convention and id-stability rule are set in R2.)
- **Q4 — `fix` fast-track**: the `fix` skill auto-archives — should it require a `test-plan.md` (even a single-case regression plan), or be exempt?
- **Q5 — misclassification handling (closed in R1)**: decided — validator is structure-only; misclassification is left to review/refine; the spec's "mislabeled negative is rejected" is softened to a review-check item. (No longer open.)
