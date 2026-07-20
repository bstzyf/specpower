// Quicksort implementation (pure function, random pivot, strict input validation).
// Run: javac Quicksort.java && java Quicksort
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

public class Quicksort {

    public static List<Integer> quicksort(List<Integer> arr) {
        if (arr == null) {
            throw new TypeError("input must not be null");
        }
        // In Java, non-list types are rejected at compile time; a List of wrong
        // element type would fail before reaching here. We still validate contents.
        List<Integer> copy = new ArrayList<>(arr); // do not mutate input
        for (Integer x : copy) {
            if (x == null) {
                throw new TypeError("elements must not be null");
            }
        }
        return _quicksort(copy);
    }

    private static final Random RNG = new Random();

    private static List<Integer> _quicksort(List<Integer> arr) {
        if (arr.size() <= 1) {
            return arr;
        }
        int pivotIdx = RNG.nextInt(arr.size());
        Integer pivot = arr.get(pivotIdx);
        List<Integer> less = new ArrayList<>();
        List<Integer> greater = new ArrayList<>();
        for (int i = 0; i < arr.size(); i++) {
            if (i == pivotIdx) continue;
            Integer x = arr.get(i);
            if (x < pivot) less.add(x);
            else greater.add(x);
        }
        List<Integer> result = _quicksort(less);
        result.add(pivot);
        result.addAll(_quicksort(greater));
        return result;
    }

    // ---- Test harness ----

    static class TypeError extends RuntimeException {
        TypeError(String msg) { super(msg); }
    }

    static int passed = 0, failed = 0, negTotal = 0, negPassed = 0;

    static void eq(String name, String cat, List<Integer> actual, List<Integer> expected) {
        try {
            if (!actual.equals(expected)) {
                throw new RuntimeException("expected " + expected + ", got " + actual);
            }
            pass(name, cat);
        } catch (Throwable t) {
            fail(name, cat, t);
        }
    }

    static void throwsExc(String name, String cat, Class<? extends Throwable> exc, Runnable fn) {
        try {
            fn.run();
            fail(name, cat, new RuntimeException("expected " + exc.getSimpleName() + ", nothing thrown"));
        } catch (Throwable t) {
            if (exc.isInstance(t)) {
                pass(name, cat);
            } else {
                fail(name, cat, new RuntimeException("expected " + exc.getSimpleName() + ", got " + t.getClass().getSimpleName()));
            }
        }
    }

    static void pass(String name, String cat) {
        System.out.println("PASS: " + name + " [" + cat + "]");
        passed++;
        if (cat.equals("negative")) { negTotal++; negPassed++; }
    }

    static void fail(String name, String cat, Throwable t) {
        System.out.println("FAIL: " + name + " [" + cat + "] -- " + t.getClass().getSimpleName() + ": " + t.getMessage());
        failed++;
        if (cat.equals("negative")) { negTotal++; }
    }

    static void runCase(String name, String cat, Runnable fn) {
        try {
            fn.run();
            pass(name, cat);
        } catch (Throwable t) {
            fail(name, cat, t);
        }
    }

    public static void main(String[] args) {
        List<Integer> big = new ArrayList<>();
        for (int i = 0; i < 100000; i++) big.add(i);

        // Happy
        eq("Sorts unordered array", "happy", quicksort(Arrays.asList(3, 1, 2)), Arrays.asList(1, 2, 3));
        eq("Sorts already-sorted array", "happy", quicksort(Arrays.asList(1, 2, 3)), Arrays.asList(1, 2, 3));
        eq("Sorts reverse-sorted array", "happy", quicksort(Arrays.asList(3, 2, 1)), Arrays.asList(1, 2, 3));
        eq("Sorts array with duplicates", "happy", quicksort(Arrays.asList(3, 1, 2, 1, 3)), Arrays.asList(1, 1, 2, 3, 3));
        // Positive: boundary (legitimate inputs, verify correct behavior at edges)
        eq("Empty array returns empty", "happy", quicksort(Arrays.asList()), Arrays.asList());
        // Positive: small-input variants
        eq("Single-element array", "happy", quicksort(Arrays.asList(5)), Arrays.asList(5));
        eq("Two-element array", "happy", quicksort(Arrays.asList(2, 1)), Arrays.asList(1, 2));
        eq("Handles extreme numeric values", "happy",
           quicksort(Arrays.asList(Integer.MAX_VALUE, Integer.MIN_VALUE, 0)),
           Arrays.asList(Integer.MIN_VALUE, 0, Integer.MAX_VALUE));
        // Negative: error path (contract-violating inputs)
        throwsExc("Rejects null input", "negative", TypeError.class, () -> quicksort(null));
        throwsExc("Rejects null elements", "negative", TypeError.class, () -> quicksort(Arrays.asList(3, null, 2)));
        // Positive: invariant (correctness, not abnormal-handling)
        runCase("Does not mutate input", "happy", () -> {
            List<Integer> inp = new ArrayList<>(Arrays.asList(3, 1, 2));
            quicksort(inp);
            if (!inp.equals(Arrays.asList(3, 1, 2))) {
                throw new RuntimeException("input was mutated");
            }
        });
        // Positive: large-input robustness (legitimate input, verify no overflow)
        runCase("No stack-overflow on large sorted array", "happy", () -> {
            List<Integer> result = quicksort(big);
            if (!result.equals(big)) {
                throw new RuntimeException("large array not sorted correctly");
            }
        });

        int total = passed + failed;
        System.out.println("\n=== SUMMARY ===");
        System.out.println("Total: " + total + ", Passed: " + passed + ", Failed: " + failed);
        System.out.println("Negative cases: " + negTotal + "/" + total + " = " + Math.round(100.0 * negTotal / total) + "%");
        System.out.println("Negative passed: " + negPassed + "/" + negTotal);
        System.exit(failed == 0 ? 0 : 1);
    }
}
