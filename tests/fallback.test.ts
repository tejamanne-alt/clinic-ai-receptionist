import { describe, expect, it, vi } from "vitest";
import { FallbackSttProvider, FallbackTtsProvider } from "../src/lib/speech/fallback";
import type { SttProvider, TtsProvider } from "../src/lib/speech/types";

function stt(name: string, behavior: "ok" | "fail" | "unconfigured"): SttProvider {
  return {
    name,
    isConfigured: () => behavior !== "unconfigured",
    transcribe: async () => {
      if (behavior === "fail") throw new Error(`${name} exploded mid-call`);
      return { text: `${name} transcript`, latencyMs: 100 };
    },
  };
}

function tts(name: string, behavior: "ok" | "fail" | "unconfigured"): TtsProvider {
  return {
    name,
    isConfigured: () => behavior !== "unconfigured",
    synthesize: async () => {
      if (behavior === "fail") throw new Error(`${name} exploded mid-call`);
      return { audio: Buffer.from(name), mimeType: "audio/wav", latencyMs: 100 };
    },
  };
}

describe("FallbackSttProvider (§8 resiliency: kill primary mid-call)", () => {
  it("uses the primary when healthy", async () => {
    const p = new FallbackSttProvider(stt("sarvam", "ok"), stt("azure", "ok"));
    const r = await p.transcribe(Buffer.from("x"), { languageHint: "mix" });
    expect(r.text).toBe("sarvam transcript");
    expect(p.lastFailover).toEqual({ served: "sarvam", failedOver: false });
  });

  it("fails over to azure and reports it honestly (no silent recovery)", async () => {
    const onFailover = vi.fn();
    const p = new FallbackSttProvider(stt("sarvam", "fail"), stt("azure", "ok"), onFailover);
    const r = await p.transcribe(Buffer.from("x"), { languageHint: "te" });
    expect(r.text).toBe("azure transcript");
    expect(p.lastFailover?.failedOver).toBe(true);
    expect(p.lastFailover?.primaryError).toContain("exploded");
    expect(onFailover).toHaveBeenCalledOnce(); // hook for the apology line + call_events log
  });

  it("skips an unconfigured primary without counting it as a failure", async () => {
    const p = new FallbackSttProvider(stt("sarvam", "unconfigured"), stt("azure", "ok"));
    const r = await p.transcribe(Buffer.from("x"), { languageHint: "en" });
    expect(r.text).toBe("azure transcript");
    expect(p.lastFailover?.failedOver).toBe(false);
  });

  it("surfaces the primary error when no fallback exists", async () => {
    const p = new FallbackSttProvider(stt("sarvam", "fail"), stt("azure", "unconfigured"));
    await expect(p.transcribe(Buffer.from("x"), { languageHint: "te" })).rejects.toThrow("sarvam exploded");
  });

  it("throws a clear error when nothing is configured", async () => {
    const p = new FallbackSttProvider(stt("sarvam", "unconfigured"), stt("azure", "unconfigured"));
    await expect(p.transcribe(Buffer.from("x"), { languageHint: "te" })).rejects.toThrow(/neither/);
  });
});

describe("FallbackTtsProvider", () => {
  it("fails over for synthesis too", async () => {
    const p = new FallbackTtsProvider(tts("sarvam", "fail"), tts("azure", "ok"));
    const r = await p.synthesize("నమస్తే", { language: "te" });
    expect(r.audio.toString()).toBe("azure");
    expect(p.lastFailover?.failedOver).toBe(true);
  });
});
