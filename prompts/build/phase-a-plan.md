> **HARD GATE**: User must confirm the rewritten plan before Phase B execution begins. Do NOT proceed to implementation until the user has reviewed and approved the rewritten tasks.md.

<!-- SOURCE: skills/writing-plans/SKILL.md (with build Phase A rewrite semantics) -->

# Rewriting Plans to Writing-plans Precision (Phase A)

## Purpose Declaration

**This prompt is for REWRITING an existing tasks.md into writing-plans precision.**
**NOT for generating tasks.md from scratch.** The tasks.md already exists from the `plan` or `refine` phase. Your job is to take a coarse-grained first-iteration plan (or a refine-updated version of it) and transform each checkbox into a 2-5 minute atomic task that a fresh subagent can execute without additional context.

**Announce at start:** "I'm using specpower:build Phase A to rewrite the existing plan into writing-plans precision."

**Context:** This should be run in the dedicated worktree created by specpower:refine.

**Plan location (input and output):** `specpower/changes/<change-name>/tasks.md`
- (User preferences for plan location override this default)

## Input Order

Phase A MUST read inputs in the following order before making any analysis decisions:

1. **Read `design.md`** — this must be finalized (refine phase should have closed any ambiguity). This is the authoritative source of technical decisions: interfaces, error handling strategy, data flow, file structure.
2. **Read `specs/**/*.md`** (the delta specs for this change) — these are the behavioral requirements. Every spec scenario must map to at least one atomic task.
3. **Read existing `tasks.md`** — this is the coarse first-iteration plan (from `/specpower:plan`) or the refine-updated version. Its top-level group structure (`## N. <Group Name>`) is the starting point for rewrite.
4. **Analyze** all three documents jointly, THEN decide one of the 3 outcomes below. Do not start rewriting until you have classified the situation.

## Three Possible Outcomes

After analyzing inputs, classify the situation into exactly one of:

- **Outcome 1: Normal Rewrite** — design.md is sufficient, existing groups are well-suited. Proceed to rewrite each checkbox into atomic tasks while preserving the group structure.
- **Outcome 2: Grouping Reorganization** — design.md is sufficient, but analysis reveals the current top-level group structure is poorly suited to writing-plans precision (e.g., tasks would cross groups awkwardly, or a different grouping axis would make TDD cycles cleaner). Propose reorganization and wait for user choice.
- **Outcome 3: Gap Detection** — design.md is missing information required to write precise atomic tasks. Halt rewriting and report all gaps at once.

---

## Outcome 1: Normal Rewrite

This is the standard path. When design.md is finalized and existing groups are well-suited:

- **Preserve top-level task group structure** (`## N. <Group Name>`) — do not rename, reorder, add, or remove groups without user approval (that would trigger Outcome 2).
- **Rewrite each checkbox** into one or more 2-5 minute atomic tasks.
- **Each atomic task MUST have**:
  - Complete file path (exact, relative to project root)
  - Full code block or exact diff instructions (no "similar to above")
  - `Verify:` line with the command to run AND the expected output or exit condition
- Produce the rewritten tasks.md in place (overwrite the coarse version).
- Proceed to the Before/After Audit (see later section).

---

## Outcome 2: Grouping Reorganization

**Trigger:** writing-plans analysis reveals a structurally better grouping. Examples:
- Current grouping is "by technical layer" (models / views / tests), but "by end-to-end scenario" would produce cleaner TDD cycles.
- A group is too large and should be split, or two groups should be merged.
- Dependencies between groups would force reordering.

**Action:** STOP rewriting. Output the reorganization proposal FIRST, then wait for the user's choice before touching tasks.md.

**Exact output format:**

```
Analysis suggests reorganizing task groups.

Rationale: <why the new grouping is better, 1-3 sentences>

Old → New mapping:
  Group 1 "<old name>" → Group A "<new name>"
  Group 2 "<old name>" → Group A "<new name>" (merged)
  Group 3 "<old name>" → Group B "<new name>"
  ...

Choices:
  A) Accept reorganization — I will rewrite tasks.md using the new groups.
  B) Keep original grouping — I will force writing-plans precision to fit the existing groups.
  C) I will edit groups manually, then re-run /specpower:build.
```

