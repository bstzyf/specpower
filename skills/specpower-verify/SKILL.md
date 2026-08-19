---
name: specpower-verify
description: "Dual validation -- delta specs + main specs regression"
---

# SpecPower: Verify

## Prerequisites

- An active change must exist with delta specs and implementation.
- `specpower` CLI must be available on PATH.
- Main specs in `specpower/specs/` are optional: if present, regression is verified against them; if absent (greenfield project that has not archived any change yet), Pass 2 is explicitly skipped (see Stage 2 Pass 2 below). Never silently pass Pass 2 when the directory is missing — always report `skipped (no baseline)` so a main-specs deletion in a brownfield project cannot hide behind a green verify.

## Stage 1: CLI Validation

Run `specpower validate` to perform structural validation of specs.

If validation fails, report errors and stop. The user must fix spec issues before proceeding.

## Stage 2: Verification

Read the file at `.claude/specpower/prompts/verify/verification.md` and follow its instructions.

Perform three verification passes:

### Pass 1: Delta Acceptance
Verify that the implementation satisfies all delta specs in the active change.
Check each spec scenario against actual behavior.

### Pass 2: Regression
Verify that existing main specs still pass.
Flag any regressions introduced by the change.

**Baseline-aware execution:**
- Check whether `specpower/specs/` exists AND contains at least one `*.md` file under any capability subdirectory.
- **If baseline present** — load every main spec, walk each `### Requirement:` and `#### Scenario:`, and verify the implementation still satisfies it. Report pass/fail per spec with concrete evidence (test output, code inspection).
- **If baseline absent** — do NOT implicitly pass. Emit the exact line `Pass 2: skipped (no baseline — greenfield project or no archived changes yet)` and move on to Pass 3. The explicit marker prevents a deleted/moved `specpower/specs/` in a brownfield project from silently hiding real regressions.

### Pass 3: Scope Creep
Check that the implementation does not introduce behavior beyond what the delta specs describe.
Flag any undocumented changes.

### Pass 4: Test-plan coverage (if the change has `test-plan.md`)

Two-step Case→test coverage check:

**Step 1 — omission (reliable, fails hard):** for each Case in `specpower/changes/<name>/test-plan.md`, scan the project's test files (`*.test.*` / `*.spec.*`) for its token `[<changeName>-<id>]`. Any Case whose token is absent → **FAIL** naming the Case (no-omission). Reliable because the token is globally unique and stable.

**Step 2 — Semantic match (deep, fails on mismatch):** for each located `it()`, read the test code and verify its semantics match the Case's definition in `test-plan.md`:
- (a) the test calls the function-under-test with the Case's `Input`;
- (b) the test asserts the Case's `Expected` outcome (e.g., Case `Expected: throw /Unknown tool/` ↔ test `.toThrow(/Unknown tool/)`; Case `Expected: return 42` ↔ test `.toBe(42)` or `=== 42`).
- **FAIL** if the test asserts a *different* outcome than the Case's `Expected` (semantics mismatch — the test does not verify what the plan says it should).
- **WARN** (not fail) only when you genuinely cannot determine the correspondence (e.g., complex setup, framework-specific idiom, the `it()` body is too indirect to map). State what you could not determine.
- You ARE judging semantic correspondence here — that is the point of Step 2. Step 1 proved the test exists; Step 2 proves it tests the *right thing*. An `it()` that exercises a different input or asserts a different expectation than the Case is a coverage lie and must FAIL.

## Stage 3: Report

Present a consolidated verification report:
- Delta acceptance: pass/fail per spec
- Regression: pass/fail summary, or `skipped (no baseline)` when applicable
- Scope creep: any findings
- Overall verdict: PASS or FAIL with reasons

A `skipped` Pass 2 MUST appear verbatim in the report — do not fold it into the "pass" summary. The user needs to see that regression coverage was absent, not inferred as clean.
