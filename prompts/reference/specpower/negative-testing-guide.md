# Negative Testing Guide

**Load this reference when:** writing or changing tests, designing test suites, reviewing test coverage, or anytime you need to ensure abnormal/error scenarios are adequately covered.

## Overview

Most test suites over-cover happy paths and under-cover abnormal scenarios — error paths (contract violations), invalid state, and resource exhaustion. This guide provides a systematic classification of test types, target ratios, and practical patterns for ensuring robust negative test coverage.

**Core principle:** A test suite that only passes when everything goes right proves nothing about what happens when things go wrong.

**Companion references:**
- `testing-anti-patterns.md` — what NOT to do in tests
- `defense-in-depth.md` — multi-layer validation (maps to test types below)
- `examples/quicksort-demo/` (in the specpower repository) — a full worked example across Python/TypeScript/JavaScript/Java/C++ showing this guide's classification applied to a pure function with a naturally-low negative ratio.

---

## The Seven Test Types

Every function/method/API endpoint should be evaluated against all seven types. Not every type applies to every unit — but you must explicitly consider each one and justify skipping any that don't apply.

### Type 1: Happy Path (Positive)

**What:** Valid inputs, normal flow, expected output.

**When it applies:** Always. This is the baseline.

**Examples:**
```typescript
// Function
test('add returns sum of two numbers', () => {
  expect(add(2, 3)).toBe(5);
});

// API
test('POST /users creates user with valid data', async () => {
  const res = await request.post('/users').send({ name: 'Alice', email: 'alice@example.com' });
  expect(res.status).toBe(201);
});

// CLI
test('specpower change new my-feature creates directory', () => {
  // ...valid name, valid cwd
});
```

### Type 2: Error Path (Negative)

**What:** Invalid inputs, missing arguments, permission denied, malformed data.

**When it applies:** Every function that accepts input, every API endpoint, every CLI command.

**Key patterns to test:**
- Wrong type (string where number expected)
- Out-of-range value (negative age, future date for birth)
- Malformed input (invalid JSON, broken syntax)
- Missing required arguments
- Permission / authorization failure

**Examples:**
```typescript
test('add throws TypeError for non-number inputs', () => {
  expect(() => add('two', 3)).toThrow(TypeError);
});

test('POST /users rejects duplicate email', async () => {
  await createUser({ email: 'taken@example.com' });
  const res = await request.post('/users').send({ name: 'Bob', email: 'taken@example.com' });
  expect(res.status).toBe(409);
});

test('specpower change new rejects names with spaces', () => {
  expect(() => createChange('has spaces')).toThrow(/invalid/);
});
```

### Type 3: Boundary (context-dependent — can be positive OR negative)

**What:** Edge values, limits, thresholds, off-by-one conditions.

**Crucial distinction — is the boundary value a *legitimate* input?**
- **Legitimate boundary value** (the function accepts it as valid input — e.g., empty array, single-element array, MAX_SAFE_INTEGER as a number, a large sorted array): testing that the function *works correctly* at this edge is a **POSITIVE test**. You are verifying correct behavior at a boundary, not abnormal-handling.
- **Boundary that triggers abnormal handling** (e.g., index past array length causing a throw, a value just over a rate limit causing rejection, an off-by-one that produces wrong output): this is a **NEGATIVE test**, because the assertion is about how the system handles the boundary-triggered abnormality.

**Rule of thumb:** If the input is within the function's accepted domain (even at its edge) and you assert correct output → **positive**. If the input is at a boundary that the function *rejects or must specially handle as abnormal* → **negative**.

**When it applies:** Every function with numeric inputs, collections with size limits, time-based logic, rate limits.

**Key patterns to test:**
- Minimum value / zero
- Maximum value / MAX_SAFE_INTEGER
- Just above / just below threshold
- Off-by-one (index at length, index at -1)
- First and last element of collections

