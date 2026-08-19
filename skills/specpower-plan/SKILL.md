---
name: specpower-plan
description: "First-iteration deep analysis -- proposal + specs + design + tasks"
---

# SpecPower: Plan

> **HARD GATE**: User must confirm proposal before specs generation.

## Purpose

Plan is the **first-iteration deep-analysis pass**: in a single invocation it produces all four change artifacts (`proposal.md`, delta `specs/`, `design.md`, `tasks.md`). The design and tasks are substantive first drafts — not placeholders — but `/specpower:refine` will later rewrite them across multiple rounds of iteration, and `/specpower:build` Phase A will regenerate `tasks.md` under strict writing-plans rules.

Treat every artifact here as "v1, to be iterated on" — depth matters, but so does moving through all four stages in one pass.

## Prerequisites

- `specpower/specs/` directory should exist, indicating this is a specpower-initialized project. For a brand-new greenfield change with no existing specs, proceed — the prompt handles that case. If `specpower/` itself does not exist, suggest running `specpower init` first.
- `specpower` CLI must be available on PATH.

## Stage 1: Create Change

Run `specpower change new <name>` to initialize a new change directory.

The CLI automatically sets `phase=plan` in `.specpower.yaml` on creation (no separate phase call needed here).

## Stage 2: Generate Proposal

Read the file at `.claude/specpower/prompts/plan/proposal.md` and follow its instructions.

**Important**: That prompt file contains the required interactive Q&A flow, the exact proposal format (`## Why` / `## What Changes` / `## Capabilities` / `## Impact`), and the user confirmation gate. You MUST read it before writing the proposal — do not invent the format.

Generate the proposal document inside the change directory at `specpower/changes/<name>/proposal.md`.

### Gate: Proposal Confirmation (HARD GATE)

Present the proposal to the user.
**Ask the user to confirm the proposal.**
Do NOT proceed to specs generation until the user explicitly confirms. This is the only mandatory hard gate in the plan flow — everything that follows flows through without interruption so the user can review the full first-iteration package at the end.

## Stage 3: Generate Specs

Read the file at `.claude/specpower/prompts/plan/specs.md` and follow its instructions.

Generate delta specs inside the change directory at `specpower/changes/<name>/specs/<capability>/spec.md`.

### Gate: Specs Confirmation (optional light gate)

Briefly summarize the delta specs generated. Accept a quick acknowledgement from the user ("looks good" / "continue") and proceed. If the user raises substantive objections, pause and revise — otherwise continue directly to Stage 4. This is an optional checkpoint, not a full hard gate; deeper scrutiny will happen in `/specpower:refine`.

## Stage 4: Generate Design (first-iteration)

Read the file at `.claude/specpower/prompts/plan/design-draft.md` and follow its instructions.

Generate `design.md` inside the change directory. This draft should be substantive: identify real architectural decisions, capture options considered, and record rationale. It is a first iteration — `/specpower:refine` will deepen it through multiple brainstorming rounds — but it is NOT a placeholder.

**No gate here.** Continue directly to Stage 5. The user will review everything together at Stage 6.

## Stage 5: Generate Tasks (first-iteration)

Read the file at `.claude/specpower/prompts/plan/tasks-draft.md` and follow its instructions.

Generate `tasks.md` inside the change directory. Produce a substantive first-iteration task breakdown (3–8 tasks typical), ordered with dependencies. Do not write placeholders like "TBD" or "implement feature". `/specpower:build` Phase A will rewrite this file under strict writing-plans rules, but this first draft feeds both `/specpower:refine` context and Phase A analysis.

**No gate here.** Continue directly to Stage 5b.

## Stage 5b: Generate test-plan (first-iteration)

Read the file at `.claude/specpower/prompts/plan/test-plan-draft.md` and follow its instructions.

Generate `specpower/changes/<name>/test-plan.md` from the delta specs' Scenarios. Each delta Scenario → ≥1 Case with a stable `id:` (`T1`, `T2`, …, never renumbered); failure-admitting Requirements get ≥1 `[negative]` Case. Cases reference Scenarios by name (do not copy WHEN/THEN). Skip if the change has no delta Scenario and no regression cases (non-testable change).

Run `specpower validate specpower/changes/<name>/specs/<cap>/spec.md` to confirm coverage (every Scenario ≥1 Case; required negatives present).

**No gate here.** Continue directly to Stage 6.

## Stage 6: Final Review

Present all four artifacts to the user with clear "first-iteration" labeling:

- `proposal.md` — confirmed in Stage 2
- Delta `specs/` under the change directory — the contract
- `design.md` — **first-iteration draft**; `/specpower:refine` will deepen this across multiple rounds
- `tasks.md` — **first-iteration draft**; `/specpower:build` Phase A will rewrite this under strict writing-plans rules
- `test-plan.md` — **first-iteration draft** generated in Stage 5b; `/specpower:build` Phase B will consume it as the TDD spec

Make the iteration expectation explicit: the user should not treat design/tasks as final. They are deliberate first drafts produced so downstream skills have real substance to work with.

### Next Step

Suggest `/specpower:refine` to enter the multi-round refinement loop that rewrites `design.md` (and optionally updates the other artifacts) based on brainstorming. After refine completes, `/specpower:build` will consume the refined artifacts.

No hard gate after Stage 6 — `/specpower:refine` owns the next overall validation gate.
