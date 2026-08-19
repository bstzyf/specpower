> **HARD GATE**: No implementation or scaffolding until user confirms refined artifacts.

<!-- SOURCE: Superpowers brainstorming (skills/brainstorming/SKILL.md) + specPower refine-phase adaptation -->

# Refine-Phase Brainstorming: Attacking Deep Review

> This prompt is for **ATTACKING DEEP REVIEW** of plan-phase artifacts.
> NOT from-scratch brainstorming. The 4 artifacts (proposal, specs, design, tasks)
> already exist and must be challenged, deepened, and possibly updated.

Plan already produced first-iteration drafts. Your job in refine is to **attack those drafts**:
surface glossed-over assumptions, propose unconsidered alternatives, explore omitted boundaries,
and question scope — then update whichever artifacts the discussion shows are out of sync.

## Entry Context

Before running this brainstorming flow, you MUST have read:

- `specpower/changes/<name>/proposal.md`
- `specpower/changes/<name>/specs/**/*.md`
- `specpower/changes/<name>/design.md`
- `specpower/changes/<name>/tasks.md`
- `specpower/specs/` baseline (main specs) for reference
- `.claude/specpower/prompts/refine/update-artifacts.md` (the delegated artifact-update methodology)

If any of the four change artifacts is missing, stop and tell the user to run `/specpower:plan` first.

## Iteration Rules

- **Minimum 2 rounds** is unconditional. Round 1 is unconditional. Round 2 is unconditional.
  Do not ask the user "should we keep going?" before round 2 finishes — minimum 2 rounds means
  at least 2 rounds, every time.
- After round 2, AI performs **semantic judgment of convergence** (see Step 8). If
  meaningful unaddressed challenges, scope concerns, or stale artifact states remain,
  run another round. If nothing substantive remains, proceed to the final next-step
  announcement.
- **No upper limit.** Refine continues as long as each round produces substantive new challenges.
- The AI MUST explicitly announce `Round N start` when a round begins and `Round N end` when
  the round's updates and diff summary are complete, so the user always knows which round they
  are in.
- The user may request additional rounds at any time (even after AI judges convergence); user
  request overrides AI convergence judgment.

## The 9-Step Process (per round)

Each round runs all 9 steps in order. Steps 1–2 are where the 4 challenge behaviors are
injected; steps 3–5 carry the discussion into artifacts; steps 6–8 close the round.

### Step 1 — Examine existing artifacts (inject Challenge Behavior #1)

Re-read all 4 plan-phase artifacts with fresh eyes. This is not a summary exercise — look for
what the plan *did not* say. Explicitly INJECT **Challenge Behavior #1 (challenge plan's
assumptions)** here: list assumptions the plan glossed over and explain why each matters. Each
round MUST produce this list of challenged assumptions, even if shorter than the previous round.

### Step 2 — Ask clarifying questions (inject Challenge Behaviors #3 and #4)

Ask the user clarifying questions one at a time, prefering multiple-choice where the options
are reasonably enumerable. This is where you INJECT **Challenge Behavior #3 (explore omitted
boundaries)** — survey edge cases, permissions, error modes, non-functional concerns absent
from specs — and **Challenge Behavior #4 (question scope)** — ask whether the change is too
broad, too narrow, or should be split. Clarifying questions are how you explore boundaries
the plan omitted and how you question scope with the user directly.

Keep per-message questions small (1 question per message). Batch the mental exploration but
serialize the user-facing dialogue.

### Step 3 — Propose 2-3 approaches with trade-offs (inject Challenge Behavior #2)

