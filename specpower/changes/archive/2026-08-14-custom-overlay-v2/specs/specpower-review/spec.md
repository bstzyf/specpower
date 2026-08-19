## ADDED Requirements

### Requirement: Spec-aware code review
The system SHALL perform code review that checks both code quality and regression against main openspec/specs/ baseline. When the project defines custom review rules in `specpower/custom/review/`, the review SHALL also apply them as an additional, layered dimension on top of the built-in checklist.

**Custom rule delivery:** the code-reviewer subagent SHALL NOT read `specpower/custom/review/` itself, and the controller SHALL NOT fill the placeholder at runtime. At `specpower init`/`sync` time, the system SHALL read the top-level `.md` files and replace the `Custom Standards` placeholder in `prompts/shared/code-reviewer-prompt.md` (and `prompts/review/code-review.md`) with their concatenated contents. The reviewer therefore receives the rules as inline text in the baked prompt, conforming to "provide full text, never make a subagent read files"; also avoids worktree absence (worktree setup runs `specpower sync` to regenerate the baked prompt).

#### Scenario: Review with regression checking
- **WHEN** user runs `/specpower:review` on a change
- **THEN** the system dispatches a code-reviewer subagent that evaluates code quality AND checks for regressions against main specs

#### Scenario: Severity-based triage
- **WHEN** review findings are generated
- **THEN** each finding SHALL be classified as Critical (blocks merge), Warning (should fix), or Info (minor improvement)

#### Scenario: Critical issue blocking
- **WHEN** a Critical finding is identified
- **THEN** the system SHALL block merge and enter a fix-review loop until the critical issue is resolved

#### Scenario: sync bakes custom review rules into code-reviewer-prompt.md
- **WHEN** `specpower/custom/review/` exists and contains `.md` files
- **AND** `specpower init`/`sync` runs (project scope)
- **THEN** the system SHALL read all top-level `.md` files (sorted lexicographically by filename; subdirectories and non-`.md` files ignored)
- **AND** SHALL replace the `Custom Standards` placeholder in `prompts/shared/code-reviewer-prompt.md` (and `prompts/review/code-review.md`) with their concatenated contents
- **AND** when a code-reviewer subagent is later dispatched during `/specpower:review`, the reviewer SHALL apply each rule as an additional review dimension (received as inline text in the baked prompt)
- **AND** SHALL flag violations at the severity each rule specifies, defaulting to Important
- **AND** the built-in checklist remains in effect (custom rules layer on top, not replace)

#### Scenario: sync writes explicit none when review rules absent
- **WHEN** `specpower/custom/review/` does not exist or has no `.md` files
- **AND** `specpower init`/`sync` runs
- **THEN** the system SHALL write the literal `none` into the placeholder (not blank, not skipped)
- **AND** the reviewer SHALL NOT raise any error and SHALL proceed with the built-in checklist only

#### Scenario: Custom rule cannot relax built-in safety/correctness checks
- **WHEN** a custom review rule would suppress or relax a built-in safety/correctness check (e.g. permit a forbidden pattern)
- **THEN** the built-in safety/correctness check SHALL still apply regardless of the custom rule
- **AND** the reviewer SHALL flag the violation per the built-in rule, not suppress it per the custom rule
- **AND** custom rules SHALL only override project-convention guidance (naming, structure, style), never safety/correctness
