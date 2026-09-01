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

### Requirement: Build prompts for execution mode at build start (Stage 0)
At `/specpower:build` start — before Phase A — the controller SHALL determine and record the execution mode (Subagent-Driven vs Inline Execution). When no mode is recorded, the controller SHALL present both options and ask the user to choose (no silent default), then persist the choice. The mode choice is owned by Stage 0 of `specpower-build/SKILL.md`; Phase A's Execution Handoff SHALL NOT present this choice.

**Delivery:** Stage 0 reads the recorded mode via `specpower change mode <name>`. If set, it resumes that mode without re-asking. If unset, it presents Subagent-Driven (recommended) and Inline Execution, asks the user, and records the choice via `specpower change mode <name> --set <value>`. The controller SHALL NOT proceed to Phase A until a mode is recorded.

#### Scenario: Stage 0 presents both execution modes when mode is unset
- **WHEN** `/specpower:build` starts and `executionMode` is unset in `.specpower.yaml`
- **THEN** the controller SHALL present Subagent-Driven and Inline Execution as the two options

#### Scenario: Stage 0 resumes a recorded mode without re-asking
- **WHEN** `/specpower:build` starts and `executionMode` is already recorded in `.specpower.yaml`
- **THEN** the controller SHALL use the recorded mode

#### Scenario: Phase A Execution Handoff defers the mode choice to Stage 0
- **WHEN** Phase A completes the rewrite and presents the Before/After audit
- **THEN** `phase-a-plan.md`'s Execution Handoff SHALL present the rewrite for confirmation only

### Requirement: Execution mode persists in .specpower.yaml across interruption and restart
The execution mode decision SHALL be stored in the change's `.specpower.yaml` under an `executionMode` field whose value is one of `subagent` | `inline`. The field is optional (absent means "not yet chosen"). Setting it SHALL preserve all other metadata fields (schema, created, phase). An invalid value SHALL be rejected both on write (by the `change mode --set` command) and on read (by the metadata zod schema). Backward compatibility: changes created before this field existed (no `executionMode` key) SHALL read as unset, not error.

**Delivery:** `ChangeMetadata` gains an optional `executionMode: 'subagent' | 'inline'` field validated by the zod schema (passthrough preserves other fields). `updateExecutionMode` in `change-utils.ts` spreads existing metadata so phase/created/schema survive. The `specpower change mode <name> [--set <value>]` CLI command reads/writes it.

#### Scenario: setExecutionMode records the mode and preserves other fields
- **WHEN** `setExecutionMode(name, 'inline', root)` is called on a change with existing schema/created/phase
- **THEN** `.specpower.yaml` SHALL contain `executionMode: inline`

#### Scenario: getExecutionMode reads the recorded value
- **WHEN** `.specpower.yaml` contains `executionMode: subagent`
- **THEN** `getExecutionMode(name, root)` SHALL return `'subagent'`

#### Scenario: getExecutionMode returns undefined when unset (backward compat)
- **WHEN** `.specpower.yaml` has no `executionMode` key (pre-existing change)
- **THEN** `getExecutionMode(name, root)` SHALL return `undefined`

#### Scenario: setExecutionMode is idempotent (resume survives restart)
- **WHEN** `setExecutionMode` is called with the same value already recorded
- **THEN** the field SHALL remain that value

#### Scenario: invalid executionMode is rejected on set
- **WHEN** `setExecutionMode(name, 'parallel', root)` is called with a value not in {subagent, inline}
- **THEN** the call SHALL throw an error listing `subagent` and `inline` as valid values

#### Scenario: invalid executionMode is rejected on read
- **WHEN** `.specpower.yaml` contains `executionMode: parallel` (hand-edited corruption)
- **THEN** `readChangeMetadata` / `getExecutionMode` SHALL throw

### Requirement: Phase B hard-gates on a recorded execution mode
Phase B SHALL verify a recorded `executionMode` exists before any task runs. This guards against an interrupted/restarted build that skipped Stage 0, or a hand-edited `.specpower.yaml`. If a mode is recorded, Phase B SHALL route to the matching path (subagent path or inline path). If unset, Phase B SHALL STOP and run Stage 0 (prompt + record) before proceeding — it SHALL NOT silently default.

**Delivery:** Stage B0 (Execution Mode Hard Gate) in `specpower-build/SKILL.md` reads `specpower change mode <name>` at Phase B entry. The subagent path uses `.claude/specpower/prompts/build/phase-b-execute.md` + `phase-b-review.md`; the inline path uses `.claude/specpower/prompts/shared/executing-plans.md`. Stage B1 worktree setup is common to both paths.

