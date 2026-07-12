import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../scripts/bakeoff/csv";
import { codeMixStats, parseManifest } from "../scripts/bakeoff/manifest";

describe("parseCsv", () => {
  it("parses quoted fields containing commas", () => {
    expect(parseCsv('a,"b, c",d\n')).toEqual([["a", "b, c", "d"]]);
  });
  it("unescapes doubled quotes", () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', "x"]]);
  });
  it("handles CRLF and skips blank lines", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFF" + "a,b\n")).toEqual([["a", "b"]]);
  });
});

const HEADER = "filename,reference_transcript,language,notes\n";

describe("parseManifest", () => {
  it("parses a valid manifest", () => {
    const rows = parseManifest(HEADER + 'clip01.wav,"హలో, appointment కావాలి",mix,test\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filename).toBe("clip01.wav");
    expect(rows[0]?.language).toBe("mix");
  });
  it("rejects a missing required column", () => {
    expect(() => parseManifest("filename,language\nclip.wav,te\n")).toThrow(/reference_transcript/);
  });
  it("rejects an invalid language tag", () => {
    expect(() => parseManifest(HEADER + "clip.wav,text,hindi,\n")).toThrow(/language/);
  });
  it("rejects non-wav and path-traversal filenames (I5: untrusted input)", () => {
    expect(() => parseManifest(HEADER + "clip.mp3,text,te,\n")).toThrow(/filename/);
    expect(() => parseManifest(HEADER + "../etc/passwd.wav,text,te,\n")).toThrow(/filename/);
  });
  it("rejects duplicate filenames", () => {
    expect(() =>
      parseManifest(HEADER + "a.wav,x,te,\na.wav,y,en,\n"),
    ).toThrow(/duplicate/);
  });
  it("rejects empty transcripts", () => {
    expect(() => parseManifest(HEADER + 'a.wav,"   ",te,\n')).toThrow(/reference_transcript/);
  });
});

describe("codeMixStats (R5)", () => {
  it("computes the code-mix ratio", () => {
    const rows = parseManifest(
      HEADER + "a.wav,x,mix,\nb.wav,y,te,\nc.wav,z,mix,\nd.wav,w,en,\n",
    );
    const stats = codeMixStats(rows);
    expect(stats.mix).toBe(2);
    expect(stats.ratio).toBe(0.5);
    expect(stats.meetsR5).toBe(true);
  });
});

describe("testdata/manifest.csv (the real one)", () => {
  const csv = readFileSync(path.join(__dirname, "..", "testdata", "manifest.csv"), "utf8");
  const rows = parseManifest(csv);

  it("has at least 20 clips (Phase 0 gate)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });
  it("is ≥50% code-mixed Tenglish (R5)", () => {
    expect(codeMixStats(rows).meetsR5).toBe(true);
  });
  it("covers the required stress variants", () => {
    const notes = rows.map((r) => r.notes.toLowerCase()).join(" | ");
    expect(notes).toContain("noise");
    expect(notes).toContain("pause");
    expect(notes).toContain("fast");
    expect(notes).toContain("number-heavy");
  });
  it("includes the I4 clinical-guardrail utterance", () => {
    expect(rows.some((r) => r.notes.includes("I4"))).toBe(true);
  });
});
