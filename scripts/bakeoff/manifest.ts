import { z } from "zod";
import { parseCsv } from "./csv";

/**
 * testdata/manifest.csv contract (§7 Phase 0): filename, reference
 * transcript, language tag. Caller-supplied text is untrusted input (I5),
 * so every row passes zod validation before the harness touches disk.
 */
export const manifestRowSchema = z.object({
  filename: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._-]+\.wav$/i, "filename must be a plain .wav name (no paths)"),
  reference_transcript: z.string().trim().min(1, "reference_transcript is required"),
  language: z.enum(["te", "en", "mix"]),
  notes: z.string().optional().default(""),
});

export type ManifestRow = z.infer<typeof manifestRowSchema>;

const REQUIRED_COLUMNS = ["filename", "reference_transcript", "language"] as const;

export function parseManifest(csvText: string): ManifestRow[] {
  const rows = parseCsv(csvText);
  const headerRow = rows[0];
  if (!headerRow) throw new Error("manifest is empty");

  const header = headerRow.map((h) => h.trim().toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new Error(`manifest is missing required column "${col}"`);
  }

  const out: ManifestRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells) continue;
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = (cells[idx] ?? "").trim();
    });
    const parsed = manifestRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `manifest row ${i + 1} (${record.filename ?? "?"}): ${issue?.path.join(".")} — ${issue?.message}`,
      );
    }
    out.push(parsed.data);
  }

  const seen = new Set<string>();
  for (const row of out) {
    if (seen.has(row.filename)) throw new Error(`duplicate filename in manifest: ${row.filename}`);
    seen.add(row.filename);
  }
  return out;
}

/** R5: test data must be ≥50% code-mixed Tenglish. */
export function codeMixStats(rows: readonly ManifestRow[]): {
  total: number;
  mix: number;
  ratio: number;
  meetsR5: boolean;
} {
  const mix = rows.filter((r) => r.language === "mix").length;
  const ratio = rows.length === 0 ? 0 : mix / rows.length;
  return { total: rows.length, mix, ratio, meetsR5: ratio >= 0.5 };
}
