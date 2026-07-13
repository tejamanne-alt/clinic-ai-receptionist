import type { SttOptions, SttProvider, SttResult, TtsOptions, TtsProvider, TtsResult } from "./types";

/**
 * §8 resiliency contract: if the primary STT/TTS provider dies mid-call,
 * fall back gracefully — and honestly. The wrapper reports which provider
 * served each request plus whether a failover happened, so the voice layer
 * can inject the scripted apology line (tool_error_apology) instead of
 * pretending nothing happened.
 */

export interface FailoverInfo {
  /** provider that actually served the request */
  served: string;
  /** true when the primary failed and the fallback answered */
  failedOver: boolean;
  primaryError?: string;
}

export class FallbackSttProvider implements SttProvider {
  readonly name: string;
  lastFailover: FailoverInfo | null = null;

  constructor(
    private readonly primary: SttProvider,
    private readonly fallback: SttProvider,
    private readonly onFailover?: (info: FailoverInfo) => void,
  ) {
    this.name = `${primary.name}→${fallback.name}`;
  }

  isConfigured(): boolean {
    return this.primary.isConfigured() || this.fallback.isConfigured();
  }

  async transcribe(audio: Buffer, opts: SttOptions): Promise<SttResult> {
    if (this.primary.isConfigured()) {
      try {
        const result = await this.primary.transcribe(audio, opts);
        this.lastFailover = { served: this.primary.name, failedOver: false };
        return result;
      } catch (err) {
        const info: FailoverInfo = {
          served: this.fallback.name,
          failedOver: true,
          primaryError: err instanceof Error ? err.message : String(err),
        };
        this.lastFailover = info;
        this.onFailover?.(info);
        if (!this.fallback.isConfigured()) throw err;
        return this.fallback.transcribe(audio, opts);
      }
    }
    if (!this.fallback.isConfigured()) {
      throw new Error(`neither ${this.primary.name} nor ${this.fallback.name} is configured`);
    }
    this.lastFailover = { served: this.fallback.name, failedOver: false };
    return this.fallback.transcribe(audio, opts);
  }
}

export class FallbackTtsProvider implements TtsProvider {
  readonly name: string;
  lastFailover: FailoverInfo | null = null;

  constructor(
    private readonly primary: TtsProvider,
    private readonly fallback: TtsProvider,
    private readonly onFailover?: (info: FailoverInfo) => void,
  ) {
    this.name = `${primary.name}→${fallback.name}`;
  }

  isConfigured(): boolean {
    return this.primary.isConfigured() || this.fallback.isConfigured();
  }

  async synthesize(text: string, opts: TtsOptions): Promise<TtsResult> {
    if (this.primary.isConfigured()) {
      try {
        const result = await this.primary.synthesize(text, opts);
        this.lastFailover = { served: this.primary.name, failedOver: false };
        return result;
      } catch (err) {
        const info: FailoverInfo = {
          served: this.fallback.name,
          failedOver: true,
          primaryError: err instanceof Error ? err.message : String(err),
        };
        this.lastFailover = info;
        this.onFailover?.(info);
        if (!this.fallback.isConfigured()) throw err;
        return this.fallback.synthesize(text, opts);
      }
    }
    if (!this.fallback.isConfigured()) {
      throw new Error(`neither ${this.primary.name} nor ${this.fallback.name} is configured`);
    }
    this.lastFailover = { served: this.fallback.name, failedOver: false };
    return this.fallback.synthesize(text, opts);
  }
}
