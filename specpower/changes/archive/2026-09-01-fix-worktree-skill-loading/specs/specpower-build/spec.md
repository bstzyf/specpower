## ADDED Requirements

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
