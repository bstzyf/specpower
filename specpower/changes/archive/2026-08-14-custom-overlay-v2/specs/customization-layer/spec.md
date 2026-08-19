## ADDED Requirements

### Requirement: Custom rules overlay (coding + review)
The system SHALL allow a project to define custom rules in two directories under `specpower/custom/`:
- `specpower/custom/coding/` — rules consumed by code GENERATION/implementation workflows (`/specpower:build` implementer, `/specpower:fix`)
- `specpower/custom/review/` — rules consumed by code REVIEW workflows (`/specpower:review`)

Each directory may hold any number of `.md` files; all **top-level** `.md` files (subdirectories and non-`.md` files are ignored) are read in lexicographic (dictionary) filename order when the directory has any. Custom rules are applied as ADDITIONAL dimensions layered ON TOP of the built-in checklist; they MUST NOT replace built-in safety/correctness checks — for project-convention conflicts (naming, structure, style) the custom rule wins, for safety/correctness the built-in rule always applies.

**Delivery mechanism:** rules are NOT read by the subagent or controller at runtime. At `specpower init`/`sync` time (after `copyCustom` and `bakeCustomIncludes`), the system SHALL read the top-level `.md` files of `specpower/custom/coding/` (resp. `review/`), concatenate in lexicographic order, and replace the `[CONTROLLER: ...]` placeholder in the corresponding prompt file 副本 with the rule text:
- `coding/` → `prompts/shared/implementer-prompt.md` + `prompts/shared/receiving-code-review.md`
- `review/` → `prompts/shared/code-reviewer-prompt.md` + `prompts/review/code-review.md`

