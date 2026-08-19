# Refine-Phase Artifact Update Methodology

> **HARD GATE**: Every update must preserve format compatibility with `specpower validate`
> and `specpower change archive`. A round that cannot produce a validated file set must
> revert rather than ship half-valid artifacts.

This prompt is invoked by `.claude/specpower/prompts/refine/brainstorm.md` during Step 5
(Write/update artifacts) of each refine round. It owns impact analysis, user scope choice,
per-artifact routing, format preservation, and post-update validation.

## When to use this prompt

- A refine round has surfaced a concrete update needed in one or more artifacts
  (proposal.md, delta specs, design.md, or tasks.md).
- brainstorm.md has completed Steps 1-4 and has a discussion trail ready to be committed
  to files.
- You have NOT yet written any file content in this round — update-artifacts.md owns the
  writing phase.

Do not invoke this prompt for read-only discussion. If the round's conclusion is "keep
talking, no writes yet," skip straight to brainstorm.md Step 7 (user approval).

## Routing Rules

Before writing, route each piece of discussion output to the correct artifact. Use the
table below as the default; if a topic genuinely belongs in more than one file, list all
of them in the impact analysis.

| Discussion topic                                              | Update file                   |
|---------------------------------------------------------------|-------------------------------|
| Scope / motivation changed (why or what-changes shifted)      | `proposal.md`                 |
| Capability added or removed                                   | `proposal.md` + spec files    |
| New scenario / missed edge case / error mode                  | `specs/**/*.md`               |
| Requirement phrasing or WHEN/THEN bullet refinement           | `specs/**/*.md`               |
| Implementation constraint / design decision emerged           | `design.md`                   |
| Alternative option chosen over the plan's original pick       | `design.md`                   |
| Open question that cannot be resolved in this round           | `design.md` (`## Open Questions`) |
| Task structure implications (add/remove/reorganize groups)    | `tasks.md`                    |
| Task ordering / dependency change                             | `tasks.md`                    |
| Test-case add/merge/edit (preserve `id:` + scenarioRef)        | `test-plan.md`                |
| Change splits into multiple changes                           | Stop; raise with user before writing anything |

If the discussion implies a cascade (e.g., new capability → new spec file → new task
group), list every affected file in the impact analysis and let the user choose scope.

## Impact Analysis Template

Before touching any file, present this block to the user and wait for choice:

```
Proposed update affects:
  - <file1>: <what changes>
  - <file2>: <what changes>
  - <file3>: <what changes> (if applicable)

This round can:
  A) Apply all updates together
  B) Update only primary file (<file1>), defer others to next round
  C) Defer entirely, continue discussing

Choice? [A/B/C]
```

Interpretation:

- **A**: apply every listed update in this round. The diff summary at round end will show
  all files changed.
- **B**: apply only the primary file; the deferred files are carried into the NEXT round's
  discussion queue (brainstorm.md's multi-round loop is what picks them up — that is the
  entire point of having a loop).
- **C**: write nothing this round. The discussion continues; the round still counts toward
  the minimum-2-rounds threshold and the round-end diff summary reports "no changes this
  round" honestly.

Never proceed to writing without an explicit A/B/C choice from the user.

## Format Preservation Rules

Each artifact type has format contracts that `specpower validate` and `specpower change
archive` rely on. Violating them breaks downstream automation.

### `proposal.md`

Must retain these top-level section headers in this order:

- `## Why` — motivation paragraph(s)
- `## What Changes` — bulleted list of changes
- `## Capabilities` — enumeration of capabilities added/modified/removed
- `## Impact` — affected files, specs, risks

If your update adds new content, put it under the correct section; do not introduce new
top-level sections without first asking the user.

### `specs/**/*.md`

Must retain:

- `### Requirement:` (three hashes + "Requirement:" + colon) for every requirement header
- `#### Scenario:` (EXACTLY four hashes + "Scenario:" + colon) for every scenario header —
  three hashes will make `specpower validate` fail