For every non-trivial design decision surfaced by Steps 1–2 (both the ones in the existing
`design.md` and new ones revealed by this round's challenges), INJECT **Challenge Behavior #2
(propose new options)**: for each existing decision, propose alternative approaches not
considered in the plan — at least 2 such alternatives per decision, each with pros/cons and
a recommendation.

The 2-3 approaches MUST include the currently-chosen option from `design.md` PLUS genuinely
different alternatives — not cosmetic variants. If the existing choice still wins, say so
explicitly with a rationale that references the alternatives considered.

### Step 4 — Present design sections (show proposed updates)

Present the design sections being proposed for update. Scale each section to its complexity:
a few sentences for straightforward points, up to 200–300 words when a decision is nuanced.
Show the user what would change in `design.md`, which `specs/**/*.md` files would be touched,
and whether `proposal.md` or `tasks.md` are affected. Ask after each significant section
whether the direction looks right.

### Step 5 — Write/update artifacts (DELEGATE)

DELEGATE to `.claude/specpower/prompts/refine/update-artifacts.md` for impact analysis, user
scope choice (A/B/C), format preservation rules, per-artifact routing, and post-update
validation.

Do not re-invent the artifact update rules here — the delegated prompt owns them. Return here
only after the delegated update-artifacts prompt reports back that files are written and
validated.

### Step 6 — Self-review (format + consistency)

With fresh eyes on the just-updated artifacts:

1. **Placeholder scan** — no "TBD", "TODO", or vague requirements; fix inline.
2. **Internal consistency** — sections do not contradict each other; architecture matches
   feature descriptions; spec scenarios match design decisions.
3. **Format compliance** — run `specpower validate` on any updated spec file. See
   `update-artifacts.md` "Post-update Validation" section for the expected behavior on
   validation failure (revert + report).
4. **Round-traceable discussion trail** — any newly resolved decision must appear in
   `design.md` under `## Design Decisions` as a `### Decision N: <name>` block with
   `**Options considered:**`, `**Chosen:**`, and `**Rationale:**`.

Fix issues inline. Do not re-enter Step 5 unless a revert happens.

### Step 7 — Request user approval for this round

Present the round's diff summary (see `update-artifacts.md` "Diff Summary Format") and ask:

> "Round N produced these updates. Does the direction look correct, or do you want to revisit
> anything before I continue to Step 8 (convergence judgment)?"

Wait for user acknowledgement. If the user requests revisions, loop back to Step 3 or Step 5
as appropriate within this round.

### Step 8 — Judge convergence

Apply the convergence rules (see also "Convergence Criteria" section below):

- **If this was Round 1**: unconditionally continue. Announce `Round 1 end` and immediately
  start Round 2 from Step 1. The minimum-2-rounds rule is non-negotiable.
- **If this was Round 2 or later**: perform AI semantic convergence judgment. Ask
  yourself:
  - "Are there still meaningful unaddressed challenges from the 4 challenge behaviors?"
  - "Are there still open clarifying questions from Step 2?"
  - "Are there scope concerns that have not been resolved or explicitly parked?"
  - "Is any artifact still in a state that doesn't reflect the full discussion?"
  - "Has the user introduced a new consideration in the latest round that has not yet
    propagated into the artifacts?"
- **If ANY of the above yields yes**: convergence NOT reached. Loop back to Step 1 for the
  next round.
- **If ALL yield no**: convergence reached. Proceed to Step 9.

Remember: the user may override convergence. If after AI announces convergence the user says
"actually, let's dig into X," that is treated as a new round — do not skip to Step 9.

### Step 9 — Next-step indication (only at final convergence)

Only reached when Step 8 produced "converged" AND the user did not override it.

Announce clearly:

> "Refine converged after N rounds. All artifacts have been updated and validated. Please
> review the final state of proposal.md, specs/, design.md, tasks.md. Confirm that this
> refined state is what you want — on confirmation I will mark phase as `refined` and you
> can run `/specpower:build` next."

Do NOT invoke phase transition directly from this prompt — the calling SKILL.md owns that
handoff, which happens only after explicit user confirmation of the final refined state.

## The 4 Challenge Behaviors

The 4 behaviors are injected into the 9-step process above, but each round MUST produce
explicit, substantive output for each. Do not let them be implicit. The user should be able
to see each behavior fired in the round's output.

### Behavior 1 — challenge plan's assumptions

- **Rationale**: plan was a first-iteration pass; assumptions were made under incomplete
  information and some were glossed over. Refine's job is to challenge those assumptions
  before they harden into implementation.
- **AI self-prompt**: "What did the plan treat as given that actually deserves interrogation?
  What 'of course'-flavored premises are hiding in `proposal.md` or `design.md`?"
- **Sample user-facing question**: "The plan implies that [X]. Is that actually true for this
  user/context, or is it a plan-time shortcut?"
- **Expected output per round**: a bulleted list titled "Plan assumptions under scrutiny"
  with at least 1 item (generally 2-5 early rounds, trailing toward 0 as convergence nears).

### Behavior 2 — propose new options

- **Rationale**: plan usually picked the first-plausible option per decision. For each
  existing design decision you should propose alternatives — alternatives are where better-fit
  designs emerge.
- **AI self-prompt**: "For each design decision already in `design.md`, what are the
  alternatives the plan did not consider? For each new decision surfaced by this round's
  challenges, what are the 2-3 approaches?"
- **Sample user-facing question**: "The plan chose [current approach] for decision D3. I
  also see two alternatives worth considering: [alt A] and [alt B]. Shall I walk through
  trade-offs?"
- **Expected output per round**: for at least one existing decision, a block showing
  `currently chosen` + `alternative A` + `alternative B` with pros/cons for each.

### Behavior 3 — explore omitted boundaries

- **Rationale**: plan specs are drafted under time pressure and tend to cover happy paths
  first. You must explore omitted boundaries — edge cases, permissions, errors,
  non-functional concerns — because those are the most common omissions.
- **AI self-prompt**: "What scenarios belong in the specs but are missing? What permission,
  auth, or concurrency case isn't covered? What error/failure mode has no `#### Scenario:`?"
- **AI self-prompt (negative coverage audit)**: "For each requirement in the specs, does it
  have at least one **contract-violating** error path scenario (invalid input, null where
  forbidden, permission denied)? One invalid-state or resource-exhaustion scenario if
  applicable? Are legitimate-boundary scenarios (empty/extreme/large valid inputs) correctly
  treated as positive, not miscounted as negative? For side-effect-bearing requirements, is
  the negative ratio ≥ 30%? For pure-function requirements, 15-30% is healthy — do not pad.
  See `prompts/reference/specpower/negative-testing-guide.md`."
- **Sample user-facing question**: "I don't see a scenario for [failure mode / concurrent
  user / permission-denied path]. Should it be added, explicitly excluded, or deferred?"
