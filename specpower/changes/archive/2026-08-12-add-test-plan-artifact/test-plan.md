# test-plan: add-test-plan-artifact

<!-- Cases reference spec Scenarios by name (delta or baseline); do not copy WHEN/THEN.
     Every delta Scenario MUST have >=1 Case; every failure-admitting Requirement >=1 [negative].
     Case ids are stable and change-unique; test code embeds the token [add-test-plan-artifact-<id>].

     This change dogfoods itself: only code-behavior Scenarios (those backed by a
     unit test) are collected here. Skill-behavior Scenarios (plan Stage 5b generation,
     refine iteration, build Phase B consumption, verify two-step, done archive flow,
     rename confirmation gate) carry no unit test and are intentionally not collected. -->

## Capability: test-planning

### Requirement: test-plan artifact generation → Scenario: delta-scenario change missing test-plan is reported (missing)

- **Case** T1: a testable change (delta scenario present) lacking test-plan.md is warned, not errored [negative]
  - Input: validateSpecFile on a change dir whose delta spec has a Scenario but no test-plan.md
  - Expected: result.valid is true and a warning matching /test-plan/ is emitted
  - it(): warns (not errors) when a testable change lacks test-plan.md
  - file: test/cli/validate.test.ts

### Requirement: test-plan Case format → Scenario: valid Case

- **Case** T2: a well-formed Case with id, scenario ref, mark, input, expected, and it() parses to a TestCase [positive]
  - Input: parseTestPlan on a doc with one Case carrying all fields
  - Expected: one TestCase whose id/scenarioRef/mark/input/expected/itName match the doc
  - it(): parses a well-formed case with all fields
  - file: test/core/parsers/test-plan-parser.test.ts

### Requirement: test-plan Case format → Scenario: Case without stable id is rejected (reject)

- **Case** T3: a Case whose id is not T<n> (e.g. X1) is flagged as malformed instead of silently dropped [negative]
  - Input: findMalformedCases on a doc with a `- **Case** X1:` line
  - Expected: one hit reporting the 1-based line and raw text containing X1
  - it(): flags a Case whose id lacks the T<n> prefix (e.g. X1)
  - file: test/core/parsers/test-plan-parser.test.ts

### Requirement: test-plan Case format → Scenario: embedded token is globally unique with change prefix

- **Case** T4: caseToken builds [<changeName>-<id>] and TOKEN_RE captures change + n from an embedded token [positive]
  - Input: caseToken('add-test-plan-artifact','T3') and TOKEN_RE.exec on an it() name embedding the token
  - Expected: token string '[add-test-plan-artifact-T3]' and captured groups change=add-test-plan-artifact, n=3
  - it(): builds a change-prefixed token from change name + id
  - file: test/core/parsers/test-plan-token.test.ts

### Requirement: test-plan Case format → Scenario: change name globally unique (including archived) guarantees prefix non-collision

- **Case** T5: creating a change whose name already exists (in-flight or archived) is rejected with an "already used" error [negative]
  - Input: createChange('my-feature', root) twice (same name) on a temp project
  - Expected: the second call rejects with /already used/
  - it(): throws error when change name already exists
  - file: test/cli/change-new.test.ts

### Requirement: test-plan Case format → Scenario: Case may reference a baseline scenario as regression

- **Case** T6: a Case referencing a baseline (non-delta) Scenario is not flagged dangling when the baseline spec exists [positive]
  - Input: validateSpecFile on a change whose test-plan has a Case pointing at a Scenario that lives in specpower/specs/
  - Expected: result.valid is true with no dangling-ref error
  - it(): does not flag baseline-regression refs as dangling when baseline specs exist
  - file: test/cli/validate.test.ts

### Requirement: test-plan Case format → Scenario: Case referencing a non-existent scenario is rejected (reject)

- **Case** T7: a Case whose scenarioRef is in neither delta nor baseline is reported as a dangling ref [negative]
  - Input: checkCoverage with a Case whose scenarioRef is 'nope' and no matching baseline scenario
  - Expected: an issue with kind 'dangling-ref' is present
  - it(): flags dangling ref (scenario not in delta or baseline)
  - file: test/core/validation/test-plan-coverage.test.ts

### Requirement: scenario→Case coverage → Scenario: fully-covered change passes validation

- **Case** T8: when every delta Scenario has a Case and a negative Case exists, checkCoverage reports no issues [positive]
  - Input: checkCoverage with one delta scenario and one [negative] Case referencing it
  - Expected: result.issues is empty
  - it(): passes when every delta scenario has a case and negatives present
  - file: test/core/validation/test-plan-coverage.test.ts

