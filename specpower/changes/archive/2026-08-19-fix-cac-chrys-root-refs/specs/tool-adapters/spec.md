## ADDED Requirements

### Requirement: Tool-root-aware path rewriting in generated assets
specpower supports multiple target tools whose root directory differs from the default `.claude/` — `cac` (`.cac/`), `chrys` (`.agents/`), and `opencode` (`.opencode/`, flat `agent/`+`command/`). When `specpower init`/`sync` emits a project whose active tool is not `claude`, every specpower-owned `.claude/` path reference shipped in skills AND prompts SHALL be rewritten to the active tool's root, so generated files never point at the (non-existent) `.claude/` root. The rewrite SHALL cover every reference form, not only `.claude/specpower/prompts/`:

- the `.claude/specpower/` subtree (`prompts/`, `schemas/`, `templates/`) — uniform across all tools: project scope → `<rootDir>/specpower/...`, user scope → `<packageRoot>/...` (prompts/schemas/templates are sourced from the package per-user);
- `.claude/skills/` and `.claude/commands/` — layout-aware: nested tools (claude/cac/chrys) keep `skills/`+`commands/` under the root; flat opencode maps them to `agent/`+`command/`;
- any remaining bare `.claude/` (descriptive, e.g. tree nodes in the archived design doc) → `<rootDir>/`.

For `claude` (the default), `<rootDir>` equals `.claude`, so the rewrite is a no-op and generated content is byte-identical to the source (back-compat). The rewrite MUST NOT touch `specpower/custom/` references (project-cwd-relative, tool-agnostic — the load-bearing D10 property).

#### Scenario: cac project skill rewrites every .claude/ form to .cac/
- **WHEN** a skill is emitted with the active tool `cac` (project scope)
- **THEN** the generated SKILL.md contains zero `.claude/` references
- **AND** `.claude/specpower/prompts/`, `.claude/specpower/schemas/`, `.claude/specpower/templates/`, `.claude/skills/`, `.claude/commands/`, and bare `.claude/` are all rewritten to their `.cac/` equivalents

#### Scenario: chrys project skill rewrites every .claude/ form to .agents/
- **WHEN** a skill is emitted with the active tool `chrys` (project scope)
- **THEN** the generated SKILL.md contains zero `.claude/` references and all forms are rewritten to their `.agents/` equivalents

#### Scenario: opencode project maps skills/commands to agent/command (flat layout)
- **WHEN** a skill is emitted with the active tool `opencode` (project scope)
- **THEN** `.claude/skills/` is rewritten to `.opencode/agent/` and `.claude/commands/` to `.opencode/command/`
- **AND** the `.claude/specpower/` subtree is rewritten to `.opencode/specpower/`

#### Scenario: claude project is byte-identical to source (no-op)
- **WHEN** a skill is emitted with the active tool `claude` (project scope)
- **THEN** the generated SKILL.md is byte-identical to the source SKILL.md (the rewrite is a no-op because rootDir == source root)

#### Scenario: user scope rewrites specpower subtree to the package, skills/commands to rootDir
- **WHEN** a skill is emitted for user scope (any tool)
- **THEN** `.claude/specpower/{prompts,schemas,templates}/` references are rewritten to the installed `<packageRoot>/`
- **AND** `.claude/skills/` and `.claude/commands/` are rewritten to `<rootDir>/skills/` (resp. `/commands/`) because skills+commands are written per-user under `~/.<rootDir>`

### Requirement: Prompt files are transformed (not copied verbatim) during init/sync
Prompt files reference each other via `.claude/specpower/prompts/...` (e.g. Phase B "Read `.claude/specpower/prompts/shared/implementer-prompt.md`"). Because prompts are copied into the active tool's root, copying them verbatim would leave cross-prompt references pointing at the wrong (`.claude/`) root for cac/chrys/opencode. `copyPrompts` SHALL therefore transform each copied prompt file through the same tool-root-aware rewrite as skills (project scope), so cross-prompt "Read ..." instructions resolve under the project's actual root.

#### Scenario: cac project cross-prompt references rewritten
- **WHEN** `specpower init`/`sync` runs with the active tool `cac` (project scope)
- **THEN** the copied `prompts/build/phase-b-execute.md` references `.cac/specpower/prompts/shared/implementer-prompt.md` (not `.claude/`)
- **AND** no copied prompt file outside `reference/superpowers/` contains a `.claude/` reference

#### Scenario: schemas/templates references in prompts are rewritten
- **WHEN** `specpower init`/`sync` runs with the active tool `cac` (project scope)
- **THEN** `prompts/build/phase-b-worktree.md` references `.cac/specpower/schemas/` and `.cac/specpower/templates/` (not `.claude/`)

### Requirement: Custom-rule placeholder baking is root-aware
`bakePrompts` reads/writes the 4 prompt copies that carry `[CONTROLLER: ...]` placeholders. These copies live under the active tool's root (`<rootDir>/specpower/prompts/...`), not a hardcoded `.claude/`. `bakeCustomIncludes` SHALL therefore accept the active tool's root dir and bake placeholders into the prompt copies under that root. A hardcoded `.claude/` lookup would silently find no prompt copy for cac/chrys projects and ship un-baked `[CONTROLLER:` placeholders (surfaced later by the D9 subagent self-check) — a regression. For back-compat, the root dir defaults to `.claude` when omitted.

#### Scenario: cac project bakes [CONTROLLER: placeholders under .cac/
- **WHEN** `specpower init`/`sync` runs with the active tool `cac` (project scope)
- **AND** `specpower/custom/coding/` (or `review/`) contains `.md` files
- **THEN** the `[CONTROLLER:` placeholder in `.cac/specpower/prompts/shared/implementer-prompt.md` is replaced with the concatenated custom rules
- **AND** no whole-line `[CONTROLLER:` placeholder remains in any of the 4 mapped prompt copies under `.cac/`

#### Scenario: chrys project bakes [CONTROLLER: placeholders under .agents/
- **WHEN** `specpower init`/`sync` runs with the active tool `chrys` (project scope)
- **THEN** the `[CONTROLLER:` placeholder in `.agents/specpower/prompts/shared/implementer-prompt.md` is replaced with the concatenated custom rules

#### Scenario: omitted root dir defaults to .claude (back-compat)
- **WHEN** `bakeCustomIncludes(projectRoot)` is called without a root dir
- **THEN** it bakes placeholders in `.claude/specpower/prompts/...` (legacy behavior preserved)

### Requirement: Vendored third-party reference docs are excluded from root rewriting
The `prompts/reference/superpowers/` directory holds vendored third-party reference documents that describe other AI tools' own directory conventions (e.g. "`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex"). These `.claude/` references are about those products, NOT about the specpower target tool, and rewriting them to the active tool's root would corrupt their meaning. `copyPrompts` SHALL copy `reference/superpowers/` verbatim (no path rewriting), while rewriting all other specpower-owned prompt content.

#### Scenario: vendored superpowers doc keeps ~/.claude/skills for cac
- **WHEN** `specpower init`/`sync` runs with the active tool `cac` (project scope)
- **THEN** the copied `prompts/reference/superpowers/writing-skills.md` still contains the literal `~/.claude/skills`
- **AND** does NOT contain `~/.cac/skills`
