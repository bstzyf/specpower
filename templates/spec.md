<!--
  Delta spec template.
  Only include the sections you need. A typical new-capability spec uses only ADDED.
  A modification may use ADDED + MODIFIED. Removals need REMOVED with Reason+Migration.

  CRITICAL format rules:
  - Scenarios MUST use exactly 4 hashtags (####). Three hashtags will fail validation.
  - Scenario steps MUST use bullet dash + bold: `- **WHEN** ...` and `- **THEN** ...`.
  - Every requirement MUST have at least one scenario.
-->

## ADDED Requirements

### Requirement: <!-- requirement name -->
<!-- requirement text using SHALL/MUST -->

#### Scenario: <!-- scenario name -->
- **WHEN** <!-- condition -->
- **THEN** <!-- expected outcome -->

<!-- TIP: Every requirement SHOULD include at least one negative scenario covering a
     contract-violating or abnormal input (error path: invalid type, null where forbidden,
     permission denied; invalid state; resource exhaustion to failure).
     NOTE: legitimate boundary values (empty array, extreme values, large input) are
     POSITIVE scenarios if the function accepts them — do not count them as negative.
     See negative-testing-guide.md for the positive/negative distinction. -->

#### Scenario: <!-- error/boundary scenario name -->
- **WHEN** <!-- invalid/boundary/empty condition -->
- **THEN** <!-- error handling, rejection, or graceful degradation -->

## MODIFIED Requirements

<!-- Include the FULL updated requirement block (not just the diff).
     The requirement name must match the existing spec exactly. -->

### Requirement: <!-- existing requirement name -->
<!-- full updated requirement text -->

#### Scenario: <!-- updated or new scenario name -->
- **WHEN** <!-- condition -->
- **THEN** <!-- new expected outcome -->

## REMOVED Requirements

### Requirement: <!-- requirement name -->
**Reason**: <!-- why being removed -->
**Migration**: <!-- how users should adapt -->

## RENAMED Requirements

FROM: <!-- old requirement name -->
TO: <!-- new requirement name -->
