# Design — custom-overlay-v2

> First-iteration design, refined across 6 rounds. A-stage code is implemented and verified (260 tests pass). This design records the decisions and rationale.

## 1. Context

The `customization-layer` change (phase=built, archived-then-superseded) shipped a custom overlay layer: package-root `custom/{coding,review}/` is copied by `copyCustom` to project `specpower/custom/` (gitignored, sync-overwritten), and 4 prompts injected "existence-guard" sections telling the subagent to self-read. Field-testing exposed two technical gaps:

- **Subagents don't read:** the guard section "if `specpower/custom/...` exists, read all .md" delegates the read to the subagent (LLM), which treats "if exists" as optional and skips it; also violates `phase-b-execute.md`'s own "Never: make a subagent read plan file (provide full text instead)".
- **worktree physical absence:** `specpower/custom/` (and `.claude/specpower/prompts/` etc.) are gitignored, so a git worktree (only tracked files) lacks them; Phase B in a worktree cannot read custom.
- **No reuse of project docs:** custom `.md` cannot reference existing project docs (coding-style, ADRs, architecture notes) without copy-paste.

A-stage implemented the fix (`src/cli/commands/custom-bake.ts` + 4 placeholders + init/sync wiring + worktree sync), 260 tests pass + e2e verified. This change specs it and adjusts `include-roots` defaults.

Technical constraints: TypeScript CLI (commander + js-yaml), vitest, prompts are static `.md` files (no runtime template engine), custom is project-cwd-relative (tool-agnostic, not rewritten by `rewritePromptRefs`).

## 2. Goals / Non-Goals

**Goals**
- Custom rules **necessarily** enter the subagent prompt text (not relying on subagent self-read, not depending on cwd/worktree).
- Support `!include` to reuse existing project docs (coding-style, ADRs, architecture notes), no copy-paste.
- worktree mode: controller can read prompt + custom (gitignored assets reachable).
- No new CLI command (reuse `init`/`sync`).
- `!include` expansion is deterministic and unit-testable (TS, not LLM).

**Non-Goals**
- No project-level overlay directory (e.g. `specpower/local/`) — project-level customization is supported via team-conventioned project dirs (e.g. `docs/rules/`) + `!include`; no separate directory needed.
- No `!include` syntax extensions (no variables, conditionals, loop macros) — only whole-line `!include <path>` and wildcard `!include dir/*.md`.
- No user-scope distribution of custom — custom stays project scope.
- No runtime `!include` parsing by the controller — expansion happens only at init/sync bake time.

## 3. Design Decisions

### D1: custom delivery mechanism — sync-bake into prompt placeholders

**Options considered:**
- (a) Subagent self-read (original): guard "if exists, subagent read". Fails — subagent skips optional read + worktree absence + violates provide-full-text.
- (b) Controller-runtime-inline: controller reads custom and fills the placeholder before dispatch. Rules enter the prompt, but depends on the controller (LLM) to comply.
- (c) New `specpower custom show` CLI command: most testable but **adds a command** (user vetoed).
- (d) sync-bake custom into prompt placeholders: at sync time, read custom (already `!include`-baked) and replace the `[CONTROLLER: ...]` placeholder in the prompt-file **copy** with the rule text. controller/subagent read the prompt and get rules. No LLM dependency (deterministic TS).

**Chosen:** (d) sync-bake custom into prompt placeholders.

**Rationale:** Eliminates the controller-runtime-inline LLM dependency (deterministic main path) — sync reads `specpower/custom/{coding,review}/` top-level `.md` (lexicographic, already `!include`-baked), replaces the corresponding prompt-file copy's `[CONTROLLER: ...]` placeholder with the rule text, controller/subagent read the prompt and get rules without runtime fill. Conforms to specpower's "deterministic-first, don't rely on LLM self-discipline" principle, more reliable than (b)'s "controller reads + fills".

