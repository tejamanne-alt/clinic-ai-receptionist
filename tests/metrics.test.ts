import { describe, expect, it } from "vitest";
import {
  charErrorRate,
  levenshtein,
  mean,
  normalizeForScoring,
  percentile,
  wordErrorRate,
} from "../scripts/bakeoff/metrics";

describe("levenshtein", () => {
  it("is 0 for identical sequences", () => {
    expect(levenshtein(["a", "b"], ["a", "b"])).toBe(0);
  });
  it("computes the classic kitten→sitting distance", () => {
    expect(levenshtein([..."kitten"], [..."sitting"])).toBe(3);
  });
  it("handles empty sequences", () => {
    expect(levenshtein([], ["x", "y"])).toBe(2);
    expect(levenshtein(["x"], [])).toBe(1);
    expect(levenshtein([], [])).toBe(0);
  });
});

describe("normalizeForScoring", () => {
  it("folds case and strips punctuation", () => {
    expect(normalizeForScoring("Hello, Doctor!")).toBe("hello doctor");
  });
  it("strips zero-width joiners that vary across Telugu keyboards", () => {
    const withZwnj = "చేయ" + "\u200C" + "ాలి";
    const without = "చేయాలి";
    expect(normalizeForScoring(withZwnj)).toBe(normalizeForScoring(without));
  });
  it("collapses whitespace", () => {
    expect(normalizeForScoring("  slot   book  ")).toBe("slot book");
  });
});

describe("wordErrorRate", () => {
  it("is 0 for an exact match modulo punctuation/case", () => {
    expect(wordErrorRate("Naaku appointment kavali.", "naaku appointment kavali")).toBe(0);
  });
  it("scores a Telugu-script code-mix match", () => {
    expect(wordErrorRate("నా appointment cancel చేయాలి.", "నా appointment cancel చేయాలి")).toBe(0);
  });
  it("counts one missing word out of three as 1/3", () => {
    expect(wordErrorRate("naaku appointment kavali", "naaku kavali")).toBeCloseTo(1 / 3);
  });
  it("handles empty reference edge cases", () => {
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("", "hello")).toBe(1);
  });
  it("can exceed 1 when the hypothesis is much longer", () => {
    expect(wordErrorRate("hi", "hi there doctor garu")).toBeGreaterThan(1);
  });
});

describe("charErrorRate", () => {
  it("scores substitutions at character granularity", () => {
    expect(charErrorRate("abcd", "abcf")).toBeCloseTo(0.25);
  });
  it("ignores spaces so agglutination differences score gently", () => {
    expect(charErrorRate("slot book", "slotbook")).toBe(0);
  });
});

describe("percentile / mean", () => {
  it("computes nearest-rank percentiles", () => {
    const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(xs, 50)).toBe(500);
    expect(percentile(xs, 95)).toBe(1000);
    expect(percentile([42], 95)).toBe(42);
  });
  it("means", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(Number.isNaN(mean([]))).toBe(true);
  });
});