### Requirement: scenario→Case coverage → Scenario: uncovered scenario fails validation (fail)

- **Case** T9: a delta Scenario with no Case is reported as uncovered-scenario [negative]
  - Input: checkCoverage with one delta scenario and zero cases
  - Expected: an issue with kind 'uncovered-scenario' is present
  - it(): flags uncovered scenario
  - file: test/core/validation/test-plan-coverage.test.ts

### Requirement: scenario→Case coverage → Scenario: failure-admitting Requirement missing negative case fails validation (missing)

- **Case** T10: a failure-admitting Requirement whose only Case is [positive] is reported as missing-negative [negative]
  - Input: checkCoverage with a delta scenario, one [positive] Case, and failureAdmittingRequirements=['r']
  - Expected: an issue with kind 'missing-negative' is present
  - it(): flags missing-negative for failure-admitting requirement
  - file: test/core/validation/test-plan-coverage.test.ts

### Requirement: test-plan lifecycle → Scenario: done archives but does not merge

- **Case** T11: archiving a change moves test-plan.md into the archive and never merges its content into the baseline spec [positive]
  - Input: archiveChange on a change whose test-plan.md carries a TP_UNMERGED_MARKER line
  - Expected: archived test-plan.md retains the marker; baseline spec contains the merged delta requirement but not the marker, not 'test-plan', not the token
  - it(): moves test-plan.md into archive and does NOT merge it into baseline
  - file: test/core/archive.test.ts

### Requirement: test-plan lifecycle → Scenario: rename-scenario atomically renames a baseline scenario and syncs references

- **Case** T12: renameScenario rewrites the baseline Scenario heading and syncTestPlanRefs rewrites the `→ Scenario:` ref in active + archived test-plans [positive]
  - Input: renameScenario(root,'cap','old name','new name') then syncTestPlanRefs on a fixture with one active and one archived test-plan
  - Expected: synced count is 2; both test-plans contain '→ Scenario: new name' and no 'old name'
  - it(): syncs test-plan references across active + archived changes
  - file: test/cli/rename-scenario.test.ts

### Requirement: test-plan lifecycle → Scenario: archived test-plan's baseline reference does not silently dangle

- **Case** T13: rename-scenario surfaces an archived test-plan that references the old name (so its reference does not silently dangle) [positive]
  - Input: listAffectedTestPlans(root,'old name') on a fixture with one active and one archived test-plan referencing 'old name'
  - Expected: affected list has length 2 and contains the archived test-plan path; no file is written
  - it(): --dry-run lists affected files without writing
  - file: test/cli/rename-scenario.test.ts

### Requirement: test-plan lifecycle → Scenario: archiving a testable change without test-plan is blocked

- **Case** T14: archiving a change that has a delta Scenario but no test-plan.md is blocked with a "test-plan.md missing" error [negative]
  - Input: archiveChange on a testable change after deleting its test-plan.md
  - Expected: result.success is false; an error matches /test-plan\.md missing/i; the change dir is not moved
  - it(): blocks archive of a testable change (has scenario) lacking test-plan.md
  - file: test/core/archive.test.ts

### Requirement: validation integration → Scenario: compliant test-plan passes validation

- **Case** T15: validateSpecFile on a change whose test-plan.md covers every delta Scenario returns valid with no errors [positive]
  - Input: validateSpecFile on the with-plan fixture spec
  - Expected: result.valid is true and result.errors is empty
  - it(): passes (valid) when a change has a covering test-plan.md
  - file: test/cli/validate.test.ts

### Requirement: validation integration → Scenario: coverage gap fails validation (fail)

- **Case** T16: a malformed-id Case line in test-plan.md surfaces as a validation error instead of being silently dropped [negative]
  - Input: validateSpecFile on a change whose test-plan.md has a `- **Case** X1:` line
  - Expected: result.valid is false and an error matches /malformed.*id/i
  - it(): reports malformed-id Case lines in test-plan.md instead of silently dropping them
  - file: test/cli/validate.test.ts

### Requirement: validation integration → Scenario: strict mode upgrades missing-file warning

- **Case** T17: under --strict, the missing test-plan.md warning is promoted to an error [negative]
  - Input: validateSpecFile(withoutPlanSpec, { strict: true })
  - Expected: result.valid is false and an error matching /test-plan/ is present
  - it(): promotes the missing test-plan warning to an error under --strict
  - file: test/cli/validate.test.ts