- `- **WHEN**` and `- **THEN**` bullet format for every scenario body (one WHEN and one
  THEN minimum; AND bullets are allowed between them)
- Delta marker headers `## ADDED Requirements` / `## MODIFIED Requirements` /
  `## REMOVED Requirements` / `## RENAMED Requirements` when editing delta specs

Do not rename existing requirements unless putting them under `## RENAMED Requirements`
with explicit `FROM:` / `TO:` marker per spec format.

### `design.md`

Follow the archived `create-specpower-plugin` design.md style:

- `## Decisions` section with each decision as `### Decision N: <name>` (or `### DN: <name>`),
  containing:
  - `**Options considered:**` list — at least 2 options, each with pros/cons
  - `**Chosen:**` line identifying the selection
  - `**Rationale:**` paragraph explaining why
- Inline-documented, not a separate change log. The file IS the decision log.
- `## Open Questions` section for deferred decisions (new in refine).
- Existing `## Context`, `## Goals / Non-Goals`, `## Risks / Trade-offs` sections remain
  in their original spots.

### `tasks.md`

Must stay **coarse-grained**:

- Group-level headings (`## Group N: <name>`) with a short description and 3-6 tasks per
  group are the target granularity.
- Do NOT write 2-5 minute atomic tasks here — that precision comes from build Phase A.
- Preserve existing ordering cues (e.g., dependency chains between groups) unless the
  discussion explicitly reordered them.
- Checkbox bullets (`- [ ] ...`) are fine; do not replace them with numbered lists.

Coarse granularity is deliberate: refine is about direction, build Phase A is about
execution precision.

### `test-plan.md`

- Preserve `## Capability:` / `### Requirement: <req> → Scenario: <scen>` structure and
  `- **Case** <id>:` lines.
- Existing `id:` values MUST NOT be renumbered or reused; assign the next unused `T<n>`
  to new Cases.
- Each Case must have a scenarioRef (delta or baseline), a `[positive]`/`[negative]` mark,
  and Input/Expected/`it()`.
- After edits, run `specpower validate <spec>` to confirm coverage (every delta Scenario
  ≥1 Case; required negatives present; no dangling/orphan/duplicate).

## Post-update Validation

After modifying any spec file, automatically run:

```bash
specpower validate <path-to-spec>
```

Failure behavior:

1. If `specpower validate` returns non-zero, **revert** the affected file to its
   pre-edit state. Do not attempt multiple repair passes silently.
2. Report to the user: "Format issue in `<file>`: `<validator output>`. Reverted to
   pre-edit state. Shall we diagnose together?"
3. Do not proceed to the next artifact write until the user decides how to fix.

For non-spec artifact writes (`proposal.md`, `design.md`, `tasks.md`), validation is
structural — confirm the required sections from "Format Preservation Rules" above are
still present. If they are not, apply the same revert-and-report pattern.

## Diff Summary Format

At round end (brainstorm.md Step 7), the AI MUST emit this block so the user sees
concretely what moved:

```
Round <N> changes:
  - proposal.md: <summary>
  - specs/<cap>/spec.md: <summary>
  - design.md: added Decision <N> (<name>)
  - tasks.md: <summary>
```

Rules for the diff summary:

- Omit lines for files that were NOT modified in this round (don't write
  "proposal.md: no change"). If nothing was modified, the block reads
  "Round N changes: (none this round — choice C was selected)".
- For `design.md`, name the specific Decision or Open Question added/modified.
- For `specs/`, name the capability and whether ADDED/MODIFIED/REMOVED delta was applied.
- Keep each summary line under 100 characters; detailed prose lives in the files.

## Handoff

Return control to brainstorm.md Step 6 (self-review) only after:

- The user chose A/B/C.
- Chosen files were written.
- `specpower validate` passed (or no spec files were touched).
- Diff summary is prepared for Step 7.
