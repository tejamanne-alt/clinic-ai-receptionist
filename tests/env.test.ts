import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * I2 (key custody) guard: no secret in the env template may carry the
 * NEXT_PUBLIC_ prefix, because Next.js inlines those into client JS.
 * The outer-audit key-exposure grep builds on this; this test keeps the
 * template itself honest from day one.
 */
const PUBLIC_ALLOWLIST = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
const SECRET_HINTS = /(KEY|SECRET|TOKEN|SERVICE_ROLE|AUTH)/;

function envKeys(): string[] {
  const text = readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  return text
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));
}

describe(".env.example key custody (I2)", () => {
  const keys = envKeys();

  it("has keys to check", () => {
    expect(keys.length).toBeGreaterThan(5);
  });

  it("only allowlisted NEXT_PUBLIC_ vars exist", () => {
    const publics = keys.filter((k) => k.startsWith("NEXT_PUBLIC_"));
    for (const k of publics) {
      expect(PUBLIC_ALLOWLIST.has(k), `unexpected public env var ${k}`).toBe(true);
    }
  });

  it("no secret-looking key is NEXT_PUBLIC_ (except the RLS-protected anon key)", () => {
    const leaked = keys.filter(
      (k) => k.startsWith("NEXT_PUBLIC_") && SECRET_HINTS.test(k) && !PUBLIC_ALLOWLIST.has(k),
    );
    expect(leaked).toEqual([]);
  });

  it("service-role key is present and server-side only", () => {
    expect(keys).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(keys).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
  });
});
