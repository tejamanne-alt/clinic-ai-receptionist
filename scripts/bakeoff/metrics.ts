/**
 * STT accuracy metrics for Telugu / English / Tenglish code-mix.
 *
 * Normalization notes:
 * - NFC first: Telugu combining marks have multiple byte encodings.
 * - Zero-width joiners (U+200C/U+200D) are stripped — they vary by
 *   keyboard/provider but render identically.
 * - Punctuation (Latin + danda) becomes whitespace; case is folded for
 *   the Latin (English) portions. Telugu script has no case.
 *
 * Known caveat, documented in the report: providers differ in which
 * *script* they emit English loanwords in (Latin vs Telugu). WER treats a
 * transliterated word as an error, so cross-provider comparisons should be
 * read alongside the raw transcripts the harness stores.
 */

export function normalizeForScoring(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[.,!?;:'"“”‘’`()[\]{}\-–—…।|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance over arbitrary token arrays (two-row DP, O(len a × len b)). */
export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/** Word error rate against a reference. Empty reference: 0 if hyp empty too, else 1. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeForScoring(reference).split(" ").filter(Boolean);
  const hyp = normalizeForScoring(hypothesis).split(" ").filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

/** Character error rate (spaces excluded), more forgiving than WER for agglutinative Telugu. */
export function charErrorRate(reference: string, hypothesis: string): number {
  const ref = Array.from(normalizeForScoring(reference).replace(/ /g, ""));
  const hyp = Array.from(normalizeForScoring(hypothesis).replace(/ /g, ""));
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

/** Nearest-rank percentile; expects 0 ≤ p ≤ 100. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? NaN;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
