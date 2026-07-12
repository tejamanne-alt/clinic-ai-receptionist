import type { LanguageTag } from "../../src/lib/speech/types";
import { mean, percentile } from "./metrics";

export interface ClipResult {
  provider: string;
  file: string;
  language: LanguageTag;
  reference: string;
  hypothesis: string | null;
  wer: number | null;
  cer: number | null;
  latencyMs: number | null;
  audioSeconds: number | null;
  /** real-time factor: processing time ÷ audio duration (lower is faster) */
  rtf: number | null;
  error: string | null;
}

export interface RunMeta {
  generatedAt: string;
  manifestPath: string;
  clipCount: number;
  missingFiles: string[];
  codeMix: { total: number; mix: number; ratio: number; meetsR5: boolean };
  providersRequested: string[];
  providersConfigured: string[];
}

interface ProviderStats {
  provider: string;
  ok: number;
  failed: number;
  meanWer: number;
  meanCer: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanRtf: number;
  werByLanguage: Partial<Record<LanguageTag, number>>;
}

function fmtPct(x: number): string {
  return Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`;
}
function fmtMs(x: number): string {
  return Number.isNaN(x) ? "—" : `${Math.round(x)}`;
}
function fmtNum(x: number, digits = 2): string {
  return Number.isNaN(x) ? "—" : x.toFixed(digits);
}

export function computeProviderStats(results: readonly ClipResult[]): ProviderStats[] {
  const providers = [...new Set(results.map((r) => r.provider))];
  return providers.map((provider) => {
    const all = results.filter((r) => r.provider === provider);
    const ok = all.filter((r) => r.error === null && r.wer !== null);
    const wers = ok.map((r) => r.wer as number);
    const cers = ok.map((r) => r.cer as number);
    const lats = ok.map((r) => r.latencyMs ?? NaN).filter((x) => !Number.isNaN(x));
    const rtfs = ok.map((r) => r.rtf ?? NaN).filter((x) => !Number.isNaN(x));

    const werByLanguage: Partial<Record<LanguageTag, number>> = {};
    for (const lang of ["te", "en", "mix"] as const) {
      const langWers = ok.filter((r) => r.language === lang).map((r) => r.wer as number);
      if (langWers.length > 0) werByLanguage[lang] = mean(langWers);
    }

    return {
      provider,
      ok: ok.length,
      failed: all.length - ok.length,
      meanWer: mean(wers),
      meanCer: mean(cers),
      p50LatencyMs: percentile(lats, 50),
      p95LatencyMs: percentile(lats, 95),
      meanRtf: mean(rtfs),
      werByLanguage,
    };
  });
}

/** Suggested default = lowest mean WER among providers with ≥80% clip success. */
export function suggestDefault(stats: readonly ProviderStats[]): string | null {
  const eligible = stats.filter(
    (s) => s.ok > 0 && s.ok / (s.ok + s.failed) >= 0.8 && !Number.isNaN(s.meanWer),
  );
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => a.meanWer - b.meanWer);
  return sorted[0]?.provider ?? null;
}

export function buildMarkdownReport(results: readonly ClipResult[], meta: RunMeta): string {
  const stats = computeProviderStats(results);
  const suggestion = suggestDefault(stats);
  const lines: string[] = [];

  lines.push("# STT bake-off report");
  lines.push("");
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Manifest: \`${meta.manifestPath}\` — ${meta.clipCount} clips scored`);
  lines.push(
    `Code-mix ratio (R5 requires ≥50%): ${meta.codeMix.mix}/${meta.codeMix.total} = ` +
      `${fmtPct(meta.codeMix.ratio)} ${meta.codeMix.meetsR5 ? "✅" : "❌ BELOW CONTRACT — add more Tenglish clips"}`,
  );
  if (meta.missingFiles.length > 0) {
    lines.push("");
    lines.push(
      `⚠️ ${meta.missingFiles.length} manifest rows skipped (no .wav on disk): ` +
        meta.missingFiles.map((f) => `\`${f}\``).join(", "),
    );
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Provider | Clips OK | Failed | Mean WER | Mean CER | p50 latency (ms) | p95 latency (ms) | Mean RTF |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of stats) {
    lines.push(
      `| ${s.provider} | ${s.ok} | ${s.failed} | ${fmtPct(s.meanWer)} | ${fmtPct(s.meanCer)} | ` +
        `${fmtMs(s.p50LatencyMs)} | ${fmtMs(s.p95LatencyMs)} | ${fmtNum(s.meanRtf)} |`,
    );
  }
  lines.push("");
  lines.push("### Mean WER by language tag");
  lines.push("");
  lines.push("| Provider | te | en | mix |");
  lines.push("|---|---:|---:|---:|");
  for (const s of stats) {
    lines.push(
      `| ${s.provider} | ${fmtPct(s.werByLanguage.te ?? NaN)} | ${fmtPct(s.werByLanguage.en ?? NaN)} | ` +
        `${fmtPct(s.werByLanguage.mix ?? NaN)} |`,
    );
  }
  lines.push("");
  lines.push(
    suggestion
      ? `**Suggested default STT provider:** \`${suggestion}\` (lowest mean WER with ≥80% success). ` +
          "Final call is Teja's — check the per-clip table for code-mix behaviour before wiring the adapter default."
      : "**No provider qualifies for a default suggestion** (need ≥80% clip success). Check errors below.",
  );
  lines.push("");
  lines.push(
    "> Scoring caveat: providers differ in which *script* they emit English loanwords in " +
      "(Latin vs Telugu). WER counts transliteration as an error, so eyeball the transcripts " +
      "below before trusting small WER gaps.",
  );
  lines.push("");
  lines.push("## Per-clip results");
  lines.push("");
  lines.push("| File | Lang | Provider | WER | CER | Latency (ms) | RTF | Transcript / error |");
  lines.push("|---|---|---|---:|---:|---:|---:|---|");
  for (const r of results) {
    const tail = r.error
      ? `❌ ${r.error.replace(/\|/g, "\\|").slice(0, 120)}`
      : (r.hypothesis ?? "").replace(/\|/g, "\\|").slice(0, 160);
    lines.push(
      `| ${r.file} | ${r.language} | ${r.provider} | ${r.wer === null ? "—" : fmtPct(r.wer)} | ` +
        `${r.cer === null ? "—" : fmtPct(r.cer)} | ${r.latencyMs ?? "—"} | ` +
        `${r.rtf === null ? "—" : fmtNum(r.rtf)} | ${tail} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
