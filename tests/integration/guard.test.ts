import { describe, expect, it } from "vitest";
import { HAS_DB } from "./helpers";

/**
 * Gate integrity (B1): the integration suites `describe.skipIf(!HAS_DB)` so a
 * laptop without Postgres can still run unit tests. But that means a CI job
 * with a misconfigured DATABASE_URL would go GREEN with zero integration
 * coverage — silently passing the Phase-2 gate. This guard fails loudly when
 * REQUIRE_DB=1 (set in `pnpm test:ci`) but the DB is unreachable, so the
 * double-book race / RLS / consent tests can never be skipped in CI.
 */
describe("integration gate integrity", () => {
  it("has a reachable database when REQUIRE_DB is set", () => {
    if (process.env.REQUIRE_DB === "1") {
      expect(HAS_DB, "REQUIRE_DB=1 but DATABASE_URL is not set — integration tests would silently skip").toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});
