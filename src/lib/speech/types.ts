/**
 * SpeechProvider adapter contract (§4 architecture contract).
 *
 * STT/TTS vendors sit behind these interfaces — nothing outside
 * src/lib/speech/providers may talk to a vendor API directly, so the
 * runtime can fall back (e.g. Sarvam → Azure) without touching call-flow
 * code. The Phase 0 bake-off harness consumes the same interfaces.
 */

export type LanguageTag = "te" | "en" | "mix";

export interface SttOptions {
  /** Expected language of the clip; providers map "mix" to their best code-mix mode. */
  languageHint: LanguageTag;
  /** Original filename, used by multipart uploads. */
  filename?: string;
  /** Abort/timeout control for the underlying HTTP request. */
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
  latencyMs: number;
  raw?: unknown;
}

export interface SttProvider {
  readonly name: string;
  /** True when the required server-side env keys are present (I2: keys never reach the client). */
  isConfigured(): boolean;
  transcribe(audio: Buffer, opts: SttOptions): Promise<SttResult>;
}

export interface TtsOptions {
  language: LanguageTag;
  /** Provider-specific voice id; falls back to a sensible te-IN default. */
  voice?: string;
  signal?: AbortSignal;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  latencyMs: number;
}

export interface TtsProvider {
  readonly name: string;
  isConfigured(): boolean;
  synthesize(text: string, opts: TtsOptions): Promise<TtsResult>;
}
