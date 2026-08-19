## ADDED Requirements

### Requirement: Custom coding standards overlay in build
The build's implementer subagent SHALL follow project-defined coding rules in `specpower/custom/coding/` (all top-level `.md` files, sorted lexicographically by filename) as an additional dimension layered on top of the built-in checklist. These rules are project-specific and override general best-practice advice for project conventions (naming, structure, style); built-in safety/correctness rules always apply.

**Delivery:** the implementer subagent SHALL NOT read `specpower/custom/coding/` itself, and the controller SHALL NOT fill the placeholder at runtime. At `specpower init`/`sync` time, the system SHALL read the top-level `.md` files and replace the `Project Coding Standards (controller-inlined)` placeholder in `prompts/shared/implementer-prompt.md` with their concatenated contents. The implementer therefore receives the rules as inline text in the baked prompt, conforming to "provide full text, never make a subagent read files" — this also avoids the worktree-absence failure (gitignored `specpower/custom/` is not in a fresh worktree; worktree setup runs `specpower sync` to regenerate the baked prompt).

#### Scenario: sync bakes coding rules into implementer-prompt.md
- **WHEN** `specpower/custom/coding/` exists and contains `.md` files
- **AND** `specpower init`/`sync` runs (project scope)
- **THEN** the system SHALL read all top-level `.md` files (sorted lexicographically by filename; subdirectories and non-`.md` files ignored)
- **AND** SHALL replace the `Project Coding Standards (controller-inlined)` placeholder in `prompts/shared/implementer-prompt.md` with their concatenated contents
- **AND** when an implementer subagent is later dispatched during `/specpower:build` Phase B or `/specpower:fix`, the implementer SHALL follow their conventions for naming, structure, patterns, and style (received as inline text in the baked prompt)
- **AND** its Self-Review SHALL include a check that the implementation conforms to the pasted Project Coding Standards

#### Scenario: sync writes explicit none when coding rules absent
- **WHEN** `specpower/custom/coding/` does not exist or has no `.md` files
- **AND** `specpower init`/`sync` runs
- **THEN** the system SHALL write the literal `none` into the placeholder (not blank, not skipped)
- **AND** the implementer SHALL NOT raise any error and SHALL proceed with the built-in implementer prompt and existing codebase patterns only

#### Scenario: Rule conflicts with task spec raised as concern
- **WHEN** a custom coding rule conflicts with the task spec or plan
- **THEN** the implementer SHALL NOT silently ignore either
- **AND** SHALL report the conflict as a concern (DONE_WITH_CONCERNS) so the user can resolve it, rather than picking one side unilaterally

### Requirement: Worktree regenerates gitignored specpower assets
During `/specpower:build` Phase B worktree setup, the system SHALL regenerate specpower's gitignored assets (`specpower/custom/`, `.claude/specpower/prompts/`, `schemas/`, `templates/`) inside the worktree by running `specpower sync` there, because a fresh git worktree contains only tracked files and would otherwise lack these assets — causing the controller to fail reading its own prompts and custom rules. This step SHALL run only when `specpower/config.yaml` exists (the project is a specpower project) and the `specpower` CLI is on PATH; otherwise it is skipped silently.

#### Scenario: Worktree setup runs specpower sync
- **WHEN** `/specpower:build` Phase B creates a git worktree for implementation
- **AND** `specpower/config.yaml` exists and `specpower` is on PATH
- **THEN** the worktree setup SHALL run `specpower sync` inside the worktree
- **AND** the worktree SHALL contain `specpower/custom/` and `.claude/specpower/prompts/` after setup
- **AND** the controller SHALL be able to read its prompts and custom rules from the worktree cwd

#### Scenario: Fresh worktree lacks gitignored assets until synced
- **WHEN** a git worktree is created in a specpower project (before any sync)
- **THEN** the worktree SHALL NOT contain `specpower/custom/` or `.claude/specpower/prompts/` (they are gitignored)
- **AND** this is the rationale for the sync step above

#### Scenario: Non-specpower project skips sync in worktree
- **WHEN** the worktree project has no `specpower/config.yaml`
- **THEN** the setup SHALL skip the `specpower sync` step silently
- **AND** SHALL NOT error

#### Scenario: specpower CLI missing from PATH skips sync silently
- **WHEN** `specpower/config.yaml` exists in the worktree but the `specpower` CLI is not on PATH
- **THEN** the setup SHALL skip the sync step silently (the `command -v specpower` guard fails)
- **AND** SHALL NOT error during setup
- **AND** the controller MAY later fail to read prompts/custom at first use, surfacing the misconfiguration when it actually matters

#### Scenario: Worktree sync does not stamp config.yaml version
- **WHEN** `specpower sync` runs inside a worktree (worktree setup, per the requirement above)
- **THEN** the sync SHALL regenerate gitignored assets (custom/, prompts/, schemas/, templates/) but SHALL NOT stamp the `version:` line of the worktree's `specpower/config.yaml`
- **AND** the worktree's git diff SHALL NOT show a `config.yaml` version-line change attributable to the sync step
- **AND** the worktree's config version stays aligned with the main project (the worktree is a transient implementation environment, not a version source)
