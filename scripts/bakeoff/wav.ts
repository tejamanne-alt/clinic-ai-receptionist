export interface WavInfo {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
}

/**
 * Parse a RIFF/WAVE header to get clip duration (needed for real-time-factor
 * math) without decoding audio. Walks chunks properly rather than assuming
 * a fixed 44-byte header, since recorder apps often insert LIST/INFO chunks.
 */
export function parseWavHeader(buf: Buffer): WavInfo {
  if (buf.length < 44) throw new Error("not a WAV file: too short");
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file: missing RIFF/WAVE magic");
  }

  let offset = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "durationSeconds"> | null = null;
  let dataBytes: number | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - body);
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) throw new Error("WAV file has no fmt chunk");
  if (dataBytes === null) throw new Error("WAV file has no data chunk");
  const byteRate = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  const durationSeconds = byteRate > 0 ? dataBytes / byteRate : 0;
  return { ...fmt, dataBytes, durationSeconds };
}