**Mapping** (sync bake, 4 entries):
- `specpower/custom/coding/` → `prompts/shared/implementer-prompt.md` + `prompts/shared/receiving-code-review.md`
- `specpower/custom/review/` → `prompts/shared/code-reviewer-prompt.md` + `prompts/review/code-review.md`

**Costs:** sync must hardcode 4 mappings; prompt copies contain project custom content (debug: prompt not "pristine" — you see project rules, not the pure template); custom changes require sync to enter the prompt (but sync is already required for `!include` baking, so consistent).

**best-effort fallback chain (keep D9 + D11):** (d) is the deterministic main path, but if sync didn't run / bake failed, D9 (subagent self-check: prompt contains literal `[CONTROLLER:` → report DONE_WITH_CONCERNS) + D11 (controller detects `!include` residue in custom → warn sync) provide a two-layer fallback surfacing "sync didn't run / failed". D9/D11 are kept (not deleted, not simplified) — even with a deterministic main path, fallbacks cover the sync-not-run / bake-failed case.

### D2: `!include` expansion timing — init/sync bake (not runtime)

**Options considered:**
- (a) Controller-runtime expansion: dispatch-time `!include` resolution. Untestable (LLM), cycle/sandbox/size can't be guaranteed, worktree still needs custom present.
- (b) init/sync bake-time expansion (in-place write-back to `specpower/custom/`): deterministic TS, unit-testable, worktree-consistent, controller/subagent unaware of `!include`.
- (c) Bake to a separate copy dir: avoid touching the original. But controller already reads `specpower/custom/`; a copy adds path confusion.

**Chosen:** (b) init/sync bake in-place.

**Rationale:** `specpower/custom/` is a gitignored regeneratable copy (sync clear-then-copy), in-place baking doesn't touch the source (source is package-root `custom/`). After baking, controller reads plain text, unaware of `!include`. `copyCustom` is immediately followed by `bakeCustomIncludes`, one sync does copy + bake.

### D3: include path base — relative to project root

**Options considered:**
- (a) Relative to the including file's directory (C `#include` convention): self-contained. But custom lives in `specpower/custom/coding/`, referencing project-root `docs/` requires `../../../docs/x.md` — verbose.
- (b) Relative to project root: `!include docs/coding-style.md`, `!include arch/adr-007.md` are most intuitive. custom-to-custom `specpower/custom/review/shared.md` is also stable. In a worktree "project root" = worktree root, consistent.

**Chosen:** (b) relative to project root.