#### Scenario: Phase B hard gate runs Stage 0 when mode is missing
- **WHEN** Phase B is entered and `executionMode` is unset in `.specpower.yaml`
- **THEN** the controller SHALL STOP and run Stage 0 (present choice, record)

#### Scenario: Phase B routes to the subagent path when mode is subagent
- **WHEN** Phase B is entered and `executionMode` is `subagent`
- **THEN** the controller SHALL follow the subagent path (fresh implementer subagent per task via `phase-b-execute.md`, two-stage review via `phase-b-review.md`)

#### Scenario: Phase B routes to the inline path when mode is inline
- **WHEN** Phase B is entered and `executionMode` is `inline`
- **THEN** the controller SHALL follow the inline path by reading `.claude/specpower/prompts/shared/executing-plans.md`

#### Scenario: worktree setup is common to both execution paths
- **WHEN** either Phase B path begins
- **THEN** Stage B1 worktree setup SHALL run regardless of the chosen mode (isolated workspace setup is mode-independent)

### Requirement: Worktree detection must be path-normalization-stable on Windows
`isInsideWorktree` (used by `specpower sync` to decide whether to stamp the `version:` line of `specpower/config.yaml`) SHALL correctly distinguish a **linked git worktree** from the **main checkout** on every platform, including Windows.

The detection SHALL compare two git-emitted paths (`git rev-parse --git-dir` vs `git rev-parse --git-common-dir`) rather than comparing a Node-resolved path against `git rev-parse --show-toplevel`. Both compared paths SHALL be made absolute against the probed `cwd` and normalized to a common separator + case form before comparison, so that:

- the main checkout reads as **not a worktree** (`--git-dir` and `--git-common-dir` both resolve to the same `.git`), and
- a linked worktree reads as **a worktree** (the two differ).

This is required because the previous implementation compared `dirname(resolve(cwd, --git-common-dir))` against `--show-toplevel`, which is unreliable on Windows for two independent reasons: (1) `resolve()` yields backslash paths while `--show-toplevel` emits forward slashes, and (2) `fs.mkdtemp` returns 8.3 short-name paths (e.g. `C:\Users\LIANGK~1\...`) that `--show-toplevel` reports as long names (e.g. `C:/Users/liangkongrong/...`), and `fs.realpathSync` does not reliably expand short names — so the two compared strings never matched even in the main checkout, causing the main checkout to be **mis-detected as a worktree** and `specpower sync` to skip `stampVersionInConfig` against the main checkout. Comparing two git outputs that both undergo the identical `resolve(cwd, p)` + separator/case normalization eliminates both divergence sources.

#### Scenario: main checkout is NOT detected as a worktree (Windows path normalization)
- **WHEN** `isInsideWorktree` is called with the cwd of a repository's **main checkout** (including a repo created under a Windows 8.3 short-name temp path produced by `fs.mkdtemp`)
- **THEN** it SHALL return `false` (the main checkout is not a linked worktree)

#### Scenario: linked worktree IS detected as a worktree
- **WHEN** `isInsideWorktree` is called with a path inside a linked git worktree (created via `git worktree add`)
- **THEN** it SHALL return `true`

#### Scenario: non-repo directory is not a worktree
- **WHEN** `isInsideWorktree` is called with a directory that is not inside any git repository
- **THEN** it SHALL return `false`

#### Scenario: sync in main checkout stamps config.yaml version
- **WHEN** `specpower sync` runs against the main checkout (not a worktree)
- **THEN** it SHALL stamp the installed version into `specpower/config.yaml` (the main checkout is no longer mis-detected as a worktree that skips the stamp)

### Requirement: Project-scope sync resolves the tool from the existing rootDir layout, not the user config alone
When `specpower sync` runs in **project scope**, the active tool SHALL be resolved by detecting which tool's `<rootDir>` (`<projectRoot>/.claude` | `.cac` | `.agents` | `.opencode`) already exists on disk, falling back to `resolveTool` (env `SPECPOWER_TOOL` → user config → claude default) only when no `<rootDir>` exists. An explicit tool override passed by the caller (worktree propagation) SHALL take precedence.

When the project root is a **linked git worktree** with no `<rootDir>` of its own (a fresh worktree whose regenerated assets are untracked and therefore absent), the fallback SHALL first inspect the **main checkout** (derivable via `git rev-parse --git-common-dir`, whose parent is the main checkout root, shared across linked worktrees) for an existing `<rootDir>`, inheriting that tool. Only when neither the worktree nor the main checkout has a `<rootDir>` does it fall back to `resolveTool` / the caller's fallback. This covers build's worktree-setup step 3.5 running `specpower sync` inside a fresh worktree: it must inherit the project's actual tool from the main checkout rather than a mismatched user config.