**Gate behavior:**
- Wait for user choice A, B, or C before proceeding. There is no silent default.
- On **A**: proceed with rewrite using the new group structure, then run Before/After Audit with the new groups reflected.
- On **B**: proceed with rewrite preserving the original group structure (Outcome 1 path).
- On **C**: halt Phase A and exit. User will manually edit groups and re-run `/specpower:build` later.

---

## Outcome 3: Gap Detection

**Trigger:** design.md lacks specific information required to write a precise atomic task. Examples:
- A task needs an error handling strategy that design.md does not specify.
- An interface signature is undefined or ambiguous in design.md.
- A data flow step is silent on what format is passed between components.

**Action:** STOP rewriting. Report **ALL detected gaps at once** (do NOT interrupt after the first gap — scan every task first and collect every gap).

**Exact output format:**

```
Phase A cannot proceed — design.md is missing information required to rewrite tasks precisely.

Gaps detected:
  1. Task "<task summary>" — design does not specify: <what's missing>
  2. Task "<task summary>" — design does not specify: <what's missing>
  3. Task "<task summary>" — design does not specify: <what's missing>

Recommendation: Run /specpower:refine to close these gaps.
Refine may update design.md, specs, or even proposal as needed.
```

**Preservation rules on halt:**
- Any **already-rewritten atomic tasks** in tasks.md MUST be preserved (do NOT discard).
- **Not-yet-rewritten tasks** remain in their coarse form from the previous phase (do NOT discard, do NOT stub out).
- Phase remains `refined` in `.specpower.yaml` (no transition).
- When user re-runs `/specpower:build` after refine closes the gaps, Phase A re-examines tasks.md and continues rewriting from where it halted — it does not restart from scratch.

---

## Writing-plans Rigor (apply to all atomic tasks)

These rules apply to Outcome 1 and Outcome 2-A paths. They are non-negotiable:

- **2-5 minutes per task** — one discrete action. "Write the failing test" is a task. "Run it to confirm it fails" is a separate task. "Implement minimal code" is a separate task.
- **Zero placeholders** — no "TBD", "TODO", "implement later", "fill in details", "similar to above", "fill in later", "add appropriate error handling", "handle edge cases". The engineer may be reading tasks out of order; each task must stand alone.
- **Every command has a `Verify:` line** — exact command + expected output or exit condition (e.g., "Expected: test FAILS with `ImportError: cannot import name 'foo'`"). No verification = no task.
- **Complete code blocks OR precise diff instructions** — never reference code not shown. If a task modifies an existing file, show the before/after snippet or the exact `sed`/`apply` instruction.
- **Exact file paths always** — relative to project root. No `./some/file.ts` when the tasks.md lives in a sibling directory.
- **Type consistency** — if Task 3 defines `clearLayers()`, Task 7 MUST use `clearLayers()`, not `clearFullLayers()`.

## Scope Check

If the spec covers multiple independent subsystems that should have been broken into sub-project specs during specpower:refine and weren't, surface this during analysis (treat as a structural concern; do not silently rewrite).

## File Structure

Before finalizing atomic tasks within a group, confirm which files will be created or modified and what each one is responsible for. This decomposition decision should already be in design.md — Phase A's job is to map it faithfully to the task list, not to invent new structure.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns.

## Plan Document Header

**The rewritten tasks.md MUST start with this header (preserve if already present):**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use specpower:build Phase B (recommended) or specpower:build Phase B (inline mode) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Atomic Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

