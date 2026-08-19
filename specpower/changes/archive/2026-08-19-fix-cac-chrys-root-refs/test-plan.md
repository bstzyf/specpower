# test-plan: fix-cac-chrys-root-refs

<!-- Cases reference spec Scenarios by name (delta or baseline); do not copy WHEN/THEN.
     Every delta Scenario MUST have >=1 Case; every failure-admitting Requirement >=1 [negative].
     Case ids are stable and change-unique; test code embeds the token [fix-cac-chrys-root-refs-<id>].

     This change dogfoods specpower's own tool-adapter pipeline: the Cases below
     are backed by real unit/integration tests in test/core/tools/adapters.test.ts,
     test/cli/sync.test.ts, and test/cli/custom-bake.test.ts. -->

## Capability: tool-adapters

### Requirement: Tool-root-aware path rewriting in generated assets → Scenario: cac project skill rewrites every .claude/ form to .cac/

- **Case** T1: a cac-project skill rewrites all .claude/ forms (prompts/schemas/templates subtrees, skills/, commands/, bare) to .cac/ with zero .claude/ left [positive]
  - Input: getToolAdapter('cac').transformSkill on a body exercising every ref form, projectCtx
  - Expected: output contains .cac/specpower/{prompts,schemas,templates}/, .cac/skills/, .cac/commands/, and no .claude/
  - it(): cac project rewrites every .claude/ form -> .cac/ (zero .claude/ left)
  - file: test/core/tools/adapters.test.ts

### Requirement: Tool-root-aware path rewriting in generated assets → Scenario: chrys project skill rewrites every .claude/ form to .agents/

- **Case** T2: a chrys-project skill rewrites every .claude/ form to .agents/ with zero .claude/ left [positive]
  - Input: getToolAdapter('chrys').transformSkill on the full-ref body, projectCtx
  - Expected: output contains .agents/specpower/..., .agents/skills/, .agents/commands/, and no .claude/
  - it(): chrys project rewrites every .claude/ form -> .agents/
  - file: test/core/tools/adapters.test.ts

### Requirement: Tool-root-aware path rewriting in generated assets → Scenario: opencode project maps skills/commands to agent/command (flat layout)

- **Case** T3: an opencode-project skill maps .claude/skills/ -> .opencode/agent/ and .claude/commands/ -> .opencode/command/, and rewrites the specpower subtree to .opencode/specpower/ [positive]
  - Input: getToolAdapter('opencode').transformSkill on the full-ref body, projectCtx
  - Expected: output contains .opencode/agent/ and .opencode/command/; not .claude/skills/ or .claude/commands/
  - it(): opencode project maps .claude/skills -> .opencode/agent, commands -> .opencode/command
  - file: test/core/tools/adapters.test.ts

### Requirement: Tool-root-aware path rewriting in generated assets → Scenario: claude project is byte-identical to source (no-op)

- **Case** T4: a claude-project skill is byte-identical to the source across all ref forms (no-op rewrite) [positive]
  - Input: getToolAdapter('claude').transformSkill on the full-ref body, projectCtx
  - Expected: output === source
  - it(): claude project = byte-identical passthrough for ALL ref forms
  - file: test/core/tools/adapters.test.ts

### Requirement: Tool-root-aware path rewriting in generated assets → Scenario: user scope rewrites specpower subtree to the package, skills/commands to rootDir

- **Case** T5: a cac user-scope skill rewrites the specpower subtree to <packageRoot>/ and skills/commands to .cac/ (not package) [positive]
  - Input: getToolAdapter('cac').transformSkill on the full-ref body, userCtx('C:\\pkg\\specpower')
  - Expected: output contains C:/pkg/specpower/{prompts,schemas,templates}/ and .cac/skills/ + .cac/commands/, no .claude/
  - it(): user scope: specpower subtree -> package; skills/commands -> rootDir (nested)
  - file: test/core/tools/adapters.test.ts

### Requirement: Prompt files are transformed (not copied verbatim) during init/sync → Scenario: cac project cross-prompt references rewritten

