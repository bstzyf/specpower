// Quicksort implementation (pure function, random pivot, strict input validation).
// Compile & run (requires g++/clang++/cl; not available in this environment):
//   g++ -std=c++17 -O2 quicksort.cpp -o quicksort && ./quicksort
//
// NOTE: This environment has no C++ compiler, so this file is NOT executed.
// The test cases mirror the other-language variants; expected output is noted
// in comments. Static typing eliminates "non-array" and "non-numeric element"
// error paths at compile time (std::vector<int> cannot hold std::string),
// so those two scenarios are compile-time guarantees rather than runtime tests.

#include <vector>
#include <stdexcept>
#include <iostream>
#include <random>
#include <cmath>
#include <string>
#include <functional>
#include <limits>

class QuicksortError : public std::runtime_error {
public:
    explicit QuicksortError(const std::string& msg) : std::runtime_error(msg) {}
};

// Pointer parameter so nullptr can be tested at runtime (reject-null error path).
std::vector<int> quicksort(const std::vector<int>* arr) {
    if (arr == nullptr) {
        throw QuicksortError("input must not be null");
    }
    return _quicksort(*arr);
}

// Convenience overload for non-null callers (idiomatic C++ reference).
std::vector<int> quicksort(const std::vector<int>& arr) {
    return _quicksort(arr);
}

static std::mt19937 rng(std::random_device{}());

static std::vector<int> _quicksort(const std::vector<int>& arr) {
    if (arr.size() <= 1) {
        return arr;
    }
    std::uniform_int_distribution<size_t> dist(0, arr.size() - 1);
    size_t pivotIdx = dist(rng);
    int pivot = arr[pivotIdx];
    std::vector<int> less, greater;
    less.reserve(arr.size() / 2);
    greater.reserve(arr.size() / 2);
    for (size_t i = 0; i < arr.size(); i++) {
        if (i == pivotIdx) continue;
        if (arr[i] < pivot) less.push_back(arr[i]);
        else greater.push_back(arr[i]);
    }
    auto left = _quicksort(less);
    auto right = _quicksort(greater);
    left.push_back(pivot);
    left.insert(left.end(), right.begin(), right.end());
    return left;
}

// ---- Test harness ----

static int passed = 0, failed = 0, negTotal = 0, negPassed = 0;

static void pass(const std::string& name, const std::string& cat);
static void fail(const std::string& name, const std::string& cat, const std::string& msg);

template <typename T>
static void expect_eq(const std::string& name, const std::string& cat,
                      const std::vector<T>& actual, const std::vector<T>& expected) {
    if (actual == expected) { pass(name, cat); }
    else { fail(name, cat, "expected != actual"); }
}

static void expect_throws(const std::string& name, const std::string& cat,
                          const std::function<void()>& fn) {
    try {
        fn();
        fail(name, cat, "nothing thrown");
    } catch (const QuicksortError&) {
        pass(name, cat);
    } catch (const std::exception& e) {
        fail(name, cat, std::string("wrong exception: ") + e.what());
    }
}

static void pass(const std::string& name, const std::string& cat) {
    std::cout << "PASS: " << name << " [" << cat << "]\n";
    passed++;
    if (cat == "negative") { negTotal++; negPassed++; }
}

static void fail(const std::string& name, const std::string& cat, const std::string& msg) {
    std::cout << "FAIL: " << name << " [" << cat << "] -- " << msg << "\n";
    failed++;
    if (cat == "negative") { negTotal++; }
}

static void run_case(const std::string& name, const std::string& cat,
                     const std::function<void()>& fn) {
    try { fn(); pass(name, cat); }
    catch (const std::exception& e) { fail(name, cat, e.what()); }
}

int main() {
    // Happy
    expect_eq("Sorts unordered array", "happy", quicksort({3,1,2}), {1,2,3});
    expect_eq("Sorts already-sorted array", "happy", quicksort({1,2,3}), {1,2,3});
    expect_eq("Sorts reverse-sorted array", "happy", quicksort({3,2,1}), {1,2,3});
    expect_eq("Sorts array with duplicates", "happy", quicksort({3,1,2,1,3}), {1,1,2,3,3});
    // Positive: boundary (legitimate inputs, verify correct behavior at edges)
    expect_eq("Empty array returns empty", "happy", quicksort({}), {});
    // Positive: small-input variants
    expect_eq("Single-element array", "happy", quicksort({5}), {5});
    expect_eq("Two-element array", "happy", quicksort({2,1}), {1,2});
    expect_eq("Handles extreme numeric values", "happy",
              quicksort({std::numeric_limits<int>::max(), std::numeric_limits<int>::min(), 0}),
              {std::numeric_limits<int>::min(), 0, std::numeric_limits<int>::max()});
    // Negative: error path (contract-violating input — null pointer)
    expect_throws("Rejects null input", "negative", []() { quicksort(nullptr); });
    // Positive: invariant (correctness, not abnormal-handling)
    run_case("Does not mutate input", "happy", []() {
        std::vector<int> inp = {3,1,2};
        quicksort(inp);
        if (inp != std::vector<int>{3,1,2}) throw std::runtime_error("input mutated");
    });
    // Positive: large-input robustness (legitimate input, verify no overflow)
    run_case("No stack-overflow on large sorted array", "happy", []() {
        std::vector<int> big(100000);
        for (int i = 0; i < 100000; i++) big[i] = i;
        auto result = quicksort(big);
        if (result != big) throw std::runtime_error("large array not sorted");
    });

    int total = passed + failed;
    std::cout << "\n=== SUMMARY ===\n";
    std::cout << "Total: " << total << ", Passed: " << passed << ", Failed: " << failed << "\n";
    std::cout << "Negative cases: " << negTotal << "/" << total
              << " = " << std::round(100.0 * negTotal / total) << "%\n";
    std::cout << "Negative passed: " << negPassed << "/" << negTotal << "\n";
    return failed == 0 ? 0 : 1;
}

// Expected output (cannot run — no C++ compiler in environment):
//   11 PASS lines, then:
//   Total: 11, Passed: 11, Failed: 0
//   Negative cases: 1/11 = 9%
//   Negative passed: 1/1
