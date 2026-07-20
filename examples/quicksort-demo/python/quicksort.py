"""Quicksort implementation (pure function, random pivot, strict input validation)."""
import random
import sys


def quicksort(arr):
    """Sort an array of numbers ascending. Returns a new array. Does not mutate input.

    Raises TypeError on null/non-array/non-numeric-element input.
    """
    if arr is None:
        raise TypeError("input must not be None")
    if not isinstance(arr, list):
        raise TypeError("input must be an array")
    if len(arr) <= 1:
        return list(arr)

    # Validate all elements are numbers (int/float), reject bool-as-number? Python bool is int subclass.
    for x in arr:
        if not isinstance(x, (int, float)) or isinstance(x, bool):
            raise TypeError("all elements must be numbers")

    return _quicksort(list(arr))


def _quicksort(arr):
    if len(arr) <= 1:
        return arr
    # Random pivot to avoid O(n) recursion depth on already-sorted input.
    pivot_idx = random.randint(0, len(arr) - 1)
    pivot = arr[pivot_idx]
    rest = arr[:pivot_idx] + arr[pivot_idx + 1:]
    less = [x for x in rest if x < pivot]
    greater = [x for x in rest if x >= pivot]
    return _quicksort(less) + [pivot] + _quicksort(greater)


def _run_tests():
    cases = []

    def case(name, category, fn):
        cases.append((name, category, fn))

    # --- Happy path ---
    case("Sorts unordered array", "happy", lambda: _eq(quicksort([3, 1, 2]), [1, 2, 3]))
    case("Sorts already-sorted array", "happy", lambda: _eq(quicksort([1, 2, 3]), [1, 2, 3]))
    case("Sorts reverse-sorted array", "happy", lambda: _eq(quicksort([3, 2, 1]), [1, 2, 3]))
    case("Sorts array with duplicates", "happy", lambda: _eq(quicksort([3, 1, 2, 1, 3]), [1, 1, 2, 3, 3]))

    # --- Positive: boundary (legitimate inputs, verify correct behavior at edges) ---
    case("Empty array returns empty", "happy", lambda: _eq(quicksort([]), []))

    # --- Positive: small-input variants ---
    case("Single-element array", "happy", lambda: _eq(quicksort([5]), [5]))
    case("Two-element array", "happy", lambda: _eq(quicksort([2, 1]), [1, 2]))
    case("Handles extreme numeric values", "happy",
         lambda: _eq(quicksort([sys.maxsize, -sys.maxsize, 0]), [-sys.maxsize, 0, sys.maxsize]))

    # --- Negative: error path (contract-violating inputs) ---
    case("Rejects null input", "negative", lambda: _throws(TypeError, lambda: quicksort(None)))
    case("Rejects non-array input", "negative", lambda: _throws(TypeError, lambda: quicksort("not an array")))
    case("Rejects non-comparable elements", "negative", lambda: _throws(TypeError, lambda: quicksort([3, "a", 2])))

    # --- Positive: invariant (correctness, not abnormal-handling) ---
    def _no_mutate():
        inp = [3, 1, 2]
        quicksort(inp)
        _eq(inp, [3, 1, 2])
    case("Does not mutate input", "happy", _no_mutate)

    # --- Positive: large-input robustness (legitimate input, verify no overflow) ---
    def _no_overflow():
        big = list(range(100000))  # already sorted — naive quicksort would overflow
        result = quicksort(big)
        _eq(result, big)
    case("No stack-overflow on large sorted array", "happy", _no_overflow)

    # Run
    passed = 0
    failed = 0
    negative_total = 0
    negative_passed = 0
    for name, cat, fn in cases:
        try:
            fn()
            print(f"PASS: {name} [{cat}]")
            passed += 1
            if cat == "negative":
                negative_total += 1
                negative_passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"FAIL: {name} [{cat}] -- {type(e).__name__}: {e}")
            failed += 1
            if cat == "negative":
                negative_total += 1

    total = len(cases)
    print("\n=== SUMMARY ===")
    print(f"Total: {total}, Passed: {passed}, Failed: {failed}")
    print(f"Negative cases: {negative_total}/{total} = {round(negative_total / total * 100)}%")
    print(f"Negative passed: {negative_passed}/{negative_total}")
    return failed == 0


def _eq(actual, expected):
    assert actual == expected, f"expected {expected}, got {actual}"


def _throws(exc, fn):
    try:
        fn()
    except exc:
        return
    except Exception as e:  # noqa: BLE001
        raise AssertionError(f"expected {exc.__name__}, got {type(e).__name__}")
    raise AssertionError(f"expected {exc.__name__}, nothing thrown")


if __name__ == "__main__":
    import sys as _s
    _s.exit(0 if _run_tests() else 1)