- **Case** T6: a cac project sync copies prompts with cross-prompt refs rewritten to .cac/ and zero stray .claude/ [positive]
  - Input: syncAssets({projectRoot:tmpDir}) with SPECPOWER_TOOL=cac
  - Expected: copied phase-b-execute.md contains .cac/specpower/prompts/shared/implementer-prompt.md and no .claude/
  - it(): cac: copied prompts reference .cac/ (no stray .claude/) and bake [CONTROLLER: placeholders
  - file: test/cli/sync.test.ts

### Requirement: Prompt files are transformed (not copied verbatim) during init/sync → Scenario: schemas/templates references in prompts are rewritten

- **Case** T7: a cac project sync rewrites .claude/specpower/schemas/ and /templates/ refs in phase-b-worktree.md to .cac/ [positive]
  - Input: syncAssets with SPECPOWER_TOOL=cac, read copied phase-b-worktree.md
  - Expected: contains .cac/specpower/schemas/ and .cac/specpower/templates/, no .claude/
  - it(): (covered by the cac prompts-rewrite test in test/cli/sync.test.ts)
  - file: test/cli/sync.test.ts

### Requirement: Custom-rule placeholder baking is root-aware → Scenario: cac project bakes [CONTROLLER: placeholders under .cac/

- **Case** T8: a cac project sync bakes the [CONTROLLER: placeholder in .cac/specpower/prompts/shared/implementer-prompt.md to the package coding rules [positive]
  - Input: syncAssets with SPECPOWER_TOOL=cac (package ships custom/coding/coding-standards.md)
  - Expected: copied implementer-prompt.md has no whole-line [CONTROLLER: placeholder and contains 'Coding Standards'
  - it(): cac: copied prompts reference .cac/ (no stray .claude/) and bake [CONTROLLER: placeholders
  - file: test/cli/sync.test.ts

### Requirement: Custom-rule placeholder baking is root-aware → Scenario: chrys project bakes [CONTROLLER: placeholders under .agents/

- **Case** T9: a chrys project sync bakes the [CONTROLLER: placeholder in .agents/specpower/prompts/shared/implementer-prompt.md [positive]
  - Input: syncAssets with SPECPOWER_TOOL=chrys
  - Expected: copied implementer-prompt.md has no whole-line [CONTROLLER: placeholder
  - it(): chrys: copied prompts reference .agents/ and bake placeholders
  - file: test/cli/sync.test.ts

### Requirement: Custom-rule placeholder baking is root-aware → Scenario: omitted root dir defaults to .claude (back-compat)

- **Case** T10: bakeCustomIncludes(dir) with no rootDir bakes the placeholder in .claude/specpower/prompts/... (legacy default preserved) [positive]
  - Input: bakeCustomIncludes(dir) on a tree with .claude/specpower/prompts/shared/implementer-prompt.md carrying [CONTROLLER:
  - Expected: placeholder replaced with custom rule text
  - it(): defaults to .claude root when rootDir is omitted (back-compat)
  - file: test/cli/custom-bake.test.ts

- **Case** T11: bakeCustomIncludes(dir, '.cac') bakes the placeholder in .cac/specpower/prompts/... (non-claude root) [positive]
  - Input: bakeCustomIncludes(dir, '.cac') on a tree with .cac/specpower/prompts/shared/implementer-prompt.md carrying [CONTROLLER:
  - Expected: placeholder replaced with custom rule text; the .cac/ copy (not .claude/) is the one baked
  - it(): bakes [CONTROLLER: placeholders into a non-claude root (.cac) when rootDir is passed
  - file: test/cli/custom-bake.test.ts

### Requirement: Vendored third-party reference docs are excluded from root rewriting → Scenario: vendored superpowers doc keeps ~/.claude/skills for cac

- **Case** T12: a cac project sync copies reference/superpowers/writing-skills.md verbatim, keeping the literal ~/.claude/skills (not rewritten to ~/.cac/skills) [negative]
  - Input: syncAssets with SPECPOWER_TOOL=cac, read copied reference/superpowers/writing-skills.md
  - Expected: contains '~/.claude/skills' and does NOT contain '~/.cac/skills'
  - it(): cac: vendored reference/superpowers/ docs are NOT rewritten (third-party Claude Code conventions)
  - file: test/cli/sync.test.ts
