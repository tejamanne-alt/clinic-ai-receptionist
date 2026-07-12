import { describe, expect, it } from "vitest";
import {
  buildMarkdownReport,
  computeProviderStats,
  suggestDefault,
  type ClipResult,
  type RunMeta,
} from "../scripts/bakeoff/report";

function clip(overrides: Partial<ClipResult>): ClipResult {
  return {
    provider: "sarvam",
    file: "clip01.wav",
    language: "mix",
    reference: "నాకు appointment కావాలి",
    hypothesis: "నాకు appointment కావాలి",
    wer: 0,
    cer: 0,
    latencyMs: 800,
    audioSeconds: 4,
    rtf: 0.2,
    error: null,
    ...overrides,
  };
}

const META: RunMeta = {
  generatedAt: "2026-07-12T00:00:00.000Z",
  manifestPath: "testdata/manifest.csv",
  clipCount: 2,
  missingFiles: [],
  codeMix: { total: 2, mix: 2, ratio: 1, meetsR5: true },
  providersRequested: ["sarvam", "azure"],
  providersConfigured: ["sarvam", "azure"],
};

describe("computeProviderStats", () => {
  it("aggregates per provider and per language", () => {
    const results = [
      clip({ wer: 0.1, latencyMs: 500, language: "te" }),
      clip({ file: "clip02.wav", wer: 0.3, latencyMs: 1500 }),
      clip({ provider: "azure", wer: 0.5, latencyMs: 900 }),
      clip({ provider: "azure", file: "clip02.wav", error: "HTTP 500", wer: null, cer: null }),
    ];
    const stats = computeProviderStats(results);
    const sarvam = stats.find((s) => s.provider === "sarvam");
    const azure = stats.find((s) => s.provider === "azure");
    expect(sarvam?.ok).toBe(2);
    expect(sarvam?.meanWer).toBeCloseTo(0.2);
    expect(sarvam?.werByLanguage.te).toBeCloseTo(0.1);
    expect(sarvam?.werByLanguage.mix).toBeCloseTo(0.3);
    expect(azure?.ok).toBe(1);
    expect(azure?.failed).toBe(1);
  });
});

describe("suggestDefault", () => {
  it("picks lowest mean WER among providers with ≥80% success", () => {
    const results = [
      clip({ wer: 0.2 }),
      clip({ provider: "azure", wer: 0.1 }),
    ];
    expect(suggestDefault(computeProviderStats(results))).toBe("azure");
  });
  it("disqualifies providers that mostly failed", () => {
    const results = [
      clip({ wer: 0.9 }),
      clip({ provider: "azure", wer: 0.01 }),
      ...Array.from({ length: 4 }, (_, i) =>
        clip({ provider: "azure", file: `f${i}.wav`, error: "boom", wer: null, cer: null }),
      ),
    ];
    expect(suggestDefault(computeProviderStats(results))).toBe("sarvam");
  });
  it("returns null when nothing qualifies", () => {
    expect(suggestDefault(computeProviderStats([clip({ error: "x", wer: null })]))).toBeNull();
  });
});

describe("buildMarkdownReport", () => {
  it("renders summary, language table, per-clip rows, and R5 status", () => {
    const md = buildMarkdownReport([clip({}), clip({ provider: "azure", wer: 0.25 })], META);
    expect(md).toContain("# STT bake-off report");
    expect(md).toContain("| sarvam |");
    expect(md).toContain("| azure |");
    expect(md).toContain("Mean WER by language tag");
    expect(md).toContain("clip01.wav");
    expect(md).toContain("✅");
    expect(md).toContain("Suggested default STT provider");
  });
  it("flags an R5 violation and escapes pipes in transcripts", () => {
    const md = buildMarkdownReport([clip({ hypothesis: "a|b", error: null })], {
      ...META,
      codeMix: { total: 4, mix: 1, ratio: 0.25, meetsR5: false },
      missingFiles: ["clip09.wav"],
    });
    expect(md).toContain("BELOW CONTRACT");
    expect(md).toContain("a\\|b");
    expect(md).toContain("clip09.wav");
  });
});
