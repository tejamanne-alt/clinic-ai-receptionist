# Test clips for the STT bake-off

The harness (`pnpm bakeoff`) scores every `.wav` here that appears in
`manifest.csv`. The manifest is pre-filled with 20 utterances (Appendix A of
`CLAUDE.md` plus variants) — **record yourself saying each one and replace the
`reference_transcript` with the exact words you actually said.**

## Recording checklist

- WAV format, mono, 16 kHz or higher (any WAV works; the harness reads the header).
- Keep each clip under 60 seconds (Google's sync API limit).
- Phone-mic quality is *good* — that's what real callers sound like.
- Required variants (already assigned in the manifest notes):
  - one clip with background clinic noise (clip19)
  - one with a long pause mid-sentence (clip17)
  - one spoken fast (clip18)
  - one number-heavy phone dictation (clip13)
- R5: ≥50% of clips must be code-mixed Tenglish. The prefilled manifest is at
  65% — keep it that way if you swap utterances. `pnpm test` enforces this.

## Transcript conventions (matters for fair WER scoring)

- Telugu words in Telugu script, English words in Latin script, numbers as digits
  ("నా number 98491 23456").
- Write what was *said*, including fillers you actually uttered.
- Providers differ in which script they emit English loanwords in; the report
  flags this — always eyeball raw transcripts before trusting close WER gaps.

## Running

```bash
cp .env.example .env   # fill in at least one provider key
pnpm bakeoff           # writes reports/bakeoff-report.md
```
