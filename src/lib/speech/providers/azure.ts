import type {
  SttOptions,
  SttProvider,
  SttResult,
  TtsOptions,
  TtsProvider,
  TtsResult,
} from "../types";

function key(): string | undefined {
  return process.env.AZURE_SPEECH_KEY;
}
function region(): string | undefined {
  return process.env.AZURE_SPEECH_REGION;
}
function configured(): boolean {
  return Boolean(key() && region());
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Azure Speech STT (short-audio REST endpoint, ≤60s clips).
 * Limitation worth knowing: this endpoint takes a single language, so
 * code-mix clips run as te-IN — Azure's te-IN model transcribes embedded
 * English words into Telugu script, which the WER normalizer cannot fully
 * reconcile. The bake-off report calls this out per provider.
 */
export const azureStt: SttProvider = {
  name: "azure",
  isConfigured: configured,
  async transcribe(audio: Buffer, opts: SttOptions): Promise<SttResult> {
    if (!configured()) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set");
    const lang = opts.languageHint === "en" ? "en-IN" : "te-IN";
    const url =
      `https://${region()}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${lang}&format=simple`;

    const t0 = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key() as string,
        "Content-Type": "audio/wav",
        Accept: "application/json",
      },
      body: new Uint8Array(audio),
      signal: opts.signal ?? null,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`azure STT HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
    if (data.RecognitionStatus !== "Success") {
      return { text: "", latencyMs, raw: data };
    }
    return { text: data.DisplayText ?? "", latencyMs, raw: data };
  },
};

/** Azure neural TTS (te-IN voices: ShrutiNeural / MohanNeural). */
export const azureTts: TtsProvider = {
  name: "azure",
  isConfigured: configured,
  async synthesize(text: string, opts: TtsOptions): Promise<TtsResult> {
    if (!configured()) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set");
    const lang = opts.language === "en" ? "en-IN" : "te-IN";
    const voice =
      opts.voice ??
      (lang === "te-IN"
        ? process.env.AZURE_TTS_VOICE ?? "te-IN-ShrutiNeural"
        : "en-IN-NeerjaNeural");
    const ssml =
      `<speak version='1.0' xml:lang='${lang}'>` +
      `<voice name='${voice}'>${escapeXml(text)}</voice></speak>`;

    const t0 = performance.now();
    const res = await fetch(`https://${region()}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key() as string,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
      },
      body: ssml,
      signal: opts.signal ?? null,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`azure TTS HTTP ${res.status}: ${body}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, mimeType: "audio/wav", latencyMs };
  },
};
