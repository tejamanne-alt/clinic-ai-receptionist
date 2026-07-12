/**
 * STT bake-off harness (§7 Phase 0).
 *
 * Usage:
 *   pnpm bakeoff [--manifest testdata/manifest.csv] [--audiodir testdata]
 *                [--out reports] [--providers sarvam,azure,google] [--limit N]
 *
 * Reads /testdata/*.wav plus the reference-transcript manifest, runs every
 * configured provider over every clip (sequentially — keeps latency numbers
 * honest and rate limits happy), and writes:
 *   reports/bakeoff-report.md    human-readable comparison table
 *   reports/bakeoff-results.json raw per-clip results
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { SttProvider } from "../../src/lib/speech/types";
import { sarvamStt } from "../../src/lib/speech/providers/sarvam";
import { azureStt } from "../../src/lib/speech/providers/azure";
import { googleStt } from "../../src/lib/speech/providers/google";
import { codeMixStats, parseManifest, type ManifestRow } from "./manifest";
import { charErrorRate, wordErrorRate } from "./metrics";
import { parseWavHeader } from "./wav";
import { buildMarkdownReport, computeProviderStats, type ClipResult, type RunMeta } from "./report";

const ALL_PROVIDERS: Record<string, SttProvider> = {
  sarvam: sarvamStt,
  azure: azureStt,
  google: googleStt,
};

const REQUEST_TIMEOUT_MS = 45_000;

async function transcribeWithRetry(
  provider: SttProvider,
  audio: Buffer,
  row: ManifestRow,
): Promise<{ text: string; latencyMs: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await provider.transcribe(audio, {
        languageHint: row.language,
        filename: row.filename,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string", default: "testdata/manifest.csv" },
      audiodir: { type: "string", default: "testdata" },
      out: { type: "string", default: "reports" },
      providers: { type: "string", default: "sarvam,azure,google" },
      limit: { type: "string" },
    },
  });

  const manifestPath = values.manifest ?? "testdata/manifest.csv";
  const audioDir = values.audiodir ?? "testdata";
  const outDir = values.out ?? "reports";

  const rows = parseManifest(await readFile(manifestPath, "utf8"));
  const mix = codeMixStats(rows);
  console.log(`Manifest: ${rows.length} rows · code-mix ${mix.mix}/${mix.total} (${(mix.ratio * 100).toFixed(0)}%)`);
  if (!mix.meetsR5) {
    console.warn("⚠️  R5 violation: <50% of clips are code-mixed Tenglish. Record more mix clips.");
  }

  const present = rows.filter((r) => existsSync(path.join(audioDir, r.filename)));
  const missing = rows.filter((r) => !present.includes(r)).map((r) => r.filename);
  if (missing.length > 0) {
    console.warn(`⚠️  ${missing.length}/${rows.length} clips missing from ${audioDir}/ — skipping them.`);
  }
  if (present.length === 0) {
    console.error(
      `No .wav files found in ${audioDir}/ matching the manifest.\n` +
        "Record the clips (see testdata/README.md), drop them in, and rerun `pnpm bakeoff`.",
    );
    process.exitCode = 1;
    return;
  }
  if (present.length < 20) {
    console.warn(`⚠️  Phase 0 gate wants ≥20 clips; only ${present.length} present. Report will be partial.`);
  }

  const limit = values.limit ? Number(values.limit) : undefined;
  const clips = limit && limit > 0 ? present.slice(0, limit) : present;

  const requested = (values.providers ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const unknown = requested.filter((p) => !(p in ALL_PROVIDERS));
  if (unknown.length > 0) {
    console.error(`Unknown providers: ${unknown.join(", ")} (available: ${Object.keys(ALL_PROVIDERS).join(", ")})`);
    process.exitCode = 1;
    return;
  }
  const providers = requested
    .map((p) => ALL_PROVIDERS[p])
    .filter((p): p is SttProvider => Boolean(p));
  const configured = providers.filter((p) => p.isConfigured());
  const skipped = providers.filter((p) => !p.isConfigured()).map((p) => p.name);
  if (skipped.length > 0) {
    console.warn(`⚠️  Skipping unconfigured providers (missing env keys): ${skipped.join(", ")}`);
  }
  if (configured.length === 0) {
    console.error("No STT provider is configured. Copy .env.example → .env and fill in at least one provider key.");
    process.exitCode = 1;
    return;
  }

  const results: ClipResult[] = [];
  for (const provider of configured) {
    console.log(`\n▶ ${provider.name}`);
    for (const row of clips) {
      const audio = await readFile(path.join(audioDir, row.filename));
      let audioSeconds: number | null = null;
      try {
        audioSeconds = parseWavHeader(audio).durationSeconds;
      } catch {
        console.warn(`  ${row.filename}: unreadable WAV header (RTF unavailable)`);
      }

      try {
        const { text, latencyMs } = await transcribeWithRetry(provider, audio, row);
        const wer = wordErrorRate(row.reference_transcript, text);
        const cer = charErrorRate(row.reference_transcript, text);
        results.push({
          provider: provider.name,
          file: row.filename,
          language: row.language,
          reference: row.reference_transcript,
          hypothesis: text,
          wer,
          cer,
          latencyMs,
          audioSeconds,
          rtf: audioSeconds && audioSeconds > 0 ? latencyMs / 1000 / audioSeconds : null,
          error: null,
        });
        console.log(`  ${row.filename}: WER ${(wer * 100).toFixed(1)}% · ${latencyMs}ms`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          provider: provider.name,
          file: row.filename,
          language: row.language,
          reference: row.reference_transcript,
          hypothesis: null,
          wer: null,
          cer: null,
          latencyMs: null,
          audioSeconds,
          rtf: null,
          error: message,
        });
        console.error(`  ${row.filename}: FAILED — ${message}`);
      }
    }
  }

  const meta: RunMeta = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    clipCount: clips.length,
    missingFiles: missing,
    codeMix: mix,
    providersRequested: requested,
    providersConfigured: configured.map((p) => p.name),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "bakeoff-results.json"), JSON.stringify({ meta, results }, null, 2));
  await writeFile(path.join(outDir, "bakeoff-report.md"), buildMarkdownReport(results, meta));

  console.log(`\nReport: ${path.join(outDir, "bakeoff-report.md")}`);
  for (const s of computeProviderStats(results)) {
    console.log(
      `  ${s.provider}: mean WER ${(s.meanWer * 100).toFixed(1)}% · p50 ${Math.round(s.p50LatencyMs)}ms · ` +
        `p95 ${Math.round(s.p95LatencyMs)}ms (${s.ok} ok / ${s.failed} failed)`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
