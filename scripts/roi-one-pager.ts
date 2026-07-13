/**
 * ROI one-pager generator (§7 Phase 3), fed with real booking + latency data
 * where available and clearly-labelled assumptions otherwise. No invented
 * outcomes — counts come from the DB; assumptions are marked as such.
 *
 * Usage: DATABASE_URL=... pnpm tsx scripts/roi-one-pager.ts [--clinic <uuid>]
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      clinic: { type: "string", default: process.env.DEMO_CLINIC_ID ?? "00000000-0000-0000-0000-000000000001" },
      out: { type: "string", default: "reports" },
    },
  });
  const clinicId = values.clinic ?? "";
  const outDir = values.out ?? "reports";

  let booked = 0;
  let calls = 0;
  let callbacks = 0;
  let dataNote = "";
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const b = await pool.query<{ n: number }>(
        `select count(*)::int as n from public.appointments where clinic_id = $1 and source = 'voice'`,
        [clinicId],
      );
      const c = await pool.query<{ n: number }>(`select count(*)::int as n from public.calls where clinic_id = $1`, [clinicId]);
      const cb = await pool.query<{ n: number }>(
        `select count(*)::int as n from public.callback_requests where clinic_id = $1`,
        [clinicId],
      );
      booked = b.rows[0]?.n ?? 0;
      calls = c.rows[0]?.n ?? 0;
      callbacks = cb.rows[0]?.n ?? 0;
    } finally {
      await pool.end();
    }
  } else {
    dataNote = "> No DATABASE_URL — booking/call counts below are 0; fill in after a demo run.\n";
  }

  // Assumptions (clearly labelled — R1: never present these as measured facts).
  const MISSED_CALL_RATE = 0.3; // industry: ~30% of clinic calls go unanswered at peak
  const AVG_CONSULT_FEE = 300; // ₹, from seed; a clinic edits this
  const RECEPTIONIST_MONTHLY = 15000; // ₹

  const answerRate = calls > 0 ? (booked / calls) : 0;

  const lines = [
    "# Vaani — ROI one-pager",
    "",
    `Clinic: ${clinicId}`,
    `Generated ${new Date().toISOString()}`,
    "",
    dataNote,
    "## Measured this run",
    "",
    "| Metric | Value | Source |",
    "|---|---:|---|",
    `| Voice bookings | ${booked} | appointments (source=voice) |`,
    `| Total calls | ${calls} | calls |`,
    `| Callbacks logged | ${callbacks} | callback_requests |`,
    `| Booking rate | ${(answerRate * 100).toFixed(0)}% | booked ÷ calls |`,
    "",
    "## The pitch (assumptions labelled)",
    "",
    `- Clinics miss ~**${MISSED_CALL_RATE * 100}%** of calls at peak hours *(assumption)*. Every missed`,
    "  call is a booking that walks to a competitor.",
    "- Vaani answers every call, 24/7, in Telugu — including after-hours and",
    "  festival rushes, without a second receptionist.",
    `- At an assumed ₹${AVG_CONSULT_FEE} consult fee, recovering even 5 missed`,
    "  bookings/day is meaningful revenue against a usage-based voice cost.",
    `- A human receptionist costs ~₹${RECEPTIONIST_MONTHLY.toLocaleString("en-IN")}/month *(assumption)*;`,
    "  Vaani complements them by taking overflow and after-hours, not replacing care.",
    "",
    "## What the demo proves",
    "",
    "- A cold caller books end-to-end in Telugu/Tenglish, survives interruption,",
    "  silence, and a slot conflict (§2 mission).",
    "- Every booking is deterministic (DB-enforced, no double-book) and audited.",
    "- WhatsApp confirmation lands only with the caller's consent.",
    "",
    "_Latency evidence: see reports/latency-report.md. STT choice: see reports/bakeoff-report.md._",
  ];

  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "roi-one-pager.md");
  await writeFile(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file} (booked=${booked}, calls=${calls}, callbacks=${callbacks})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
