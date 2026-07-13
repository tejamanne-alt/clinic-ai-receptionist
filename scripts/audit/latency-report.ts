/**
 * R4 latency evidence from real turn logs. Reads call_events (tool + speech
 * events carry latency_ms) and reports p50/p95 per event type, plus the
 * first-audio proxy, against the contract budgets (p50 < 1.5s, p95 < 2.5s).
 *
 * Usage: DATABASE_URL=... pnpm tsx scripts/audit/latency-report.ts [--out reports]
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? NaN;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string", default: "reports" } } });
  const outDir = values.out ?? "reports";
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query<{ event_type: string; latency_ms: number }>(
    `select event_type, latency_ms from public.call_events where latency_ms is not null`,
  );
  await pool.end();

  if (rows.length === 0) {
    console.log("No latency-bearing events yet. Make some calls, then rerun.");
    return;
  }

  const byType = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byType.get(r.event_type) ?? [];
    arr.push(r.latency_ms);
    byType.set(r.event_type, arr);
  }

  const lines: string[] = [
    "# Latency report (R4)",
    "",
    `Generated ${new Date().toISOString()} from ${rows.length} timed events.`,
    "Budget: p50 first-audio < 1500ms, p95 < 2500ms.",
    "",
    "| Event | n | p50 (ms) | p95 (ms) | max (ms) |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [type, vals] of [...byType.entries()].sort()) {
    lines.push(
      `| ${type} | ${vals.length} | ${Math.round(percentile(vals, 50))} | ` +
        `${Math.round(percentile(vals, 95))} | ${Math.round(Math.max(...vals))} |`,
    );
  }
  lines.push("");
  lines.push(
    "> Tool latency is server-side round-trip only; end-to-end first-audio is " +
      "measured in the browser (/call page) and in Vapi's own call analytics.",
  );

  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "latency-report.md");
  await writeFile(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file}`);
  for (const [type, vals] of [...byType.entries()].sort()) {
    console.log(`  ${type}: p50 ${Math.round(percentile(vals, 50))}ms · p95 ${Math.round(percentile(vals, 95))}ms`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