The controller/subagent then reads the prompt file (per SKILL.md instructions) and receives the rules as inline text — no runtime read, no LLM-dependent fill. This conforms to "provide full text, never make a subagent read files" and avoids the silent-skip (subagents treating "if exists" as optional) and worktree-absence (gitignored `specpower/custom/` is not in the worktree; `specpower sync` in worktree setup regenerates the baked prompt) failure modes. If a placeholder is still literally present in the prompt at dispatch time (sync didn't run/bake failed), the D9 subagent self-check surfaces it.

#### Scenario: sync bakes coding rules into implementer-prompt.md
- **WHEN** `specpower/custom/coding/` exists and contains `.md` files
- **AND** `specpower init`/`sync` runs (project scope)
- **THEN** the system SHALL read all top-level `.md` files (sorted lexicographically by filename)
- **AND** SHALL replace the `Project Coding Standards (controller-inlined)` placeholder in `prompts/shared/implementer-prompt.md` (and `prompts/shared/receiving-code-review.md`) with their concatenated contents
- **AND** when an implementer subagent is later dispatched during `/specpower:build` or `/specpower:fix`, the implementer SHALL follow their conventions for naming, structure, patterns, and style (received as inline text in the prompt, no runtime read)
- **AND** if a rule conflicts with the task spec, the implementer SHALL raise it as a concern (DONE_WITH_CONCERNS) rather than silently ignoring either

#### Scenario: sync bakes review rules into code-reviewer-prompt.md
- **WHEN** `specpower/custom/review/` exists and contains `.md` files
- **AND** `specpower init`/`sync` runs (project scope)
- **THEN** the system SHALL read all top-level `.md` files (sorted lexicographically by filename)
- **AND** SHALL replace the `Custom Standards` placeholder in `prompts/shared/code-reviewer-prompt.md` (and `prompts/review/code-review.md`) with their concatenated contents
- **AND** when a code-reviewer subagent is later dispatched during `/specpower:review`, the reviewer SHALL apply each rule as an additional review dimension
- **AND** SHALL flag violations at the severity each rule specifies (`[Critical]` / `[Important]` / `[Minor]`), defaulting to Important when unspecified

#### Scenario: sync writes explicit none when custom dir is empty or missing
- **WHEN** `specpower/custom/coding/` (or `review/`) is missing or has no top-level `.md` files
- **AND** `specpower init`/`sync` runs
- **THEN** the system SHALL write the literal word `none` into the corresponding prompt placeholder (not leave it blank, not skip it)
- **AND** the subagent SHALL proceed with the built-in checklist only
- **AND** the explicit `none` makes the check visibly run rather than silently skipped

#### Scenario: Multiple rule files are applied in lexicographic order
- **WHEN** either `specpower/custom/coding/` or `specpower/custom/review/` contains more than one `.md` file
- **THEN** the system SHALL read them in lexicographic (dictionary) order by filename and concatenate in that order at sync bake time
- **AND** the order SHALL be deterministic so users can control precedence with numeric prefixes (e.g. `01-naming.md` before `02-architecture.md`)

#### Scenario: Empty or unreadable rule files are tolerated
- **WHEN** a custom rule file exists but is empty or contains no parseable rules
- **THEN** the controller SHALL NOT raise an error
- **AND** SHALL include the file's (empty) content in the concatenation and proceed

#### Scenario: Non-.md files and subdirectories are ignored
- **WHEN** `specpower/custom/review/` (or `coding/`) contains non-`.md` files and/or subdirectories with `.md` files inside
- **THEN** the controller SHALL only read top-level `.md` files
- **AND** SHALL ignore non-`.md` files and SHALL NOT recurse into subdirectories

#### Scenario: Custom directory is refreshed via sync, not committed to git
- **WHEN** a team maintains unified `coding/` and `review/` rule files at the specpower package root and releases a customized package
- **THEN** projects consuming that package SHALL obtain the rule files via `specpower init`/`sync` into `specpower/custom/`
- **AND** `specpower/custom/` SHALL be listed in `.gitignore` (not committed to the project repo)
- **AND** `specpower sync` SHALL refresh the team-distributed rule files with each package version update

#### Scenario: Subagent detects unfilled placeholder as concern (sync bake missing)
- **WHEN** `specpower sync` did not run or its prompt-placeholder bake failed, leaving the literal `[CONTROLLER: ...]` placeholder text in the prompt the subagent receives
- **THEN** the subagent SHALL report DONE_WITH_CONCERNS noting the placeholder was not baked by sync
- **AND** SHALL NOT treat the literal placeholder text as a rule, and SHALL NOT silently proceed as if rules were absent
- **AND** this makes a missing/failed sync bake visible instead of silently misapplying or skipping custom rules

### Requirement: Custom rule includes baked at init/sync
The system SHALL expand `!include <rel-from-project-root>` directives in `specpower/custom/{coding,review}/*.md` into their target files' literal text, in place, at `specpower init`/`sync` time (immediately after `copyCustom`), so the controller and subagent never see `!include` — they read already-expanded plain text. Expansion is recursive, deterministic (TypeScript, not LLM), and runs with cycle detection, a depth cap, once semantics, a sandbox allowlist, and hard size/extension limits.

**Sandbox (include-roots):** a target's realpath MUST fall under an include-root. The default include-roots SHALL be `specpower/` (always), `docs/`, `arch/`, and `design/` (project-root directories, always, so teams can `!include docs/coding-style.md` / `arch/adr-007.md` / `design/arch.md` without the project declaring them). Projects MAY declare additional roots via `specpower/config.yaml`'s `custom.include-roots` array (e.g. `wiki/`). Absolute paths and traversal escaping every root are rejected.

**Failure policy (fail-fast):** ALL failures throw and abort the sync with a message naming the offending file, line, and directive — no silent degradation. A degraded comment would let sync "succeed" while the user's custom rules silently don't take effect (target missing or out-of-sandbox skipped), causing hours of later debugging "why aren't my rules applied"; surfacing the error at sync time is cheapest. This applies to: target missing, target outside every include-root, circular include, depth cap exceeded, per-file/total size cap exceeded, disallowed extension, absolute path, and directory target.

#### Scenario: Basic include expands into target content
- **WHEN** a custom `.md` contains a whole-line `!include docs/coding-style.md` and `docs/coding-style.md` exists
- **THEN** the bake SHALL replace the directive line with the target file's contents
- **AND** the expanded file SHALL contain no `!include` directive

#### Scenario: Includes expand recursively
- **WHEN** file A `!include`s file B and B `!include`s file C
- **THEN** the bake SHALL expand transitively so A's baked text contains B's and C's contents

#### Scenario: Diamond include expands once (no duplicate)
- **WHEN** A includes B and C, and both B and C include D
- **THEN** D's content SHALL appear exactly once in A's baked text (once semantics within a single file's expansion tree)

#### Scenario: Cross-file include is NOT deduplicated
- **WHEN** `specpower/custom/coding/01.md` includes `specpower/custom/review/shared.md`
- **AND** `specpower/custom/review/01.md` also includes `specpower/custom/review/shared.md`
- **THEN** each top-level file SHALL expand `shared.md` independently (once semantics is per-top-level-file, not global)
- **AND** both `coding/01.md` and `review/01.md` SHALL contain `shared.md`'s full content after baking
- **AND** the implementer and reviewer each receive the complete shared rules (no cross-file starvation)

#### Scenario: Wildcard include expands all matching files in a directory
- **WHEN** a custom `.md` contains `!include docs/rules/*.md`
- **AND** `docs/rules/` contains `01-naming.md`, `02-arch.md`, `10-security.md`, and `README.txt`
- **THEN** the bake SHALL expand all top-level `.md` files matching the glob (`.txt` filtered out by extension whitelist)
- **AND** SHALL concatenate them in lexicographic (dictionary) order so numeric prefixes control precedence
- **AND** each matched file SHALL be recursively expanded (its own `!include` directives resolved)

#### Scenario: Wildcard with no matches throws and aborts
- **WHEN** a custom `.md` contains `!include docs/rules/*.md` and `docs/rules/` is empty or has no `.md` match
- **THEN** the bake SHALL throw a `no files matched` error naming the directive
- **AND** the sync SHALL abort (fail-fast — an empty/non-matching wildcard is a config error, not a silent no-op)

#### Scenario: Wildcard directory outside include-roots throws
- **WHEN** a custom `.md` contains `!include ../outside/*.md` and `../outside/` is outside every include-root
- **THEN** the bake SHALL throw an `outside include-roots` error
- **AND** no file under `../outside/` SHALL be expanded (no leak)

#### Scenario: Default roots allow project docs without config
- **WHEN** a custom `.md` contains `!include docs/coding-style.md` (or `arch/adr-007.md` or `design/arch.md`) and the project's `config.yaml` does NOT declare `custom.include-roots`
- **AND** the target file exists
- **THEN** the bake SHALL expand it successfully (`specpower/`, `docs/`, `arch/`, `design/` are default include-roots)

#### Scenario: Project can declare additional include-roots
- **WHEN** `specpower/config.yaml` contains `custom: { include-roots: [arch/] }`
- **THEN** files under `arch/` SHALL be includable
- **AND** files under non-declared, non-default directories SHALL be rejected as outside include-roots

#### Scenario: Missing target throws and aborts sync
- **WHEN** a custom `.md` contains `!include docs/missing.md` and `docs/missing.md` does not exist
- **THEN** the bake SHALL throw a `file not found: docs/missing.md` error naming the offending file and directive
- **AND** the sync SHALL abort (not return success) so the user learns at sync time that the custom rule won't take effect
- **AND** no content enters the prompt (the directive never expands)

#### Scenario: Out-of-sandbox target throws and aborts sync
- **WHEN** a custom `.md` contains `!include ../escape.md` and `escape.md` exists outside every include-root
- **THEN** the bake SHALL throw an `outside include-roots` error naming the offending file and directive
- **AND** `escape.md` content SHALL NOT be expanded (no leak)
- **AND** the sync SHALL abort so the out-of-sandbox reference is fixed, not silently skipped

#### Scenario: Circular include throws and aborts
- **WHEN** file A includes B and B includes A (a cycle)
- **THEN** the bake SHALL throw a `circular include` error
- **AND** the sync SHALL abort with a message naming the offending file

#### Scenario: Disallowed extension throws and aborts
- **WHEN** a custom `.md` contains `!include src/index.ts`
- **THEN** the bake SHALL throw an `extension .ts not allowed` error
- **AND** the sync SHALL abort (source/lockfile/binary inclusion is a structural error)

#### Scenario: Per-file size cap throws and aborts
- **WHEN** an included target exceeds the per-file size limit (64 KB)
- **THEN** the bake SHALL throw and the sync SHALL abort

#### Scenario: Controller warns on unresolved !include residue at build time
- **WHEN** a `specpower/custom/` `.md` still contains an unresolved `!include` directive line when `/specpower:build` or `/specpower:review` begins
- **THEN** the controller SHALL warn the user to run `specpower sync` (the previous bake did not complete or was never run — under the fail-fast policy a successful bake leaves no `!include` directive lines, since missing/out-of-sandbox targets abort rather than degrade)
- **AND** this prevents silently applying stale baked text when the team's `!include` graph changed

#### Scenario: Project-doc changes after sync require re-sync (snapshot constraint)
- **WHEN** `specpower sync` has baked `!include docs/rules/coding-style.md` (a project-level customization referenced by a team `!include`) into the prompt placeholder
- **AND** `docs/rules/coding-style.md` is later modified by the project
- **THEN** the baked prompt SHALL still contain the old snapshot (sync is a point-in-time bake; the system does NOT auto-detect project-doc changes)
- **AND** the user SHALL re-run `specpower sync` to refresh the baked prompt with the new project-doc content
- **AND** this is the documented snapshot constraint of bake-time delivery: project-level customization (team-conventioned project dirs like `docs/rules/` referenced via `!include`) is supported, but its changes require a re-sync to propagate

### Requirement: Custom directory refresh via sync
The system SHALL distribute the package-root `custom/` directory to project `specpower/custom/` via `specpower init`/`sync` (project scope), using the same copy-and-refresh mechanism as prompts/schemas/templates. `specpower/custom/` SHALL be ignored by `.gitignore` (not committed) and refreshed on every sync. Immediately after `copyCustom`, the system SHALL run `bakeCustomIncludes` to expand any `!include` directives in the copied files (see "Custom rule includes baked at init/sync"). Prompt references use the relative path `specpower/custom/` (project-cwd-relative, like `specpower/specs/`), so they are tool-agnostic and not rewritten by `rewritePromptRefs`.

#### Scenario: init/sync refreshes custom/ then bakes includes
- **WHEN** user runs `specpower init` or `specpower sync` (project scope)
- **THEN** the system SHALL copy the package-root `custom/` to `specpower/custom/`
- **AND** SHALL then run `bakeCustomIncludes(projectRoot)` to expand `!include` directives in place
- **AND** `specpower/custom/` SHALL be added to `.gitignore` (idempotent)

#### Scenario: user scope does not distribute or bake custom/
- **WHEN** user runs `specpower sync --user`
- **THEN** the system SHALL NOT copy `custom/` and SHALL NOT run `bakeCustomIncludes` for the user scope
- **AND** user-scope sessions look for `specpower/custom/` in the project cwd; if absent, the controller writes `none` into the placeholder

#### Scenario: sync mirrors package-root custom/ then bakes (clear-then-copy-then-bake)
- **WHEN** `specpower sync` runs (project scope)
- **THEN** `copyCustom` SHALL first clear `specpower/custom/` then copy package-root `custom/` into it
- **AND** `bakeCustomIncludes` SHALL run on the freshly-copied files
- **AND** rule files removed from the package root SHALL NOT remain in `specpower/custom/`
- **AND** `cleanStale` SHALL NOT scan `specpower/custom/`

#### Scenario: Bake structural failure aborts sync
- **WHEN** a custom `.md` contains a structural include error (circular include, disallowed extension, over-size target, or directory target)
- **THEN** `bakeCustomIncludes` SHALL throw with a message naming the offending file and directive
- **AND** the sync SHALL abort (not return success)
- **AND** the failure SHALL surface before `specpower sync` reports success, so the user fixes the include rather than shipping unexpanded directives