**Rationale:** The main use case is reusing project docs — relative-to-project-root is most intuitive and shortest. custom lives under `specpower/custom/`, project-root-relative paths are stable (moving custom doesn't break). Absolute paths are rejected (non-portable, cross-project inconsistent).

### D4: include failure policy — all-throw abort (fail-fast)

**Options considered:**
- (a) All-throw abort: every failure (missing/out-of-sandbox/cycle/over-limit/bad-extension/absolute/directory) throws + aborts sync, reporting file:line:directive.
- (b) All-degrade: every failure degrades to a comment. Lenient, but masks config errors.
- (c) Soft+hard (missing/out-of-sandbox degrade-to-comment, structural throw): was chosen, but degradation hides problems.

**Chosen:** (a) all-throw abort.

**Rationale:** Surfacing errors explicitly beats hiding. A degraded comment lets sync "succeed" while the user's custom rules silently don't take effect (target missing/out-of-sandbox skipped), causing hours of later debugging "why aren't my rules applied" — the problem should surface at sync time. Throwing immediately tells the user which `!include` is broken (file:line:directive:reason), cheapest to fix. This is fail-fast, consistent with specpower's "no silence" (placeholder missing writes `none`, build-time `!include` residue warning). Default roots are already widest (`specpower/+docs/+arch/+design/`), so common includes don't go out-of-sandbox; out-of-sandbox/missing is a real error (team contract: consumers must have the included doc), throwing makes the contract violation explicit. **Trade-off:** consumer project missing the doc → sync aborts — but that's exactly what should surface, not be hidden.

### D5: include-roots defaults — `specpower/` + `docs/` + `arch/` + `design/`

**Options considered:**
- (a) Default only `specpower/`: `!include docs/x.md` requires config declaration. Extra config step.
- (b) Default `specpower/` + `docs/`: team can `!include docs/coding-style.md` without declaration. docs/ is the conventional doc dir.
- (c) Default `specpower/` + `docs/` + `arch/` + `design/`: also arch/ (ADRs), design/ (design docs) — covers the most common project doc dir names.
- (d) Default more (wiki/, doc/): too speculative, mismatches real layout and misleads.

**Chosen:** (c) default `specpower/` + `docs/` + `arch/` + `design/`.

**Rationale:** docs/, arch/, design/ are the most common project doc dir conventions; defaulting them lets teams reuse project docs "out of the box". If these dirs don't exist, `!include` degrades... no — fail-fast throws (target missing), user declares actual dirs in config; non-default dirs declared via config. More (wiki/doc) is too speculative.

### D6: worktree gitignored-asset absence — phase-b-worktree setup runs `specpower sync`

**Options considered:**
- (a) worktree setup copies custom/ (+ prompts/) into the worktree: requires copy logic, and the prompts problem is independent of custom.
- (b) worktree setup runs `specpower sync` (existing command): reuses existing copy + bake, solving prompts/schemas/templates/custom all at once.
- (c) controller/subagent use `git rev-parse --git-common-dir/..` to read the main project root: each subagent resolves the main root, fragile.

**Chosen:** (b) worktree setup runs `specpower sync`.

**Rationale:** sync is the existing "copy gitignored assets to the cwd project" mechanism; running it in the worktree brings all assets (incl. baked custom) into the worktree. No new command, no new copy logic, inline/worktree behavior consistent (both read cwd-relative `specpower/custom/`). Guard: runs only if `specpower/config.yaml` exists + `specpower` on PATH, else silent skip (non-specpower project or CLI not installed doesn't error).

### D7: cycle/diamond semantics — cycle-detection stack + per-top-level-file once dedup

**Options considered:**
- (a) Cycle detection + every-expansion (diamond/cross-file duplicates): simple. But rule-doc content duplicates.
- (b) Cycle-detection stack + **global** once dedup: was chosen, but has a bug — `coding/01.md` and `review/01.md` both `!include shared.md`: coding expands first (seen records), review hits shared → once skips → **review/01.md's shared content is empty**, reviewer gets no rules. Once means single-file diamond dedup, not cross-file.
- (c) Cycle-detection stack + **per-top-level-file** once dedup: each `specpower/custom/{coding,review}/*.md` top-level file expands independently (new seen/stack), `totalBytes` global. shared.md expands in coding/01 and review/01 each (both complete). Once only within a single file's diamond (A→B,C; B,C→D, D expands once in A).

**Chosen:** (c) per-top-level-file once dedup.

**Rationale:** The once semantic boundary is "one expansion of an include tree" — each top-level custom md is an independent tree, deduped per tree. Cross-file/cross-kind is NOT deduped: different prompts (implementer vs reviewer) each need complete rules; cross-file shared seen starves later-expanded files. `totalBytes` stays global (total cap). **Intentional repeat:** if a team wants to emphasize a rule, write the content directly in the md or use a different filename, not `!include` the same file twice (per-file once swallows the second within one file) — documented in `custom/README.md`.

### D8: size/extension hard limits — limited

**Options considered:**
- (a) No limits: include any file. Risk — `!include package-lock.json` (MB) or binary blows the prompt, secrets enter the prompt.
- (b) Limited: per-file 64KB, total 256KB, extension whitelist `.md/.txt/.yaml/.yml/.json`.

**Chosen:** (b) limited.

**Rationale:** custom is a rule layer (text rules), not a code/data reference layer. Limits prevent prompt blowups, binaries, secrets (`.env`/`.key` not whitelisted). Whitelist > blacklist (blacklist inevitably misses).

### D9: sync-bake-not-run fallback — subagent self-check for placeholder residue

**Options considered:**
- (a) No fallback: if sync didn't run / prompt-placeholder bake failed, prompt leaves literal `[CONTROLLER:` text, subagent behavior undefined (may treat as a rule).
- (b) Subagent self-check for placeholder residue: placeholder section adds "if the prompt you receive contains literal `[CONTROLLER:` text (sync bake missing), report DONE_WITH_CONCERNS". Makes "sync didn't bake" an explicit concern.
- (c) Controller pre-check for placeholder residue: same as D11, overlaps.

**Chosen:** (b) subagent self-check.

**Rationale:** (d) main path is sync deterministic bake (D1), but if sync didn't run / bake failed, prompt leaves literal `[CONTROLLER:`. D9 gives the subagent a detection path — if the received prompt contains a literal placeholder, report DONE_WITH_CONCERNS (sync bake missing). Turns "sync didn't run / failed" from silent to explicit concern, consistent with "missing writes `none`, not silent". **Risk:** D9 depends on the subagent (LLM) obeying "see literal placeholder → report", not 100% certain; but it's best-effort fallback (D1 main path deterministic, D9 covers sync failure), and with D11 (controller detects `!include` residue) forms a two-layer fallback (D9 subagent layer, D11 controller layer).

### D10: worktree sync skips stamp config — semantic "worktree sync doesn't change config version"

**Options considered:**
- (a) Status quo: worktree sync normally `stampVersionInConfig` → changes the worktree's `specpower/config.yaml` version line → pollutes the worktree git diff (config.yaml is tracked).
- (b) worktree sync skips stamp: worktree is a transient implementation env, config version should track the main project, no stamp needed.
- (c) Stamp to a worktree-local, non-tracked config: extra config copy, complex.

**Chosen:** (b) worktree sync skips stamp.

**Rationale:** worktree is a transient isolation env for build Phase B implementation; its `config.yaml` is a tracked copy of the main project's config. sync in a worktree only re-generates gitignored assets (prompts/custom etc.), it should not change config's version line (that would pollute the worktree's git diff, mixing with implementation changes). **Implementation path (build Phase A choice — chose iii):** sync auto-detects worktree (`git rev-parse --git-common-dir` vs `--show-toplevel` mismatch → skip stamp), transparent to phase-b-worktree and other worktree scenarios.

### D11: custom-staleness detection — pre-build `!include` residue check

**Options considered:**
- (a) Status quo: no detection. custom md may hold stale baked text from last sync (team changed package-root `!include` but consumer didn't sync).
- (b) **Pre-build `!include` residue check:** if `specpower/custom/` md still contains `!include` directive lines (last bake didn't complete / never ran), controller warns "run `specpower sync`".
- (c) config stamps custom bake version, build compares versions: heavy, extra version field.

**Chosen:** (b) pre-build `!include` residue check.

**Rationale:** (d) main path is sync bake (first `!include`-bakes custom, then bakes custom into prompt placeholders), but if the user changed package-root custom and didn't sync the project, controller pre-build checks `specpower/custom/` md for `!include` residue (means custom `!include` bake didn't run / failed) → warn sync. Under D4 fail-fast, a successful sync's custom has no `!include` residue (failure throws + aborts, no degraded comments), so residue = not synced — a clear signal. Cheap check, turns "forgot sync" from silent (using stale baked text) to visible. With D9 forms a two-layer fallback (D9 subagent layer detects prompt placeholder residue, D11 controller layer detects custom `!include` residue).

### D12: wildcard `!include` — glob directory expansion

**Options considered:**
- (a) Single-file only: `!include docs/rules/01-x.md`, must list each file. Tedious when a dir has many rules.
- (b) Wildcard `!include docs/rules/*.md`: expand all matching files in the dir (lexicographic, extension-whitelisted, recursive). `*` matches non-`/`, `?` matches single non-`/`.
- (c) Full glob (minimatch): too powerful, security/ordering complexity.

**Chosen:** (b) simple wildcard `*`/`?`.

**Rationale:** Listing every rule file is tedious and order-fragile (forget one, misorder). Wildcard `*.md` over a rules dir is the natural fit — "include all rules here, in deterministic order". Kept simple (`*`/`?` non-`/`) to avoid minimatch's complexity/security surface. Matched files sorted lexicographically (zero-padded numeric prefixes control precedence), extension-whitelisted, recursively expanded. No matches / dir missing / out-of-sandbox all throw (fail-fast, consistent with D4).

## 4. Risks / Trade-offs

- **sync-bake 4-mapping maintenance:** (d) sync-bake hardcodes the prompt-placeholder ↔ custom mapping (coding→`implementer-prompt.md`+`receiving-code-review.md`; review→`code-reviewer-prompt.md`+`code-review.md`). Adding/renaming a prompt placeholder requires updating the mapping. Mitigation: mapping centralized in one place (`custom-bake.ts` constant `PROMPT_PLACEHOLDER_MAP`), tests cover the 4 entries.
- **bake at sync, custom/project-doc changes require re-sync (snapshot constraint):** sync bake is a point-in-time snapshot — after sync, if the team changes package-root `custom/` `!include`s or an included project doc (e.g. `docs/rules/`) changes, the consumer must re-sync to propagate. Mitigation: sync is the standard specpower refresh flow; `custom/README.md` states the snapshot constraint; D11 detects `!include` residue (sync didn't run / failed), D9 detects prompt-placeholder residue (sync bake failed).
- **default include-roots assumption:** defaulting `specpower/+docs/+arch/+design/` is convention, not all projects use these dir names. Mitigation: if these dirs don't exist, `!include` throws (fail-fast, target missing), user declares actual dirs in config; non-default dirs declared via config.
- **`specpower/custom/` and prompt-copy baking touch gitignored copies:** bake writes back `specpower/custom/` (`!include` expansion) + prompt copies (placeholder replacement), both gitignored regeneratable copies, not touching package-root source. But if a user directly edits project `specpower/custom/` (violating "project doesn't self-author") it's overwritten on next sync. Mitigation: docs emphasize `specpower/custom/` is a mirror, `!include` is authored in package-root; project-level customization uses team-conventioned project dirs (e.g. `docs/rules/`) + `!include`, not writing `specpower/custom/`.

## 5. Migration Plan

Not fully greenfield — the `customization-layer` change shipped the original mechanism (subagent self-read), A-stage already changed to sync-bake + `!include` (code implemented). This change is the spec revision (making specs reflect sync-bake + `!include` as-built) + the `include-roots` default `docs/`/`arch/`/`design/` code adjustment.

- Existing `specpower/custom/` projects without `!include`: bake passes through unchanged, no behavior change.
- `include-roots` default adds `docs/`/`arch/`/`design/`: previously config-undeclared projects' `!include docs/x.md` goes from out-of-sandbox throw to expand-success (if `docs/x.md` exists). Behavior improvement, not breaking.
- `customization-layer` change (phase=built, original subagent-read specs) conflicted with this change — archive order: `customization-layer` was discarded (artifacts stale vs code), `custom-overlay-v2` is ADDED (main empty, this change first introduces these capabilities), the sole change. Resolved.

## 6. Open Questions

- ~~Archive order~~ (resolved): discarded `customization-layer` change (artifacts stale vs code, phase=built but disconnected), `custom-overlay-v2`'s 3 specs are all ADDED (main empty, this change first introduces these capabilities), the sole change.
- `include-roots` default — should it also include `arch/` etc., or just `docs/`? Now `docs/`+`arch/`+`design/` (resolved).
- D10 worktree-sync-no-stamp implementation path — resolved: (iii) auto-detect worktree (`git rev-parse --git-common-dir` vs `--show-toplevel` mismatch).
