## Why

**Why a custom layer is needed (background):** specpower's review/coding rules are hardcoded in `prompts/review/code-review.md` / `prompts/shared/implementer-prompt.md` / `receiving-code-review.md`. Different companies/projects have their own rules (coding standards, naming constraints, forbidden APIs, review checklists), but there is **no injection point** — users must fork the source, breaking on upgrade. A project-level customization layer is needed: two directories (generation-side `coding/`, review-side `review/`) as an overlay (additional dimensions, not replacing the built-in checklist). A company/team produces a **unified customization version** — the team finishes coding/review rules and distributes them to projects to enforce team intent; the custom dirs are part of the team's customized package, refreshed via sync, not committed to git (same package-level regeneratable asset as prompts/schemas/templates).

**Two gaps found in field-testing the custom overlay layer:**

1. **Custom rules silently never reach subagents.** The guard section told the subagent "if `specpower/custom/...` exists, read all .md" — subagents treat "if exists" as optional and skip the read; and in `/specpower:build` Phase B (worktree mode) `specpower/custom/` is physically absent (gitignored, not in the worktree). Result: custom rules never take effect.
2. **Cannot reuse existing project docs.** Custom `.md` files cannot reference existing project documentation (coding-style, ADRs, architecture notes) without copy-paste, which drifts.

**How this change fixes them:** custom-rule resolution moves from "subagent self-read at runtime" to **sync-baked into prompt-file placeholders**, and an `!include` bake-time expansion is added — fixing both gaps. **The team authors the files to load in the package-root `specpower/custom/` `.md`**, using `!include` to reference existing project docs (e.g. `docs/coding-style.md`); consumer projects bake-expand at `init`/`sync`.

## What Changes

- **sync-baked prompt placeholders (replaces controller-runtime-inline).** The 4 guard sections (`prompts/shared/implementer-prompt.md`, `code-reviewer-prompt.md`, `prompts/review/code-review.md`, `receiving-code-review.md`) become `[CONTROLLER: ...]` placeholders. At `init`/`sync` time, `bakeCustomIncludes` → `bakePrompts` reads custom rules and replaces the placeholders in the prompt-file **copies** with the rule text — rules physically enter the prompt the controller/subagent reads. Eliminates the controller LLM dependency (no runtime "read custom + fill placeholder"); conforms to "provide full text, never make a subagent read files".
- **`!include` bake-time expansion.** Custom `.md` files may use a whole-line `!include <rel-from-project-root>` to reuse project docs. Expansion runs at `init`/`sync` bake time (deterministic TS, not LLM), recursively, with cycle detection, depth cap, per-top-level-file once semantics, sandbox allowlist, and hard size/extension limits. **Wildcard** `!include docs/rules/*.md` expands all matching files in a directory (lexicographic, extension-whitelisted). All failures throw and abort sync (fail-fast — no silent degradation).
- **Sandbox allowlist defaults to `specpower/` + `docs/` + `arch/` + `design/`.** `include-roots` default allowlist covers the most common project doc dirs so teams can `!include docs/coding-style.md` without the project declaring it. Projects may declare additional roots in `specpower/config.yaml`'s `custom.include-roots`.
- **worktree setup runs `specpower sync`.** `phase-b-worktree.md` setup adds a step: if `specpower/config.yaml` exists and `specpower` is on PATH, run `specpower sync` in the worktree to regenerate the gitignored assets (`custom/`, `prompts/`, `schemas/`, `templates/`) a fresh worktree lacks.
- **worktree sync skips `stampVersionInConfig`.** `isInsideWorktree` detection: sync inside a linked worktree does not stamp the `config.yaml` version line (avoids polluting the worktree's git diff).

## Capabilities

### New Capabilities
<!-- No new capability. This change fixes and enhances the existing custom overlay delivery mechanism. -->

### Modified Capabilities
- `customization-layer`: custom-rule delivery changes from "subagent self-read with existence guard" to **sync-baking into `[CONTROLLER: ...]` prompt-file placeholders**; adds `!include` bake-time expansion (recursive, wildcard, sandboxed, hard-limited, fail-fast); `include-roots` default allowlist = `specpower/` + `docs/` + `arch/` + `design/`; `copyCustom` unchanged but bake follows it.
- `specpower-build`: implementer dispatch is preceded by sync having baked `specpower/custom/coding/` into the implementer-prompt placeholder; `phase-b-worktree` setup runs `specpower sync` to regenerate gitignored assets in the worktree; controller runs the D11 `!include` residue check before dispatch.
- `specpower-review`: reviewer dispatch is preceded by sync having baked `specpower/custom/review/` into the reviewer-prompt placeholder; controller runs the D11 residue check before dispatch.

## Impact

- **New code:** `src/cli/commands/custom-bake.ts` (`bakeCustomIncludes`, `bakePrompts` + 4 placeholder mappings, `globToRegex`, the `!include` expander).
- **Modified code:** `src/cli/commands/init.ts` (call bake after `copyCustom`; `buildConfigYaml` adds `custom.include-roots` comment), `src/cli/commands/sync.ts` (call bake after `copyCustom`; `isInsideWorktree` + conditional skip of `stampVersionInConfig`). `DEFAULT_INCLUDE_ROOTS` = `['specpower/', 'docs/', 'arch/', 'design/']`.
- **Prompts:** 4 guard sections → sync-baked placeholders + D9 self-check; `phase-b-execute.md` / `phase-b-review.md` → sync-baked instructions + D11 residue check; `phase-b-worktree.md` → `specpower sync` step.
- **Docs:** `custom/README.md` (Includes section + wildcard section), `README.md` ("定制如何生效" updated — kept in Chinese per project README convention).
- **Tests:** `test/cli/custom-bake.test.ts` (new, 25 tests), `test/cli/prompts-custom-placeholder.test.ts` (new), `test/cli/sync.test.ts` (worktree-sync + no-stamp), `test/core/tools/adapters.test.ts` (`specpower/custom/` refs not rewritten — pre-existing).
- **No new CLI command** (bake reuses `init`/`sync`; worktree reuses `specpower sync`).
- **No breaking changes:** `specpower/custom/` path semantics preserved; `.md` without `!include` is passed through unchanged.
