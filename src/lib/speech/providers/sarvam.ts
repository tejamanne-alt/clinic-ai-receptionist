import type {
  SttOptions,
  SttProvider,
  SttResult,
  TtsOptions,
  TtsProvider,
  TtsResult,
} from "../types";

const STT_URL = "https://api.sarvam.ai/speech-to-text";
const TTS_URL = "https://api.sarvam.ai/text-to-speech";

function apiKey(): string | undefined {
  return process.env.SARVAM_API_KEY;
}

async function httpError(res: Response, label: string): Promise<Error> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`${label} HTTP ${res.status}: ${body}`);
}

/** Sarvam Saarika STT. `language_code: unknown` enables auto-detect, which is Sarvam's supported path for Tenglish code-mix. */
export const sarvamStt: SttProvider = {
  name: "sarvam",
  isConfigured: () => Boolean(apiKey()),
  async transcribe(audio: Buffer, opts: SttOptions): Promise<SttResult> {
    const key = apiKey();
    if (!key) throw new Error("SARVAM_API_KEY is not set");

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
      opts.filename ?? "clip.wav",
    );
    form.append("model", process.env.SARVAM_STT_MODEL ?? "saarika:v2.5");
    form.append("language_code", opts.languageHint === "en" ? "en-IN" : "unknown");

    const t0 = performance.now();
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: opts.signal ?? null,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) throw await httpError(res, "sarvam STT");
    const data = (await res.json()) as { transcript?: string };
    return { text: data.transcript ?? "", latencyMs, raw: data };
  },
};

/** Sarvam Bulbul TTS. Returns a base64 WAV per input. */
export const sarvamTts: TtsProvider = {
  name: "sarvam",
  isConfigured: () => Boolean(apiKey()),
  async synthesize(text: string, opts: TtsOptions): Promise<TtsResult> {
    const key = apiKey();
    if (!key) throw new Error("SARVAM_API_KEY is not set");

    const t0 = performance.now();
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        target_language_code: opts.language === "en" ? "en-IN" : "te-IN",
        model: process.env.SARVAM_TTS_MODEL ?? "bulbul:v2",
        speaker: opts.voice ?? process.env.SARVAM_TTS_SPEAKER ?? "anushka",
      }),
      signal: opts.signal ?? null,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) throw await httpError(res, "sarvam TTS");
    const data = (await res.json()) as { audios?: string[] };
    const b64 = data.audios?.[0];
    if (!b64) throw new Error("sarvam TTS returned no audio");
    return { audio: Buffer.from(b64, "base64"), mimeType: "audio/wav", latencyMs };
  },
};