> **Step 1 MUST include both positive and negative test cases.** For each function/method:
> - Write ≥ 1 positive test (happy path), including legitimate boundary values (empty array, extreme values, large input) if the function accepts them — these are positive.
> - Write ≥ 1 negative test from these **contract-violating** categories (pick relevant ones):
>   - Invalid input (wrong type, out-of-range, malformed)
>   - null / undefined **where the contract forbids them** (NOT "empty collection" — empty is negative only if it violates the contract)
>   - Invalid state (wrong operation order, unmet precondition)
>   - Resource exhaustion to failure (timeout, disk full)
> - Target: ≥ 30% negative for side-effect functions; pure functions may be lower (15-30%) — do NOT pad by reclassifying legitimate-boundary tests as negative.
> - See `prompts/reference/specpower/negative-testing-guide.md` for the positive/negative distinction.

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Verify: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Verify: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
Verify: `git log -1 --oneline` shows the new commit
````

## Portable `Verify:` commands

A `Verify:` line is only useful if the command actually runs in the target environment and behaves the way the plan predicts. Some test-runner invocations look portable but silently change behavior across language/runtime versions — avoid those.

Concrete rules:

- **Prefer the project-declared script entry point** over ad-hoc runner invocations. If `package.json` / `pyproject.toml` / `Cargo.toml` / etc. defines a test script, use it (e.g. `npm test`, `pnpm test`, `pytest`, `cargo test`). That script is what the project's CI and the user's local environment actually run, so the `Verify:` line matches reality.
- **If you must invoke the runner directly, spell out what it discovers.** For Node.js `node:test`, `node --test test/` discovers only files matching Node's default test-file name pattern (which is version-dependent) — `node --test 'test/*.test.js'` or `node --test $(ls test/*.test.js)` is explicit. For `pytest`, prefer `pytest path/to/test.py::test_name` over `pytest` alone when you want to verify a specific new test.
- **If the project has no test script and no obvious runner, add a task to define one** before writing `Verify:` lines that depend on it.
- **Include the expected outcome anchored on observable output** — exit code, a line in stdout/stderr, a file's existence. Don't write `Verify: passes`; write `Verify: exit 0, stdout contains "15 pass 0 fail"` or `Verify: file dist/cli.js exists`.

The rule of thumb: if a fresh engineer cloned the repo, installed deps, and copy-pasted your `Verify:` line, would it reliably demonstrate the predicted outcome on their machine? If not, rewrite.

## No Placeholders (expanded)

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
  → These are NOT allowed as placeholders. The underlying concerns MUST be addressed — each error handling scenario MUST appear as an explicit test step with concrete test code and a `Verify:` line. Do not collapse multiple error scenarios into a single "handle edge cases" step; enumerate each as its own atomic test.
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task
- Commands without a `Verify:` line
- Test-runner invocations whose discovery behavior depends on the runtime version (see "Portable `Verify:` commands" above)

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output (`Verify:` line)
- 2-5 min per task, no placeholder, every `Verify:` concrete
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After completing the rewrite (before presenting the Before/After audit), look at the spec with fresh eyes and check the rewritten plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks?

**4. Verify coverage:** Does every command-running step have a `Verify:` line?

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task (or, if the task cannot be written precisely, escalate to Outcome 3 Gap Detection).

## Before/After Audit

After a successful rewrite (Outcome 1 or Outcome 2-A), present a summary to the user **before** execution handoff:

```
Rewrite summary:
  Group 1 "<name>": 3 coarse tasks → 8 atomic tasks
  Group 2 "<name>": 2 coarse tasks → 5 atomic tasks
  Group 3 "<name>": 4 coarse tasks → 11 atomic tasks
  ...
  Total: 5 → 13 atomic tasks

  Groups added: <list, or "none">
  Groups removed: <list, or "none">
  Groups renamed: <list, or "none">
```

This audit lets the user spot structural surprises (e.g., a group that exploded from 2 to 20 atomic tasks suggests it should have been split).

## Execution Handoff

After the rewrite is complete and the Before/After audit has been presented:

**"Rewrite complete and saved to `specpower/changes/<change-name>/tasks.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use specpower:build Phase B
- Fresh subagent per task + two-stage review (spec + code)

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use specpower:build Phase B (inline mode)
- Batch execution with checkpoints for review
