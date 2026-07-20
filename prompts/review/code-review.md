<!-- SOURCE: skills/requesting-code-review/SKILL.md + skills/requesting-code-review/code-reviewer.md -->

# Code Review

Dispatch a code-reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation -- never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- After each task in specpower:build Phase B
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Dispatch code-reviewer subagent:**

Use Task tool with the review template below, filling in the placeholders.

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## specPower Regression Check

**Before concluding the review, the reviewer MUST also check:**

If `specpower/specs/` exists in the repository:
1. Read all relevant spec files from `specpower/specs/`
2. Verify the changes do not regress any existing spec requirements
3. Confirm the changes align with the declared behavior in specs
4. Flag any spec violations as Critical issues

## Code Reviewer Template

```
Task tool (general-purpose):
  description: "Review code changes"
  prompt: |
    You are reviewing code changes for production readiness.

    **Your task:**
    1. Review {WHAT_WAS_IMPLEMENTED}
    2. Compare against {PLAN_OR_REQUIREMENTS}
    3. Check code quality, architecture, testing
    4. Categorize issues by severity
    5. Assess production readiness

    ## What Was Implemented

    {DESCRIPTION}

    ## Requirements/Plan

    {PLAN_REFERENCE}

    ## Git Range to Review

    **Base:** {BASE_SHA}
    **Head:** {HEAD_SHA}

    ```bash
    git diff --stat {BASE_SHA}..{HEAD_SHA}
    git diff {BASE_SHA}..{HEAD_SHA}
    ```

    ## Review Checklist

    **Code Quality:**
    - Clean separation of concerns?
    - Proper error handling?
    - Type safety (if applicable)?
    - DRY principle followed?
    - Edge cases handled?

    **Architecture:**
    - Sound design decisions?
    - Scalability considerations?
    - Performance implications?
    - Security concerns?

    **Testing:**
    - Tests actually test logic (not mocks)?
    - **Legitimate boundary tests present?** (empty array, single element, extreme values, large input — these are POSITIVE tests verifying correct behavior at edges with valid inputs)
    - **Error path tests present?** (contract-violating input: wrong type, null where forbidden, permission denied, malformed)
    - **State guard tests present?** (operation before init, after close, wrong phase)
    - **Negative ratio appropriate?** Count only contract-violating/abnormal tests as negative; legitimate-boundary tests count as positive. For side-effect functions flag if < 30%; for pure functions 15-30% is healthy — flag if it appears padded by misclassified boundary tests. See `prompts/reference/specpower/negative-testing-guide.md`.
    - Integration tests where needed?
    - All tests passing?

    **Requirements:**
    - All plan requirements met?
    - Implementation matches spec?
    - No scope creep?
    - Breaking changes documented?

    **Spec Regression (if specpower/specs/ exists):**
    - Read relevant specs from specpower/specs/
    - Verify no existing spec requirements are broken
    - Confirm changes align with declared behavior
    - Flag any spec violations as Critical

    **Production Readiness:**
    - Migration strategy (if schema changes)?
    - Backward compatibility considered?
    - Documentation complete?
    - No obvious bugs?

    ## Output Format

    ### Strengths
    [What's well done? Be specific.]

    ### Issues

    #### Critical (Must Fix)
    [Bugs, security issues, data loss risks, broken functionality, spec violations]

    #### Important (Should Fix)
    [Architecture problems, missing features, poor error handling, test gaps]

    #### Minor (Nice to Have)
    [Code style, optimization opportunities, documentation improvements]

    **For each issue:**
    - File:line reference
    - What's wrong
    - Why it matters
    - How to fix (if not obvious)

    ### Recommendations
    [Improvements for code quality, architecture, or process]

    ### Assessment

    **Ready to merge?** [Yes/No/With fixes]

    **Reasoning:** [Technical assessment in 1-2 sentences]

    ## Critical Rules

    **DO:**
    - Categorize by actual severity (not everything is Critical)
    - Be specific (file:line, not vague)
    - Explain WHY issues matter
    - Acknowledge strengths
    - Give clear verdict

    **DON'T:**
    - Say "looks good" without checking
    - Mark nitpicks as Critical
    - Give feedback on code you didn't review
    - Be vague ("improve error handling")
    - Avoid giving a clear verdict
```

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code-reviewer subagent]
  WHAT_WAS_IMPLEMENTED: Verification and repair functions for conversation index
  PLAN_OR_REQUIREMENTS: Task 2 from specpower/changes/<change-name>/tasks.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Continue to Task 3]
```

## Integration with Workflows

**specpower:build Phase B:**
- Review after EACH task
- Catch issues before they compound
- Fix before moving to next task

**specpower:build Phase B (inline mode):**
- Review after each batch (3 tasks)
- Get feedback, apply, continue

**Ad-Hoc Development:**
- Review before merge
- Review when stuck

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification
