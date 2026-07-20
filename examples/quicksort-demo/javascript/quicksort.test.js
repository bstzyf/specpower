/**
 * Quicksort implementation (pure function, random pivot, strict input validation).
 * Run: node quicksort.test.js
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export function quicksort(arr) {
  if (arr === null || arr === undefined) {
    throw new TypeError('input must not be null or undefined');
  }
  if (!Array.isArray(arr)) {
    throw new TypeError('input must be an array');
  }
  if (arr.length === 0) {
    return [];
  }
  for (const x of arr) {
    if (typeof x !== 'number' || Number.isNaN(x)) {
      throw new TypeError('all elements must be numbers');
    }
  }
  return _quicksort([...arr]);
}

function _quicksort(arr) {
  if (arr.length <= 1) {
    return arr;
  }
  const pivotIdx = Math.floor(Math.random() * arr.length);
  const pivot = arr[pivotIdx];
  const rest = arr.slice(0, pivotIdx).concat(arr.slice(pivotIdx + 1));
  const less = rest.filter((x) => x < pivot);
  const greater = rest.filter((x) => x >= pivot);
  return _quicksort(less).concat([pivot], _quicksort(greater));
}

function assertThrows(exc, fn) {
  try { fn(); }
  catch (e) {
    if (e instanceof exc) return;
    throw new Error(`expected ${exc.name}, got ${e.constructor.name}`);
  }
  throw new Error(`expected ${exc.name}, nothing thrown`);
}

function run() {
  const cases = [
    { name: 'Sorts unordered array', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([3, 1, 2]), [1, 2, 3]) },
    { name: 'Sorts already-sorted array', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([1, 2, 3]), [1, 2, 3]) },
    { name: 'Sorts reverse-sorted array', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([3, 2, 1]), [1, 2, 3]) },
    { name: 'Sorts array with duplicates', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([3, 1, 2, 1, 3]), [1, 1, 2, 3, 3]) },
    // Positive: boundary (legitimate inputs, verify correct behavior at edges)
    { name: 'Empty array returns empty', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([]), []) },
    // Positive: small-input variants
    { name: 'Single-element array', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([5]), [5]) },
    { name: 'Two-element array', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([2, 1]), [1, 2]) },
    { name: 'Handles extreme numeric values', cat: 'happy', fn: () => assert.deepStrictEqual(quicksort([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0]), [-Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]) },
    // Negative: error path (contract-violating inputs)
    { name: 'Rejects null input', cat: 'negative', fn: () => assertThrows(TypeError, () => quicksort(null)) },
    { name: 'Rejects non-array input', cat: 'negative', fn: () => assertThrows(TypeError, () => quicksort('not an array')) },
    { name: 'Rejects non-comparable elements', cat: 'negative', fn: () => assertThrows(TypeError, () => quicksort([3, 'a', 2])) },
    // Positive: invariant (correctness, not abnormal-handling)
    {
      name: 'Does not mutate input',
      cat: 'happy',
      fn: () => {
        const inp = [3, 1, 2];
        quicksort(inp);
        assert.deepStrictEqual(inp, [3, 1, 2]);
      },
    },
    // Positive: large-input robustness (legitimate input, verify no overflow)
    {
      name: 'No stack-overflow on large sorted array',
      cat: 'happy',
      fn: () => {
        const big = Array.from({ length: 100000 }, (_, i) => i);
        const result = quicksort(big);
        assert.deepStrictEqual(result, big);
      },
    },
  ];

  let passed = 0, failed = 0, negTotal = 0, negPassed = 0;
  for (const c of cases) {
    try {
      c.fn();
      console.log(`PASS: ${c.name} [${c.cat}]`);
      passed++;
      if (c.cat === 'negative') { negTotal++; negPassed++; }
    } catch (e) {
      console.log(`FAIL: ${c.name} [${c.cat}] -- ${e.message}`);
      failed++;
      if (c.cat === 'negative') { negTotal++; }
    }
  }
  const total = cases.length;
  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`Negative cases: ${negTotal}/${total} = ${Math.round((negTotal / total) * 100)}%`);
  console.log(`Negative passed: ${negPassed}/${negTotal}`);
  return failed === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(run() ? 0 : 1);
}
