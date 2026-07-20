# specpower-test Specification

## Purpose
TBD - created by archiving change create-specpower-plugin. Update Purpose after archive.
## Requirements
### Requirement: Multi-level test execution
The system SHALL execute tests at four levels: unit, integration, E2E, and regression.

#### Scenario: Full test suite
- **WHEN** user runs `/specpower:test`
- **THEN** system executes unit tests, integration tests, E2E tests, and regression tests in sequence, reporting results per level

#### Scenario: Targeted testing with scan baseline
- **WHEN** a scan baseline exists
- **THEN** system SHALL identify affected modules from the change's delta specs and target test execution to those modules first

### Requirement: Test failure handling
The system SHALL activate systematic debugging workflow on test failures.

#### Scenario: Failure triggers debugging
- **WHEN** any test level fails
- **THEN** system reports the failure details and activates the systematic-debugging workflow to investigate root cause

### Requirement: Verification before completion
The system SHALL provide fresh verification evidence before claiming test success — no "should work" or "probably passes" allowed.

#### Scenario: Evidence-based claims
- **WHEN** tests complete
- **THEN** system SHALL show actual command output with exit codes, not summarized or assumed results

### Requirement: Negative test coverage reporting
The system SHALL report the ratio of negative test cases to total test cases and flag modules where negative coverage is below the target threshold, ensuring contract-violating/abnormal scenarios are adequately tested.

#### Scenario: Negative coverage ratio reporting
- **WHEN** test execution completes
- **THEN** system SHALL report the ratio of negative test cases (contract-violating error path, invalid state, resource exhaustion to failure) to total test cases per module, and flag any side-effect-bearing module where the ratio is below 30%

#### Scenario: Pure-function modules use a lower threshold
- **WHEN** a module contains only pure functions with strict input contracts
- **THEN** system SHALL apply a 15% negative threshold (instead of 30%) because legitimate boundary tests (empty/extreme/large valid inputs) are positive, not negative, leaving few true negatives

#### Scenario: Module flagged for low negative coverage
- **WHEN** a module's negative test ratio is below its applicable threshold (30% for side-effect functions, 15% for pure functions)
- **THEN** system SHALL flag the module in the report with a warning and recommend specific contract-violating scenarios to add (null where forbidden, wrong type, invalid state, resource exhaustion)

#### Scenario: Padded ratio flagged
- **WHEN** a module's reported negative ratio appears inflated by legitimate-boundary tests (empty/extreme/large valid inputs misclassified as negative)
- **THEN** system SHALL flag the module for re-audit, noting that legitimate boundary tests should be counted as positive

#### Scenario: Adequate negative coverage
- **WHEN** all modules meet their applicable negative threshold with correctly-classified negatives
- **THEN** system SHALL report negative coverage as adequate and include the per-module ratios in the verification report

