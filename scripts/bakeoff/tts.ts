/**
 * TTS sample generator for the shortlist (§7 Phase 0).
 *
 * Usage:
 *   pnpm bakeoff:tts [--phrases prompts/bakeoff/tts-phrases.txt]
 *                    [--out reports/tts-samples] [--providers sarvam,azure]
 *
 * Reads receptionist phrases (Telugu + Tenglish), synthesizes each with
 * every configured TTS provider, and writes WAVs plus a latency summary so
 * Teja can listen and judge naturalness. Note: these latencies are whole-
 * response times; streaming time-to-first-byte is measured properly in the
 * Phase 1 voice loop.
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import type { TtsProvider } from "../../src/lib/speech/types";
import { sarvamTts } from "../../src/lib/speech/providers/sarvam";
import { azureTts } from "../../src/lib/speech/providers/azure";

const ALL_PROVIDERS: Record<string, TtsProvider> = {
  sarvam: sarvamTts,
  azure: azureTts,
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      phrases: { type: "string", default: "prompts/bakeoff/tts-phrases.txt" },
      out: { type: "string", default: "reports/tts-samples" },
      providers: { type: "string", default: "sarvam,azure" },
    },
  });
  const phrasesPath = values.phrases ?? "prompts/bakeoff/tts-phrases.txt";
  const outDir = values.out ?? "reports/tts-samples";

  const phrases = (await readFile(phrasesPath, "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (phrases.length === 0) {
    console.error(`No phrases found in ${phrasesPath}`);
    process.exitCode = 1;
    return;
  }

  const requested = (values.providers ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const providers = requested
    .map((p) => ALL_PROVIDERS[p])
    .filter((p): p is TtsProvider => Boolean(p));
  const configured = providers.filter((p) => p.isConfigured());
  if (configured.length === 0) {
    console.error("No TTS provider is configured. Copy .env.example → .env and fill in provider keys.");
    process.exitCode = 1;
    return;
  }

  const summary: string[] = [
    "# TTS samples",
    "",
    `Phrases: \`${phrasesPath}\` · generated ${new Date().toISOString()}`,
    "",
    "| # | Provider | File | Latency (ms) | Bytes |",
    "|---:|---|---|---:|---:|",
  ];

  for (const provider of configured) {
    const dir = path.join(outDir, provider.name);
    await mkdir(dir, { recursive: true });
    console.log(`\n▶ ${provider.name}`);
    for (let i = 0; i < phrases.length; i++) {
      const text = phrases[i];
      if (!text) continue;
      try {
        const { audio, latencyMs } = await provider.synthesize(text, {
          language: "te",
          signal: AbortSignal.timeout(45_000),
        });
        const file = path.join(dir, `phrase-${String(i + 1).padStart(2, "0")}.wav`);
        await writeFile(file, audio);
        summary.push(`| ${i + 1} | ${provider.name} | ${file} | ${latencyMs} | ${audio.length} |`);
        console.log(`  phrase ${i + 1}: ${latencyMs}ms → ${file}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.push(`| ${i + 1} | ${provider.name} | ❌ ${message.slice(0, 80)} | — | — |`);
        console.error(`  phrase ${i + 1}: FAILED — ${message}`);
      }
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "tts-summary.md"), summary.join("\n") + "\n");
  console.log(`\nSummary: ${path.join(outDir, "tts-summary.md")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
