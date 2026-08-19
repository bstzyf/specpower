## Why

specpower's TDD flow is missing a layer of "natural-language cases before code": the `spec.md` Scenarios are requirement-level behavioral intents (coarse), and the `it()` names in test code are written during TDD execution and scattered across test files. In between there is no per-change concrete case list — during review you cannot quickly see "which cases are to be covered this time, the positive/negative distribution, and which `it()` each case maps to," nor can you perform a scenario→case→it coverage check at the verify stage. Negative-test discipline (`negative-testing-guide`) currently relies only on prompt reminders, with no enforceable artifact to validate against.

## What Changes

- Add a 5th change artifact `test-plan.md` (alongside `proposal.md` / `specs/` / `design.md` / `tasks.md`), generated **before test code**.
- Content: concrete NL cases **expanded** from spec scenarios, each with a positive/negative marker, input/expected, and the planned `it()` name; cases **reference** (do not copy) scenarios, avoiding a dual source of truth.
- Add a `templates/test-plan.md` scaffold (alongside the existing 4 templates).
- Process integration: plan Phase A generates (first-iteration) → refine iterates → build Phase B writes `it()` tests from it → verify checks scenario→case→it coverage → done archives (not merged into baseline, same as proposal/design/tasks).
- validator gains rules: every scenario has ≥1 case in `test-plan.md` and at least one negative; the positive/negative distinction follows `negative-testing-guide`.
- Add a `specpower rename-scenario` command: atomically rename a baseline Scenario and sync references across all in-flight and archived test-plans, preventing baseline-regression references from silently dangling as specs evolve.
- README / CONTRIBUTING document the new artifact and flow.

## Capabilities

### New Capabilities

- `test-planning`: format, generation timing, lifecycle, and scenario→case→it coverage validation of the natural-language test-case plan artifact (`test-plan.md`).

### Modified Capabilities

(`specpower/specs/` is currently empty, so there are no existing specpower specs to "modify." But this change extends the existing flows described in `openspec/specs/` for `specpower-test` / `specpower-build` / `specpower-verify` / `specpower-done` — within specpower's own spec system these will be established as new specs, see the specs stage.)

## Impact

- **New artifact**: `templates/test-plan.md` (scaffold); runtime `specpower/changes/<name>/test-plan.md`.
- **Modified prompts**: `plan/proposal.md` or `plan/specs.md` (generate test-plan), `build/phase-a-plan.md` + `phase-b-execute.md` (TDD consumes test-plan), `verify`-related (coverage check), `done` (archive).
- **Modified skills**: `specpower-plan` / `specpower-build` / `specpower-verify` / `specpower-done` / `specpower-test` `SKILL.md` references to test-plan.
- **Modified src**: `core/validation/{validator,types,constants}.ts` (new "scenario→case coverage + negative-case" rules, parse `test-plan.md`); `core/specs-apply.ts` (test-plan is not merged, but is part of the change lifecycle and archive list); `cli/commands/{change-new,instructions,validate}.ts` (optional placeholder creation, artifact instructions, validation entry).
- **Docs**: README, CONTRIBUTING.
- **Non-breaking**: the existing 4-artifact flow is unchanged; `test-plan.md` is a new optional layer — when absent, validation degrades to a warning (does not block existing changes).