**Examples:**
```typescript
// POSITIVE — empty array is a legitimate input, verify correct behavior at the edge
test('quicksort returns empty array for empty input', () => {
  expect(quicksort([])).toEqual([]);
});

// POSITIVE — MAX_SAFE_INTEGER is a legitimate number, verify correct sort
test('quicksort sorts array with extreme values', () => {
  expect(quicksort([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0]))
    .toEqual([-Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]);
});

// NEGATIVE — page beyond range is a boundary the function rejects/specially handles
test('paginate returns empty for page beyond results', () => {
  expect(paginate([1, 2, 3], { page: 999, size: 10 })).toEqual([]);
});

// NEGATIVE — off-by-one index triggers rejection
test('access throws at index === length', () => {
  expect(() => getItem([1, 2, 3], 3)).toThrow(/out of range/);
});
```

### Type 4: Empty / Null / Zero (context-dependent — can be positive OR negative)

**What:** Empty collections, null, undefined, empty string, zero, NaN.

**Crucial distinction — same as Type 3, is the value a *legitimate* input?**
- **Empty collection / empty string as legitimate input** (the function defines empty as valid — e.g., `quicksort([]) → []`, `searchNotes([], q) → []`): testing correct behavior on empty input is a **POSITIVE test**. The function accepts empty and returns a correct result — that is normal behavior at a boundary, not abnormal-handling.
- **null / undefined / NaN as contract-violating input** (the function's contract says "must not be null" or "must be a number"): testing that the function *rejects or specially handles* these is a **NEGATIVE test**. The input violates the contract; the assertion is about abnormal-handling (throw, default, or guard).

**When it applies:** Every function that processes collections, strings, or optional values.

**Key patterns to test:**
- `null` / `undefined` argument (negative — if contract forbids it)
- Empty array / empty object / empty string (positive — if empty is legitimate input)
- Zero value (positive if zero is a valid number; negative if zero means "disabled" and triggers special handling)
- `NaN` for numeric inputs (negative — NaN violates the number contract)
- All optional fields omitted (positive if function handles absence correctly)

**Examples:**
```typescript
// POSITIVE — empty list is legitimate input, verify correct behavior
test('searchNotes returns empty array for empty notes list', () => {
  expect(searchNotes([], 'query')).toEqual([]);
});

// NEGATIVE — null violates the input contract, verify rejection
test('formatName rejects null input', () => {
  expect(() => formatName(null)).toThrow(/must not be null/);
});

// NEGATIVE — nonexistent path violates precondition, verify handling
test('listChanges returns [] when changes directory does not exist', () => {
  expect(listChanges('/nonexistent')).toEqual([]);
});
```

> **Note on the last example:** `listChanges('/nonexistent')` is negative because the *precondition* (directory exists) is violated, even though the function degrades gracefully to `[]` rather than throwing. The input is abnormal; the assertion is about handling of the abnormality.

### Type 5: Invalid State (Negative)

**What:** Operation called in wrong state — before initialization, after closure, in wrong phase.

**When it applies:** Stateful objects, resources with lifecycle, multi-step workflows.

**Key patterns to test:**
- Call method before `init()` / `connect()` / `start()`
- Call method after `close()` / `destroy()` / `end()`
- Call operation in wrong workflow phase
- Double-init / double-close

**Examples:**
```typescript
test('read throws before connection is opened', () => {
  const conn = new Connection();
  expect(() => conn.read()).toThrow(/not connected/);
});

test('archive refuses change in phase=plan without --force', () => {
  const change = createChangeInPhase('plan');
  expect(() => archive(change)).toThrow(/refuse/);
});

test('close is idempotent — second call does not throw', () => {
  const conn = new Connection();
  conn.open();
  conn.close();
  expect(() => conn.close()).not.toThrow();
});
```

### Type 6: Concurrency / Race Condition (Negative)

**What:** Concurrent access, race conditions, interleaved operations.

**When it applies:** Shared mutable state, file system operations, database writes, network calls.

**Key patterns to test:**
- Two concurrent writes to same resource
- Read during write
- Operation interrupted mid-flight
- Callback/event ordering assumptions

**Examples:**
```typescript
test('concurrent writes do not corrupt file', async () => {
  const promises = [writeFile(path, 'a'), writeFile(path, 'b')];
  await Promise.all(promises);
  const content = await readFile(path);
  expect(content === 'a' || content === 'b').toBe(true); // not corrupted
});
```

### Type 7: Resource Exhaustion / Timeout (context-dependent — can be positive OR negative)

**What:** Resource limits — disk full, memory pressure, connection timeout, rate limit exceeded.

**Crucial distinction — is the large/limited input *legitimate*?**
- **Legitimate large input, verify no overflow/correct completion** (e.g., quicksort on a large already-sorted array, verifying no stack-overflow): this is a **POSITIVE test** — the input is within the accepted domain, and you assert the function works correctly at scale. It is a robustness check, not abnormal-handling.
- **Resource actually exhausted, triggering failure handling** (e.g., disk-full causing write to throw, timeout causing request to fail, rate limit causing rejection): this is a **NEGATIVE test** — the resource condition is abnormal, and the assertion is about how the system handles the failure.

**When it applies:** I/O operations, network calls, resource allocation, anything with limits.

**Key patterns to test:**
- Timeout on slow operations (negative — failure handling)
- Disk-full write failure (negative — failure handling)
- Rate limit exceeded (negative — rejection)
- Large legitimate input, verify correct completion / no overflow (positive — robustness at scale)

**Examples:**
```typescript
// POSITIVE — large legitimate input, verify no stack overflow
test('quicksort completes on large already-sorted array without stack overflow', () => {
  const big = Array.from({ length: 100000 }, (_, i) => i);
  expect(quicksort(big)).toEqual(big);
});

// NEGATIVE — timeout is an abnormal condition, verify failure handling
test('fetchWithTimeout throws on timeout', async () => {
  const slowServer = createSlowServer({ delay: 5000 });
  await expect(fetchWithTimeout(slowServer.url, { timeout: 100 })).rejects.toThrow(/timeout/);
});

// NEGATIVE — disk full is an abnormal condition, verify failure handling
test('writeFile reports error when disk is full', async () => {
  mockDiskFull();
  await expect(writeFile('/full/path', 'data')).rejects.toThrow(/ENOSPC/);
});
```

---

## Target Ratios

### The 30-50% Rule (applies to functions with side effects / state / I/O)

Based on industry experience and empirical analysis of high-quality test suites:

| Test Level | Negative Target | Rationale |
|------------|----------------|-----------|
| **Unit** | ≥ 30% negative | Functions are the cheapest place to catch errors |
| **Integration** | ≥ 30% negative | API contracts and data flow need error-path verification |
| **E2E** | ≥ 20% negative | E2E is expensive; focus negative tests on critical failure flows |
| **Regression** | 100% negative | Every regression test IS a negative test (it reproduces a bug) |

### When the ratio is naturally lower (and that's OK)

**Pure functions with strict input contracts** (e.g., `quicksort`, `add`, `formatDate`) often have few true negatives — only the contract-violating inputs (null, wrong type, non-numeric element) count. Legitimate boundary values (empty array, extreme values, large inputs) are **positive** tests under this guide's rules. For such functions:

- A negative ratio of **15-30% is normal and healthy**, not a coverage gap.
- The 30% floor applies to functions with **side effects, state, I/O, permissions, or concurrency** — where abnormal scenarios are genuinely numerous.
- Do NOT pad the ratio by reclassifying legitimate-boundary tests as negative. A honest 20% is better than a padded 50%.

**The ratio is a sanity check, not a gate.** The real question is: *for every contract violation and abnormal precondition the function can encounter, is there a test?* If yes, the ratio is whatever it is.

**What counts as "negative":** Only tests where the **input or precondition is abnormal** (contract-violating, out-of-domain, resource-exhausted-to-failure) and the **assertion is about how the system handles the abnormality** (rejects, throws, degrades, bounds, recovers). See the per-Type distinctions above — Types 3, 4, and 7 are **context-dependent**: legitimate boundary/empty/large inputs are positive; only abnormal-triggering ones are negative. Types 2, 5, 6 are negative by definition.

**What does NOT count as "negative" (do not inflate the ratio with these):**
- **Invariants / correctness checks** — tests that verify the function *does what it should* under normal operation (e.g., "does not mutate input", "returns a new array", "preserves element count"). These are positive-behavior assertions, not abnormal-scenario handling. Count them on the positive side.
- **Happy-path variations** — different *valid* inputs that all exercise the success path (e.g., sorting negative numbers, sorting floats). These are positive tests even if they feel "additional".
- **Regression tests for correct-behavior bugs** — only count as negative if the bug was an *error-handling* failure; if the bug was wrong output on valid input, the regression test is positive.

The dividing line: **a negative test is one where the *input or precondition is abnormal* and the assertion is about *how the system handles the abnormality* (rejects, throws, degrades, bounds, recovers).** If the input is valid and you're asserting the output is correct, it's positive — even if the test is valuable.

**Minimum bar per function/method:**
- ≥ 1 positive test
- ≥ 1 negative test from a relevant category

**Quality over quantity — and de-duplicate dimensions:** A single well-chosen boundary test that catches a real bug is worth more than 5 trivial `expect(() => fn(null)).toThrow()` tests. Each negative test should cover a **different failure dimension**. Specifically:

- **Do NOT stack multiple tests on the same failure dimension.** "Empty array", "single-element array", and "two-element array" all probe the *input-size lower bound* — one representative test covers that dimension; the others are padding. If you genuinely need to test size-1 vs size-2 because the algorithm branches on length, that's a real dimension split — otherwise collapse them.
- **One error-path test per distinct contract violation.** "Rejects null", "rejects non-array", and "rejects non-numeric elements" are three *different* input contracts → three distinct dimensions → three tests is legitimate. "Rejects null" and "rejects undefined" are the *same* contract → one test (parameterized is fine) is enough.
- **Boundary tests should target different edges.** Lower bound, upper bound, and just-past-threshold are three different dimensions. `arr[0]`, `arr[-1]`, and `arr[len]` (off-by-one) are different. `arr[0]` and `arr[1]` are usually the same dimension.
- **Audit before counting.** Before reporting a negative ratio, group your negative tests by failure dimension. If two tests share a dimension, drop or merge one. The ratio is meaningful only after de-duplication.

A healthy negative ratio is **30-50% after de-duplication**. Ratios above 60% usually mean either (a) the function is input-validation-heavy (legitimate — pure functions with many input contracts), or (b) you're counting invariants as negative / stacking same-dimension boundary tests (not legitimate — re-audit).

---

## Defense-in-Depth Mapping

The four validation layers from `defense-in-depth.md` map directly to test types:

| Validation Layer | Test Types to Cover |
|-----------------|-------------------|
| **Layer 1: Entry Point Validation** | Type 2 (Error Path) — invalid/rejected inputs (negative) |
| **Layer 2: Business Logic Validation** | Type 3 (Boundary) + Type 4 (Empty/Null) — edge cases and missing data (context-dependent: legitimate values are positive; contract-violating ones are negative) |
| **Layer 3: Environment Guards** | Type 5 (Invalid State) + Type 7 (Resource) — wrong context, exhausted resources (negative) |
| **Layer 4: Debug Instrumentation** | Type 2 (Error Path) — verify error messages contain diagnostic context (negative) |

**Testing across layers:** When you find a bug fixed at one layer, add tests at ALL layers the data passes through. This is the testing analog of defense-in-depth: each layer's test catches bugs the other layers miss.

---

## Quick Decision Guide

```
WRITING TESTS FOR A NEW FUNCTION:

1. Does it accept input? → Type 2 (Error Path) tests (negative — contract violations)
2. Does it have numeric/string inputs? → Type 3 (Boundary) tests (positive if legitimate edge values; negative if boundary triggers abnormal handling)
3. Does it process collections? → Type 4 (Empty/Null) tests (positive if empty is legitimate input; negative if null/missing violates contract)
4. Does it depend on state/lifecycle? → Type 5 (Invalid State) tests (negative)
5. Does it access shared resources? → Type 6 (Concurrency) tests (negative)
6. Does it do I/O or have limits? → Type 7 (Resource/Timeout) tests (positive if verifying no-overflow on legitimate large input; negative if resource exhaustion to failure)

After writing: count negative tests / total tests.
For side-effect functions: if < 30%, add more negative tests.
For pure functions: 15-30% is healthy — do NOT pad by reclassifying legitimate-boundary tests as negative.
```

```
REVIEWING A TEST SUITE:

1. Count: how many tests are positive vs negative?
2. Categorize: which of the 7 types are present? Which are missing?
3. Check: does each function have ≥ 1 negative test?
4. Flag: if negative ratio < 30%, the suite has a coverage gap
```

---

## Per-Language Patterns

### TypeScript / JavaScript

```typescript
// Error path
expect(() => fn(badInput)).toThrow(/specific error message/);

// Async error path
await expect(fn(badInput)).rejects.toThrow(/specific error/);

// Boundary
expect(fn(0)).toBe(expectedForZero);
expect(fn(Number.MAX_SAFE_INTEGER)).toBeDefined();

// Empty/null
expect(fn(null)).toBe(fallback);
expect(fn([])).toEqual([]);
expect(fn('')).toBe(defaultValue);
```

### Python

```python
# Error path
with pytest.raises(ValueError, match="specific error"):
    fn(bad_input)

# Boundary
assert fn(0) == expected_for_zero
assert fn(sys.maxsize) is not None

# Empty/null
assert fn(None) == fallback
assert fn([]) == []
assert fn("") == default
```

---

## Common Anti-Patterns in Negative Testing

| Anti-Pattern | Why It's Wrong | Fix |
|-------------|---------------|-----|
| Only testing `throw` but not the error message | Confirms error thrown, not that it's the RIGHT error | Assert on error message/content |
| Same negative test with different literal values | 5 tests for `null`, `undefined`, `0`, `''`, `false` on a string param — only 1 failure dimension | Test different failure dimensions (type error vs missing vs invalid value) |
| **Stacking same-dimension boundary tests** | "empty array", "single-element", "two-element" all probe input-size lower bound — padding the count | One representative per dimension; merge or parameterize the rest |
| Negative tests that are actually positive tests | `test('returns 0 for empty input')` — this is positive behavior, not negative | Negative = unexpected/invalid input causing error handling to activate |
| **Counting invariants as negative** | "does not mutate input" / "returns new array" verify correctness under normal operation, not abnormal handling | Count invariants on the positive side; negative requires abnormal input/precondition |
| Testing implementation details of error handling | `expect(error.code).toBe('E001')` when code is internal | Test observable behavior: correct error type, message, and side effects |
| 100% negative ratio | Over-indexing on negative tests means happy path is under-tested | Aim for 30-50%, not 100% |
| **Reporting raw ratio without de-duplication** | 9 "negative" tests that collapse to 5 dimensions still get reported as 9, inflating the ratio | Group by failure dimension first; report the de-duplicated count |

---

## Red Flags

- Test suite has 0 negative tests → **Critical gap**
- Every test name starts with "returns" or "creates" (no "rejects", "throws", "fails") → Likely missing negative tests
- Test names use "should" instead of specific behavior → Weak test design
- No test for what happens when dependencies fail → Missing error path coverage
- Only `try/catch` in tests but no assertion on caught error → Not actually testing error handling
- **Negative ratio > 60%** → Re-audit: either the function is genuinely input-validation-heavy (OK), or invariants/same-dimension boundary tests are being counted as negative (not OK)
- **Multiple negative tests whose names differ only in a literal** ("rejects null", "rejects undefined", "rejects empty string" on a param where these are the same contract) → Same dimension, de-duplicate

---

## The Bottom Line

**Negative testing is not optional — it's where robustness lives.**

A system that works when everything goes right but crashes when anything goes wrong is not production-ready. The 30% minimum is a floor, not a ceiling. For critical paths (authentication, data integrity, financial operations), aim for 50%+ negative coverage.

When in doubt: add the negative test. The bug you prevent is the one you don't have to debug at 3 AM.
