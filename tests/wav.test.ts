import { describe, expect, it } from "vitest";
import { parseWavHeader } from "../scripts/bakeoff/wav";

/** Build a minimal valid WAV: PCM mono, given rate/width, `seconds` of silence. */
function makeWav(sampleRate: number, seconds: number, channels = 1, bits = 16): Buffer {
  const byteRate = sampleRate * channels * (bits / 8);
  const dataBytes = Math.round(byteRate * seconds);
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(channels * (bits / 8), 32); // block align
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

describe("parseWavHeader", () => {
  it("reads format and duration from a 16kHz mono clip", () => {
    const info = parseWavHeader(makeWav(16000, 2.5));
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.durationSeconds).toBeCloseTo(2.5, 2);
  });

  it("handles stereo 44.1kHz", () => {
    const info = parseWavHeader(makeWav(44100, 1, 2));
    expect(info.channels).toBe(2);
    expect(info.durationSeconds).toBeCloseTo(1, 2);
  });

  it("walks past extra chunks before data", () => {
    const base = makeWav(8000, 1);
    // splice a LIST chunk between fmt and data
    const list = Buffer.alloc(8 + 4);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(4, 4);
    const spliced = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)]);
    spliced.writeUInt32LE(base.readUInt32LE(4) + list.length, 4);
    const info = parseWavHeader(spliced);
    expect(info.durationSeconds).toBeCloseTo(1, 2);
  });

  it("rejects non-WAV buffers", () => {
    expect(() => parseWavHeader(Buffer.from("not a wav file at all, sorry!!!!!!!!!!!!!!!!"))).toThrow(
      /RIFF/,
    );
    expect(() => parseWavHeader(Buffer.alloc(10))).toThrow(/too short/);
  });
});
