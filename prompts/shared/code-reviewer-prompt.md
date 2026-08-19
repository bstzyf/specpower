<!-- SOURCE: skills/subagent-driven-development/code-quality-reviewer-prompt.md -->

# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Only dispatch after spec compliance review passes.**

```
Task tool (general-purpose):
  description: "Review code quality for Task N"
  prompt: |
    You are reviewing code changes for production readiness.

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
    - Does each file have one clear responsibility with a well-defined interface?
    - Are units decomposed so they can be understood and tested independently?
    - Is the implementation following the file structure from the plan?
    - Did this implementation create new files that are already large, or significantly
      grow existing files? (Don't flag pre-existing file sizes -- focus on what this
      change contributed.)
    - Sound design decisions?
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

    **Custom Standards (sync-baked):**
    The placeholder below is replaced at `specpower init`/`sync` time with the
    concatenated contents of `specpower/custom/review/` top-level .md
    (lexicographic; subdirectories and non-.md ignored). If missing or empty,
    it reads `none`. Do NOT read custom files at runtime — they are inlined here.
    [CONTROLLER: paste review rules here]
    Custom conventions override built-in style guidance; built-in
    safety/correctness checks always apply. Flag violations at the severity
    each rule specifies (default Important).

    **D9 self-check:** If you see the literal `[CONTROLLER:` text still in this
    prompt (sync bake missing/failed), report DONE_WITH_CONCERNS — do not treat
    it as a rule, and do not silently proceed as if rules were absent.

    ## Output Format

    ### Strengths
    [What's well done? Be specific.]

    ### Issues

    #### Critical (Must Fix)
    [Bugs, security issues, data loss risks, broken functionality]

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
```

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment
