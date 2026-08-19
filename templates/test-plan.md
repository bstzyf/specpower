# test-plan: <change-name>

<!-- Cases reference spec Scenarios by name (delta or baseline); do not copy WHEN/THEN.
     Every delta Scenario MUST have >=1 Case; every failure-admitting Requirement >=1 [negative].
     Case ids are stable and change-unique; test code embeds the token [<changeName>-<id>]. -->

## Capability: <capability>

### Requirement: <requirement name> → Scenario: <scenario name>

- **Case** T1: <one-line case description> [positive]
  - Input: <concrete input>
  - Expected: <expected outcome>
  - it(): <planned test name>
  - file: <optional: planned test file path>

- **Case** T2: <one-line case description> [negative]
  - Input: <contract-violating input>
  - Expected: <error/rejection/degradation>
  - it(): <planned test name>