This is required because resolving the tool via `resolveTool` alone honors the persisted user config / env, which may pin a tool that differs from the tool layout the project actually uses (e.g. user config pins `chrys` → writes `.agents/`, but the project uses `cac` → expects `.cac/`). When that mismatch occurs, sync writes to the wrong tool root and the host Skill tool finds no `specpower-*` skills there — manifesting as "Skill 工具无法加载 specpower-verify". Detecting the existing `<rootDir>` (locally, then at the main checkout) makes sync align with the layout the project actually uses.

#### Scenario: existing .cac/ root is detected and used even when user config pins another tool
- **WHEN** `specpower sync` runs in project scope where `<projectRoot>/.cac/` already exists, but the user config (or `SPECPOWER_TOOL`) pins a different tool (e.g. `chrys`)
- **THEN** sync SHALL write assets under `.cac/` (tool `cac`), NOT under the user-config tool's root

#### Scenario: fresh worktree with no rootDir inherits the tool from the main checkout
- **WHEN** `specpower sync` runs in project scope inside a linked worktree that has no `<rootDir>` of its own, but the main checkout (shared `.git`) has an existing `.cac/`, and the user config pins `chrys`
- **THEN** sync SHALL resolve the tool as `cac` (inherited from the main checkout) and write assets under the worktree's `.cac/`, NOT under `.agents/`

#### Scenario: no existing rootDir anywhere falls back to resolveTool
- **WHEN** `specpower sync` runs in project scope and no `<rootDir>` exists on disk in the project root or its main checkout
- **THEN** sync SHALL use `resolveTool` (env → user config → claude default) to pick the tool

### Requirement: Project-scope sync propagates assets into all linked git worktrees
After a successful **project-scope** sync of the **main checkout** (not a worktree), `specpower sync` SHALL propagate the regenerated assets (skills, commands, prompts, schemas, templates, custom) into **every linked git worktree** of the repository, enumerated via `git worktree list --porcelain` (excluding the main checkout entry).

Each worktree SHALL resolve its tool the same way as the main checkout (detect the existing `<rootDir>`), falling back to the **main checkout's resolved tool** when the worktree has no `<rootDir>` of its own (a fresh worktree). This makes worktree asset regeneration **deterministic and shell-independent** — it no longer relies on a POSIX bash guard in build's worktree setup (`phase-b-worktree.md` step "Regenerate specpower assets"), which is unreliable on Windows (the `specpower` executable is an npm `.cmd`/`.ps1` shim and the executing shell may not be a POSIX bash, so the `if [ -f … ]; then specpower sync; fi` guard silently fails and leaves the worktree's tool root empty).

Propagation SHALL be **best-effort and non-recursive**: a single failed worktree (e.g. its directory was removed mid-run) is reported on stdout but does not abort the overall sync, and the per-worktree syncs SHALL NOT re-propagate (no infinite loop). A sync invoked **inside** a linked worktree SHALL NOT propagate (only a main-checkout sync propagates).

#### Scenario: main-checkout sync propagates assets to linked worktrees at the correct tool root
- **WHEN** `specpower sync` runs against the main checkout of a project that has one or more linked git worktrees
- **THEN** each linked worktree SHALL receive the regenerated assets at the worktree's detected `<rootDir>` (e.g. `.cac/` for a cac project), including `<rootDir>/skills/specpower-verify/SKILL.md` and `<rootDir>/specpower/prompts/`

#### Scenario: a fresh worktree (no rootDir) inherits the main checkout's tool
- **WHEN** a linked worktree has no `<rootDir>` on disk yet (fresh worktree) and the main checkout was synced with tool `cac`
- **THEN** propagation SHALL write assets to the worktree's `.cac/` (inheriting the main checkout's resolved tool), not to the user-config tool's root

#### Scenario: sync inside a worktree does not propagate
- **WHEN** `specpower sync` runs with `projectRoot` inside a linked git worktree (not the main checkout)
- **THEN** it SHALL sync that worktree in place and SHALL NOT enumerate/propagate to other worktrees (no recursion)

#### Scenario: propagation is best-effort across worktrees
- **WHEN** one linked worktree's directory is missing or unreadable during propagation
- **THEN** the main-checkout sync SHALL still succeed, the failed worktree is reported on stdout, and the remaining worktrees are still propagated
