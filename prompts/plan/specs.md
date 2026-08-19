# Delta Specs Generation

Generate delta spec files that define WHAT the system should do for each affected capability.

## Prerequisites

- An approved proposal exists at `specpower/changes/<change-name>/proposal.md`
- User has confirmed the proposal direction

## Process

### Step 1: Read Proposal

Read the approved proposal. Extract:
- Which capabilities are listed under `### New Capabilities` and `### Modified Capabilities`
- Success criteria to translate into scenarios

### Step 2: Read Existing Specs (if modifying)

If modifying existing capabilities, read the current spec from `specpower/specs/<capability>/spec.md`:
1. Understand the current requirements and scenarios
2. For MODIFIED requirements, copy the ENTIRE requirement block first, then edit

### Step 3: Generate Delta Spec Files

Create one spec file per capability at `specpower/changes/<change-name>/specs/<capability>/spec.md`.

**CRITICAL FORMAT — the specpower CLI parses this exact structure. Deviations will cause validation and archive failures.**

Use `##` headers for delta operation sections. Use `###` for requirements. Use `####` for scenarios. Use `- **WHEN**` and `- **THEN**` bullet format for scenario steps.

```markdown
## ADDED Requirements

### Requirement: <requirement name>
<Description using SHALL/MUST for normative language.>

#### Scenario: <scenario name>
- **WHEN** <precondition or trigger>
- **THEN** <expected outcome>

#### Scenario: <another scenario>
- **WHEN** <condition>
- **THEN** <outcome>

## MODIFIED Requirements

### Requirement: <existing requirement name>
<Full updated description — MUST include complete content, not just the diff.>

#### Scenario: <scenario name>
- **WHEN** <condition>
- **THEN** <new expected outcome>

## REMOVED Requirements

### Requirement: <requirement name>
**Reason**: <why this is being removed>
**Migration**: <how users should adapt>

## RENAMED Requirements

FROM: <old requirement name>
TO: <new requirement name>
```

**Format rules:**
- Each requirement: `### Requirement: <name>` followed by description
- Use SHALL/MUST for normative requirements (avoid should/may)
- Each scenario: `#### Scenario: <name>` — **MUST use exactly 4 hashtags (`####`)**. Using 3 hashtags will fail validation silently.
- Scenario steps: `- **WHEN** <condition>` and `- **THEN** <outcome>` — **MUST use bullet dash + bold format**
- Every requirement MUST have at least one scenario
- Only include the sections you need (e.g., only `## ADDED Requirements` for new capabilities)

**MODIFIED requirements workflow:**
1. Read the existing requirement from `specpower/specs/<capability>/spec.md`
2. Copy the ENTIRE requirement block (from `### Requirement:` through all scenarios)
3. Paste under `## MODIFIED Requirements` and edit to reflect new behavior
4. The requirement name must match exactly (whitespace-insensitive)

**Common pitfall:** Using MODIFIED with partial content loses detail during archive. If adding new concerns without changing existing behavior, use ADDED instead.

**Negative scenario coverage check (per requirement):**
After writing scenarios for a requirement, verify:
- Does it have at least one error path scenario (contract-violating input: invalid type, missing required arg, null where forbidden, permission denied)?
- Does it have at least one invalid-state or resource-exhaustion scenario (if applicable)?
- Are legitimate-boundary scenarios (empty/extreme/large valid inputs) classified as **positive**, not negative?
- **De-duplicated?** Group negative scenarios by failure dimension. Two scenarios probing the same contract violation should be merged. Invariants (e.g., "does not mutate input") count as positive.
- For side-effect-bearing capabilities: is negative ratio ≥ 30%? For pure-function capabilities: 15-30% is healthy — do not pad.
If any check fails, add or merge scenarios before moving to the next requirement.

### Step 4: Validate

Run validation on each generated spec file:

```bash
specpower validate specpower/changes/<change-name>/specs/<capability>/spec.md
```

If validation fails, fix the format issues and re-validate.

### Step 5: Save and Present

Save each spec file. Then present a summary:

> "Generated N delta specs:
> - `<capability-1>`: ADDED (N requirements, M scenarios)
> - `<capability-2>`: MODIFIED (N requirements)
>
> All validated. Files at `specpower/changes/<change-name>/specs/`."

## Principles

- **One delta spec per capability** — don't merge unrelated capabilities
- **WHEN/THEN is mandatory** — every behavioral change must have at least one scenario
- **Be specific** — "WHEN user runs `notecli export`" not "WHEN user interacts"
- **Include negative scenarios** — every requirement MUST cover at least these **contract-violating / abnormal** categories:
  - **Error path**: invalid input (wrong type, malformed), missing required arguments, permission denied, null where contract forbids it
  - **Invalid state**: operation called in wrong state (before init, after close, wrong phase)
  - **Resource exhaustion to failure**: timeout, disk full, rate limit exceeded
  - Target: ≥ 1 negative scenario per requirement. For side-effect-bearing capabilities, aim for ≥ 30% negative; pure-function capabilities may naturally be lower (15-30%).
  - **Important**: legitimate boundary values (empty collection, extreme values, large inputs) are **positive** scenarios if the function accepts them as valid input — do NOT count them as negative to pad the ratio. See `prompts/reference/specpower/negative-testing-guide.md` for the positive/negative distinction.
- **Specs are testable** — each scenario is a potential test case
- **No implementation details** — describe behavior, not how to build it

## Next Step

Once delta specs are approved:
- If the change has ≥1 Scenario (testable), read `prompts/plan/test-plan-draft.md` and draft `test-plan.md` (NL test cases before code; cases carry a stable `id:` and the test code embeds a `[<changeName>-<id>]` token).
- Proceed to `/specpower:refine` for design work or `/specpower:build` for planning.