- **Sample user-facing question (coverage)**: "Requirement [X] has only happy-path
  scenarios. I'd propose adding [error path / invalid state / resource exhaustion] scenarios
  to cover contract-violating inputs. Shall I add them?"
- **Expected output per round**: a checklist of abnormal/error scenarios examined, each marked
  `covered` / `missing → propose adding` / `explicitly out of scope`, PLUS a per-requirement
  negative coverage audit marking each requirement as `adequate` / `under-covered → propose
  N scenarios` / `explicitly out of scope` (with legitimate-boundary scenarios correctly
  classified as positive).

### Behavior 4 — question scope

- **Rationale**: plan sets scope early with incomplete information. Refine is the right
  place to question scope — whether the change is too broad (decompose), too narrow
  (expand), or mis-cut (split capability A from B).
- **AI self-prompt**: "Does the change try to do too much? Too little? Are any capabilities
  being bundled that should live in separate changes?"
- **Sample user-facing question**: "Capability [X] and capability [Y] are being changed
  together in this proposal. They seem to have independent rollout schedules. Should they
  split into two changes?"
- **Expected output per round**: a short paragraph titled "Scope check this round" with a
  stance (scope is fine / too broad / too narrow / should split) and supporting reasoning.

## Format Compliance

Format compliance is fully delegated to `.claude/specpower/prompts/refine/update-artifacts.md`.
Do not duplicate the format rules here — read that prompt during Step 5. In summary, it
owns: per-artifact format preservation, `specpower validate` gating, revert-on-failure, and
diff summary format.

## Convergence Criteria

- **At least 2 rounds** is unconditional (minimum 2 rounds). Do not short-circuit.
- After round 2, convergence is decided by AI **semantic judgment** using the questions in
  Step 8.
- Convergence is a product of: no remaining unaddressed challenges across the 4 behaviors,
  no open clarifying questions, no stale artifacts.
- The user can extend past AI-declared convergence at any time.
- Each round's convergence decision and its reasoning MUST be visible to the user (part of
  the round-end announcement in Step 8).

## Next Step

After Step 9 announces final convergence AND the user confirms the refined state:
the calling SKILL.md will invoke `specpower change phase <name> --set refined`, then suggest
`/specpower:build` as the next slash command to run.

This prompt itself never writes the phase transition — that is the SKILL orchestrator's job,
and it happens only after explicit user confirmation of the refined state.
