# Contributing to SpecPower

## Project Structure

```
src/                     TypeScript source (compiled to dist/)
  cli/commands/          CLI command implementations
  core/                  Parsers, validation, archive, specs-apply
    artifact-graph/      Schema loader, dependency graph, state tracker
    parsers/             Markdown and delta-spec parsing
    templates/           Template types and rendering
    validation/          Spec validation constants and rules
  utils/                 File system, change metadata, change utilities

skills/                  SKILL.md files (10 total, one per workflow command)
prompts/                 Prompt instruction files organized by command
schemas/                 Workflow schema definitions (YAML)
templates/               Artifact templates (proposal, spec, design, tasks)
test/                    Vitest test files mirroring src/ structure
```

## How to Write `test-plan.md`

A change with at least one delta Scenario gets a `test-plan.md` (generated at
plan Stage 5b, iterated in refine, consumed by build Phase B, coverage-checked by
verify, archived by done — never merged into `specpower/specs/`).

Format (see `templates/test-plan.md`):

```markdown
## Capability: <cap>

### Requirement: <req> → Scenario: <scenario name>

- **Case** T1: <description> [positive]
  - Input: <input>
  - Expected: <result>
  - it(): <planned test name>
```

Rules:
- **Reference Scenarios by name** (delta or baseline) — do not copy WHEN/THEN.
- **Stable, change-unique `id:`** (`T1`, `T2`, …). Never renumber or reuse ids;
  on regeneration, read the old file and preserve existing ids.
- **Token in test code** is globally unique: `[<changeName>-<id>]`
  (e.g. `it('throws on unknown [add-test-plan-artifact-T3]', …)`), so verify can
  link cases across coexisting changes without collision.
- **Coverage**: every delta Scenario ≥1 Case; every failure-admitting
  Requirement ≥1 `[negative]` Case (contract-violating/abnormal). Legitimate
  boundary values the contract accepts are `[positive]`.
- After edits, run `specpower validate specpower/changes/<name>/specs/<cap>/spec.md`
  to confirm coverage.
- Change names must be globally unique (active + archived) — `change new`
  rejects reuse, because the token prefix depends on it.

## How to Update Prompts

Prompt files live in `prompts/` and are referenced by SKILL.md files using
paths like `.claude/specpower/prompts/build/phase-a-plan.md`.

When editing prompts, follow these rules:

1. **Skill name substitutions**: Prompt files use `specpower` as the skill
   namespace. If you fork or rename the project, update all references to
   match (grep for `specpower` in prompts and skills).

2. **Path consistency**: Every path referenced in a SKILL.md must resolve to
   an actual file in `prompts/`. The integration test
   `test/integration/prompt-paths.test.ts` verifies this automatically.

3. **Source attribution**: When incorporating content from upstream OpenSpec
   or Superpowers repositories, add a comment at the top of the file:
   ```
   <!-- SOURCE: openspec/prompts/proposal-instruction.md -->
   ```
   or
   ```
   <!-- SOURCE: superpowers/skills/writing-plans/SKILL.md -->
   ```

4. **Reference material**: Upstream content that is included verbatim (not
   rewritten) goes in `prompts/reference/openspec/` or
   `prompts/reference/superpowers/`. These files are not directly referenced
   by SKILL.md files but serve as source material.

## How to Port Upstream Changes

SpecPower merges content from two upstream repositories:

- **OpenSpec** -- artifact workflow, schema, and planning prompts
- **Superpowers** -- execution skills, TDD, code review, branching

To port changes from upstream:

1. Identify which upstream file changed and its corresponding file in this
   repository. Check `prompts/reference/` for unmodified copies.

2. Apply the upstream change to the specpower version, adapting:
   - Skill names: `openspec-*` or `superpowers:*` become `specpower-*`
   - Path prefixes: `.claude/openspec/` becomes `.claude/specpower/`
   - CLI commands: `openspec` becomes `specpower`

3. Update the `<!-- SOURCE: ... -->` comment with the new upstream commit or
   version.

4. Run tests to verify nothing broke: `npm test`

## Running Tests

```bash
npm test            # Run all tests (vitest)
npm run test:watch  # Run in watch mode
```

Tests are organized to mirror the source structure:

| Directory | Coverage |
|---|---|
| `test/cli/` | CLI command logic |
| `test/core/` | Parsers, validation, archive, artifact graph |
| `test/utils/` | File system utilities, change metadata |
| `test/integration/` | Full lifecycle, delta merge, prompt integrity, build |

All pull requests should maintain passing tests. Integration tests in
`test/integration/` verify end-to-end behavior including:

- Full change lifecycle (create, status, archive)
- Delta merge correctness (ADDED, MODIFIED, REMOVED)
- Prompt path integrity (no broken SKILL.md references)
- Package build verification (TypeScript, assets, version)

## Source Attribution

Files derived from upstream repositories include a source comment:

```markdown
<!-- SOURCE: openspec/core/archive.ts -->
<!-- SOURCE: superpowers/prompts/executing-plans.md -->
```

This convention makes it easy to trace changes back to their origin and
identify which files need updating when upstream changes are ported.
