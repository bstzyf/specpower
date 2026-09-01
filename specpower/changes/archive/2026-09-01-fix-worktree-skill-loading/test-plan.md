# test-plan: fix-worktree-skill-loading

<!-- Cases reference spec Scenarios by name (delta or baseline); do not copy WHEN/THEN.
     Every delta Scenario MUST have >=1 Case; every failure-admitting Requirement >=1 [negative].
     Case ids are stable and change-unique; test code embeds the token [fix-worktree-skill-loading-<id>].

     This is a fix-flow change (TDD, not plan-then-build). The tests already exist
     in test/cli/sync.test.ts; this plan documents the Scenario→Case mapping so
     archive's test-plan coverage check is satisfied. The fix flow's Stage 6
     verification ran the full suite (334 passing). -->

## Capability: specpower-build

### Requirement: Worktree detection must be path-normalization-stable on Windows → Scenario: main checkout is NOT detected as a worktree (Windows path normalization)

- **Case** T1: a repo's main checkout (incl. one created under a Windows 8.3 short-name mkdtemp path) is NOT detected as a worktree [positive]
  - Input: isInsideWorktree(repoDir) where repoDir is a git-init'd mkdtemp short-name dir (the main checkout)
  - Expected: returns false
  - it(): isInsideWorktree returns false for the MAIN checkout of a repo (Windows path-normalization)
  - file: test/cli/sync.test.ts

### Requirement: Worktree detection must be path-normalization-stable on Windows → Scenario: linked worktree IS detected as a worktree

- **Case** T2: a path inside a linked git worktree IS detected as a worktree [positive]
  - Input: isInsideWorktree(worktreeDir) where worktreeDir is a `git worktree add` linked worktree
  - Expected: returns true
  - it(): isInsideWorktree returns true for a path inside a linked worktree
  - file: test/cli/sync.test.ts

### Requirement: Worktree detection must be path-normalization-stable on Windows → Scenario: non-repo directory is not a worktree

- **Case** T3: a directory outside any git repo is not a worktree [negative]
  - Input: isInsideWorktree(plainDir) where plainDir is not inside a repo
  - Expected: returns false
  - it(): isInsideWorktree returns false for a plain non-repo directory
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync resolves the tool from the existing rootDir layout, not the user config alone → Scenario: existing .cac/ root is detected and used even when user config pins another tool

- **Case** T4: resolveToolForProject picks cac when .cac/ exists, ignoring a chrys user config/env [positive]
  - Input: resolveToolForProject(repoDir) with .cac/ present and SPECPOWER_TOOL=chrys
  - Expected: returns the cac adapter
  - it(): resolveToolForProject picks the tool whose rootDir already exists
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync resolves the tool from the existing rootDir layout, not the user config alone → Scenario: fresh worktree with no rootDir inherits the tool from the main checkout

- **Case** T5: a fresh worktree with no rootDir inherits cac from the main checkout, ignoring a chrys user config/env [positive]
  - Input: resolveToolForProject(wt) where wt is a fresh linked worktree with .cac/ removed, main checkout has .cac/, env=chrys
  - Expected: returns the cac adapter
  - it(): resolveToolForProject inherits the tool from the main checkout for a fresh worktree with no rootDir
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync resolves the tool from the existing rootDir layout, not the user config alone → Scenario: no existing rootDir anywhere falls back to resolveTool

- **Case** T6: with no rootDir anywhere, resolveToolForProject falls back to the passed-in fallback tool [negative]
  - Input: resolveToolForProject(freshDir, fallbackAdapter) where freshDir has no rootDir and is not in a repo
  - Expected: returns fallbackAdapter
  - it(): resolveToolForProject falls back to the given tool when no rootDir exists
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync propagates assets into all linked git worktrees → Scenario: main-checkout sync propagates assets to linked worktrees at the correct tool root

- **Case** T7: syncing the main checkout (.cac/ layout, env=chrys) writes .cac/ skills+prompts into linked worktrees, not .agents/ [positive]
  - Input: syncAssets({ projectRoot: repoDir }) with .cac/ present, a linked worktree, env=chrys
  - Expected: res.tool==='cac'; worktree .cac/skills/specpower-verify/SKILL.md and .cac/specpower/prompts exist; worktree .agents/skills absent
  - it(): syncing the main checkout propagates assets to all linked worktrees at the correct tool root
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync propagates assets into all linked git worktrees → Scenario: sync inside a worktree does not propagate

- **Case** T8: syncing inside a linked worktree does NOT recurse-propagate [negative]
  - Input: syncAssets({ projectRoot: worktreeDir }) where worktreeDir is a linked worktree
  - Expected: completes (status 'synced') without enumerating/propagating to other worktrees
  - it(): sync inside a worktree does NOT recurse-propagate (no infinite loop)
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync propagates assets into all linked git worktrees → Scenario: propagation is best-effort across worktrees

- **Case** T9: listLinkedWorktrees returns [] outside a git repo (no propagation, no throw) [negative]
  - Input: listLinkedWorktrees(nonExistentDir)
  - Expected: returns []
  - it(): listLinkedWorktrees is empty outside a git repo
  - file: test/cli/sync.test.ts

### Requirement: Project-scope sync propagates assets into all linked git worktrees → Scenario: (listLinkedWorktrees enumeration)

- **Case** T10: listLinkedWorktrees enumerates linked worktrees, excluding the main checkout [positive]
  - Input: listLinkedWorktrees(repoDir) after `git worktree add` of two worktrees
  - Expected: returns exactly the two linked worktree paths (not the main checkout)
  - it(): listLinkedWorktrees enumerates linked worktrees but not the main checkout
  - file: test/cli/sync.test.ts
