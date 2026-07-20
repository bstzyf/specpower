<!-- Demo spec for quicksort — used to validate negative scenario coverage.
     Run: specpower validate examples/quicksort-demo/spec.md
     Run: specpower validate examples/quicksort-demo/spec.md --strict -->

## ADDED Requirements

### Requirement: Quicksort
The system SHALL provide a `quicksort` function that sorts an array of comparable elements into ascending order and returns a new sorted array. The function is a pure function (no mutation of input, no shared state).

#### Scenario: Sorts an unordered array (happy path)
- **WHEN** `quicksort([3, 1, 2])` is called
- **THEN** the result equals `[1, 2, 3]`

#### Scenario: Sorts an already-sorted array (happy path)
- **WHEN** `quicksort([1, 2, 3])` is called
- **THEN** the result equals `[1, 2, 3]`

#### Scenario: Sorts a reverse-sorted array (happy path)
- **WHEN** `quicksort([3, 2, 1])` is called
- **THEN** the result equals `[1, 2, 3]`

#### Scenario: Sorts an array with duplicate elements (happy path)
- **WHEN** `quicksort([3, 1, 2, 1, 3])` is called
- **THEN** the result equals `[1, 1, 2, 3, 3]`

#### Scenario: Empty array returns empty (legitimate boundary — positive)
- **WHEN** `quicksort([])` is called
- **THEN** the result equals `[]`

#### Scenario: Single-element array is returned as-is (legitimate boundary — positive)
- **WHEN** `quicksort([5])` is called
- **THEN** the result equals `[5]`

#### Scenario: Two-element array sorts correctly (legitimate boundary — positive)
- **WHEN** `quicksort([2, 1])` is called
- **THEN** the result equals `[1, 2]`

#### Scenario: Rejects null/None/undefined input (contract violation — negative)
- **WHEN** `quicksort(null)` is called
- **THEN** the system throws a TypeError (or equivalent) indicating invalid input

#### Scenario: Rejects non-array input (contract violation — negative)
- **WHEN** `quicksort("not an array")` is called
- **THEN** the system throws a TypeError (or equivalent) indicating input must be an array

#### Scenario: Rejects array with non-comparable elements (contract violation — negative)
- **WHEN** `quicksort([3, "a", 2])` is called
- **THEN** the system throws a TypeError (or equivalent) indicating elements must be comparable numbers

#### Scenario: Does not mutate the input array (invariant — positive)
- **WHEN** `quicksort(input)` is called with `input = [3, 1, 2]`
- **THEN** the input array remains `[3, 1, 2]` after the call (purity)

#### Scenario: Handles extreme numeric values without overflow (legitimate boundary — positive)
- **WHEN** `quicksort([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0])` is called
- **THEN** the result equals `[-Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]`

#### Scenario: Completes on a large already-sorted array without stack overflow (legitimate large input — positive)
- **WHEN** `quicksort` is called on an already-sorted array of 100000 elements
- **THEN** the function completes without stack overflow (requires non-naive pivot selection, e.g., random or median-of-three)
