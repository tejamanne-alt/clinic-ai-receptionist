import type { SttOptions, SttProvider, SttResult } from "../types";

function apiKey(): string | undefined {
  return process.env.GOOGLE_SPEECH_API_KEY;
}

interface GoogleRecognizeResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
}

/**
 * Google Cloud STT v1 sync recognize (≤60s, ≤10MB clips — fine for the
 * bake-off). WAV headers carry encoding/sample-rate, so no config needed
 * beyond languages; alternativeLanguageCodes gives us te/en code-mix
 * coverage. Bake-off comparison only — not a runtime provider (§4 says
 * Sarvam primary / Azure fallback).
 */
export const googleStt: SttProvider = {
  name: "google",
  isConfigured: () => Boolean(apiKey()),
  async transcribe(audio: Buffer, opts: SttOptions): Promise<SttResult> {
    const gKey = apiKey();
    if (!gKey) throw new Error("GOOGLE_SPEECH_API_KEY is not set");

    const primary = opts.languageHint === "en" ? "en-IN" : "te-IN";
    const alternates = opts.languageHint === "en" ? ["te-IN"] : ["en-IN"];

    const t0 = performance.now();
    const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${gKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          languageCode: primary,
          alternativeLanguageCodes: alternates,
          enableAutomaticPunctuation: false,
        },
        audio: { content: audio.toString("base64") },
      }),
      signal: opts.signal ?? null,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`google STT HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as GoogleRecognizeResponse;
    const text = (data.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? "")
      .join(" ")
      .trim();
    return { text, latencyMs, raw: data };
  },
};
