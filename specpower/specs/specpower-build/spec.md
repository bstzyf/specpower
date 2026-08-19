### Requirement: Custom coding standards overlay in build
The build's implementer subagent SHALL follow project-defined coding rules in `specpower/custom/coding/` (all top-level `.md` files, sorted lexicographically by filename) as an additional dimension layered on top of the built-in checklist. These rules are project-specific and override general best-practice advice for project conventions (naming, structure, style); built-in safety/correctness rules always apply.

**Delivery:** the implementer subagent SHALL NOT read `specpower/custom/coding/` itself, and the controller SHALL NOT fill the placeholder at runtime. At `specpower init`/`sync` time, the system SHALL read the top-level `.md` files and replace the `Project Coding Standards (controller-inlined)` placeholder in `prompts/shared/implementer-prompt.md` with their concatenated contents. The implementer therefore receives the rules as inline text in the baked prompt, conforming to "provide full text, never make a subagent read files" — this also avoids the worktree-absence failure (gitignored `specpower/custom/` is not in a fresh worktree; worktree setup runs `specpower sync` to regenerate the baked prompt).

#### Scenario: sync bakes coding rules into implementer-prompt.md
- **WHEN** `specpower/custom/coding/` exists and contains `.md` files
- **THEN** the system SHALL read all top-level `.md` files (sorted lexicographically by filename; subdirectories and non-`.md` files ignored)

#### Scenario: sync writes explicit none when coding rules absent
- **WHEN** `specpower/custom/coding/` does not exist or has no `.md` files
- **THEN** the system SHALL write the literal `none` into the placeholder (not blank, not skipped)

#### Scenario: Rule conflicts with task spec raised as concern
- **WHEN** a custom coding rule conflicts with the task spec or plan
- **THEN** the implementer SHALL NOT silently ignore either

### Requirement: Worktree regenerates gitignored specpower assets
During `/specpower:build` Phase B worktree setup, the system SHALL regenerate specpower's gitignored assets (`specpower/custom/`, `.claude/specpower/prompts/`, `schemas/`, `templates/`) inside the worktree by running `specpower sync` there, because a fresh git worktree contains only tracked files and would otherwise lack these assets — causing the controller to fail reading its own prompts and custom rules. This step SHALL run only when `specpower/config.yaml` exists (the project is a specpower project) and the `specpower` CLI is on PATH; otherwise it is skipped silently.

#### Scenario: Worktree setup runs specpower sync
- **WHEN** `/specpower:build` Phase B creates a git worktree for implementation
- **THEN** the worktree setup SHALL run `specpower sync` inside the worktree

#### Scenario: Fresh worktree lacks gitignored assets until synced
- **WHEN** a git worktree is created in a specpower project (before any sync)
- **THEN** the worktree SHALL NOT contain `specpower/custom/` or `.claude/specpower/prompts/` (they are gitignored)

#### Scenario: Non-specpower project skips sync in worktree
- **WHEN** the worktree project has no `specpower/config.yaml`
- **THEN** the setup SHALL skip the `specpower sync` step silently

#### Scenario: specpower CLI missing from PATH skips sync silently
- **WHEN** `specpower/config.yaml` exists in the worktree but the `specpower` CLI is not on PATH
- **THEN** the setup SHALL skip the sync step silently (the `command -v specpower` guard fails)

#### Scenario: Worktree sync does not stamp config.yaml version
- **WHEN** `specpower sync` runs inside a worktree (worktree setup, per the requirement above)
- **THEN** the sync SHALL regenerate gitignored assets (custom/, prompts/, schemas/, templates/) but SHALL NOT stamp the `version:` line of the worktree's `specpower/config.yaml`
