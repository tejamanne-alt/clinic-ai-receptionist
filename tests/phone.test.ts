import { describe, expect, it } from "vitest";
import { formatDigitsInPairs, normalizeToE164 } from "../src/lib/phone";

describe("normalizeToE164 (§5: E.164 before storage)", () => {
  it("normalizes bare Indian mobiles", () => {
    expect(normalizeToE164("9849123456")).toBe("+919849123456");
    expect(normalizeToE164("98491 23456")).toBe("+919849123456");
  });
  it("strips trunk zeros and separators", () => {
    expect(normalizeToE164("098491-23456")).toBe("+919849123456");
    expect(normalizeToE164("0 98491 23456")).toBe("+919849123456");
  });
  it("accepts country-code prefixed forms", () => {
    expect(normalizeToE164("+91 98491 23456")).toBe("+919849123456");
    expect(normalizeToE164("919849123456")).toBe("+919849123456");
    expect(normalizeToE164("00919849123456")).toBe("+919849123456");
  });
  it("passes through valid non-Indian E.164", () => {
    expect(normalizeToE164("+1 (415) 555-0132")).toBe("+14155550132");
  });
  it("returns null instead of guessing — caller must re-ask", () => {
    expect(normalizeToE164("12345")).toBeNull(); // too short
    expect(normalizeToE164("5849123456")).toBeNull(); // invalid mobile prefix
    expect(normalizeToE164("98491234567890")).toBeNull(); // too long
    expect(normalizeToE164("call me maybe")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("+0123456789")).toBeNull(); // E.164 can't start with 0
  });
});

describe("formatDigitsInPairs (§6 rule 2: read digits back in pairs)", () => {
  it("groups an even count into pairs", () => {
    expect(formatDigitsInPairs("9849123456")).toBe("98 49 12 34 56");
  });
  it("leaves a trailing single for odd counts", () => {
    expect(formatDigitsInPairs("12345")).toBe("12 34 5");
  });
  it("ignores non-digits", () => {
    expect(formatDigitsInPairs("+91 98491-23456")).toBe("91 98 49 12 34 56");
  });
  it("returns empty for no digits", () => {
    expect(formatDigitsInPairs("hello")).toBe("");
  });
});
