# Project Customization

This directory is the **source of truth for team-distributed rules**. It ships
inside the specpower package and is synced into every project via
`specpower init`/`sync` to `<toolRoot>/specpower/custom/` (gitignored there —
projects do NOT commit it; it refreshes with each package version).

Rules are split by where they apply:

- `coding/` — read by code **generation/implementation** workflows
  (`/specpower:build` implementer, `/specpower:fix`). Put naming, structure,
  pattern, and style conventions that code must follow when written.
- `review/` — read by code **review** workflows (`/specpower:review`).
  Put checkable rules a reviewer should flag.

Both are **additional** dimensions layered ON TOP of specpower's built-in
checklist — they do not replace it. Drop any number of `.md` files into each
directory; all **top-level** `.md` files (subdirectories and non-`.md` files are
ignored) are read and applied in **lexicographic (dictionary) filename order**.

## Ordering

Use **zero-padded numeric prefixes** to control order — dictionary order puts
`10-naming.md` BEFORE `2-naming.md` (because `"1" < "2"`), so write
`01-naming.md`, `02-architecture.md`, `10-security.md` to get natural order.

## Format

Use markdown. Group rules by category. For each rule, optionally specify a
severity tag at the start: `[Critical]`, `[Important]`, or `[Minor]`.
Unspecified rules default to Important.

## Absence is fine

If a directory is empty or missing, the corresponding workflow proceeds with
the built-in checklist only — no error.

## Includes (reuse project docs)

A custom `.md` may pull in existing project documentation (coding-style, ADRs,
architecture notes, or team-conventioned project-rule dirs) instead of
duplicating it, via a whole-line directive:

```
!include docs/coding-style.md
```

A **wildcard** form expands all matching files in a directory (lexicographic,
extension-whitelisted):

```
!include docs/rules/*.md
```

- `*` matches non-`/` chars; `?` matches one non-`/` char. Only `*`/`?` are special.
- Matched files are sorted lexicographically — use zero-padded numeric
  prefixes (`01-`, `02-`, `10-`) to control precedence (dictionary order puts
  `10-` before `2-` without zero-padding).
- Only extension-whitelisted matches are included (`.md`/`.txt`/`.yaml`/`.yml`/`.json`);
  other files in the directory are ignored.
- Each matched file is recursively expanded (its own `!include`s resolved).
- **No matches → throws** (fail-fast: an empty/non-matching wildcard is a
  config error, not a silent no-op). Directory missing or outside the sandbox
  also throws.

- **Path**: relative to the **project root** (e.g. `!include docs/x.md`,
  `!include arch/adr-007.md`, or `!include specpower/custom/review/shared.md`
  for custom-to-custom reuse). Never absolute.
- **Sandbox**: the target must resolve under an **include-root**. Default
  include-roots are `specpower/`, `docs/`, `arch/`, `design/` (always allowed,
  no config needed). Declare additional project doc dirs in
  `specpower/config.yaml`:
  ```yaml
  custom:
    include-roots: [wiki/]
  ```
- **Recursion**: includes expand recursively (`A !include B`, `B !include C`).
  Cycles throw; depth is capped; once semantics is **per-top-level-file**
  (diamond includes within one file expand once; the same file included by
  two different custom `.md` files expands in each — no cross-file starvation).
- **Hard limits**: per-file 64 KB, total 256 KB, extensions
  `.md`/`.txt`/`.yaml`/`.yml`/`.json` only (no source code, lockfiles, or
  binaries).
- **When**: expansion happens at **`specpower init`/`sync`** bake time, in
  place — the files written to `specpower/custom/` are already-expanded plain
  text, and the rule text is also baked into the corresponding prompt-file
  placeholder (see D1 in design.md). The controller/subagent never sees
  `!include`; it reads the baked prompt.

**Failure policy (fail-fast — no silent degradation):**

ALL failures throw and abort the sync with a message naming the offending
file, line, and directive. A degraded comment would let sync "succeed" while
the user's custom rules silently don't take effect, causing hours of later
debugging "why aren't my rules applied". This applies to: target missing,
target outside every include-root, circular include, depth cap exceeded,
per-file/total size cap exceeded, disallowed extension, absolute path, and
directory target.

**Project-level customization (team-conventioned project dirs):**

A team can reserve a project-level customization mechanism by convention —
e.g. "each project puts its own coding rules in `docs/rules/`" — and
`!include docs/rules/*.md` from the team package's `custom/`. The project
rules are not in the package source; they live in the project and are pulled
into the prompt via recursive `!include` at sync bake time.

**Snapshot constraint (re-sync on change):**

sync bake is a point-in-time snapshot. After sync, if a project doc that a
`!include` references (e.g. `docs/rules/coding-style.md`) is modified, the
baked prompt still contains the old snapshot — the system does NOT
auto-detect project-doc changes. Re-run `specpower sync` to refresh the
baked prompt with the new content.

## How teams distribute

A team forks specpower, edits this `custom/` directory at the package root,
and releases the customized package. Projects consuming it get the team's rules
via `specpower sync`, without writing rules themselves.
