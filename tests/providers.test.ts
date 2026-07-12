import { afterEach, describe, expect, it, vi } from "vitest";
import { sarvamStt } from "../src/lib/speech/providers/sarvam";
import { azureStt } from "../src/lib/speech/providers/azure";
import { googleStt } from "../src/lib/speech/providers/google";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isConfigured (I2: server-side env keys)", () => {
  it("sarvam requires SARVAM_API_KEY", () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    expect(sarvamStt.isConfigured()).toBe(false);
    vi.stubEnv("SARVAM_API_KEY", "sk-test");
    expect(sarvamStt.isConfigured()).toBe(true);
  });
  it("azure requires key AND region", () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "k");
    vi.stubEnv("AZURE_SPEECH_REGION", "");
    expect(azureStt.isConfigured()).toBe(false);
    vi.stubEnv("AZURE_SPEECH_REGION", "centralindia");
    expect(azureStt.isConfigured()).toBe(true);
  });
  it("google requires GOOGLE_SPEECH_API_KEY", () => {
    vi.stubEnv("GOOGLE_SPEECH_API_KEY", "");
    expect(googleStt.isConfigured()).toBe(false);
  });
});

describe("sarvam transcribe (mocked HTTP)", () => {
  it("sends the key header and returns transcript + latency", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sk-test");
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["api-subscription-key"]).toBe("sk-test");
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ transcript: "నాకు appointment కావాలి" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sarvamStt.transcribe(Buffer.from("RIFFfake"), {
      languageHint: "mix",
      filename: "clip01.wav",
    });
    expect(result.text).toBe("నాకు appointment కావాలి");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a descriptive error on HTTP failure", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );
    await expect(
      sarvamStt.transcribe(Buffer.from("x"), { languageHint: "te" }),
    ).rejects.toThrow(/429/);
  });
});

describe("azure transcribe (mocked HTTP)", () => {
  it("maps code-mix hint to te-IN and reads DisplayText", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "k");
    vi.stubEnv("AZURE_SPEECH_REGION", "centralindia");
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("language=te-IN");
      expect(String(url)).toContain("centralindia.stt.speech.microsoft.com");
      return new Response(
        JSON.stringify({ RecognitionStatus: "Success", DisplayText: "నా appointment cancel చేయాలి" }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await azureStt.transcribe(Buffer.from("RIFFfake"), { languageHint: "mix" });
    expect(result.text).toBe("నా appointment cancel చేయాలి");
  });

  it("returns empty text (not a crash) when recognition fails", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "k");
    vi.stubEnv("AZURE_SPEECH_REGION", "centralindia");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ RecognitionStatus: "NoMatch" }), { status: 200 })),
    );
    const result = await azureStt.transcribe(Buffer.from("x"), { languageHint: "te" });
    expect(result.text).toBe("");
  });
});

describe("google transcribe (mocked HTTP)", () => {
  it("joins multi-result transcripts", async () => {
    vi.stubEnv("GOOGLE_SPEECH_API_KEY", "g-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              { alternatives: [{ transcript: "రేపు morning" }] },
              { alternatives: [{ transcript: "free slots ఉన్నాయా" }] },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await googleStt.transcribe(Buffer.from("x"), { languageHint: "mix" });
    expect(result.text).toBe("రేపు morning free slots ఉన్నాయా");
  });
});
