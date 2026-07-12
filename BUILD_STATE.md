# BUILD_STATE

_Last updated: 2026-07-12 (session 1)_

## Current phase

**Phase 0 — Scaffold + bake-off harness** (§7)

## Gate status

| Check | Status |
|---|---|
| `pnpm typecheck` | ✅ green |
| `pnpm lint` | ✅ green |
| `pnpm test` | ✅ green |
| Bake-off report from ≥20 clips | ⏳ **BLOCKED on Teja** — needs recorded clips + provider keys |

Phase 0 gate overall: **BLOCKED** (code complete; evidence pending recordings).

## What exists

- Next.js 15 + TS strict scaffold; placeholder status page (dashboard is Phase 2)
- `supabase/migrations/` — §5 schema: 10 contract tables + `clinic_members`
  (RLS mapping), partial unique index on `appointments(doctor_id, slot_start)
  where status='confirmed'` (I6), `create_booking`/`cancel_booking` with
  `SELECT … FOR UPDATE` re-check, `generate_slots`, RLS policies per clinic
- `.env.example` — server-only key custody (I2), enforced by `tests/env.test.ts`
- `scripts/bakeoff/` — STT harness (Sarvam / Azure / Google) with WER/CER +
  p50/p95 latency + RTF report, and a TTS sample generator (Sarvam Bulbul,
  Azure te-IN); providers implement the `SpeechProvider` adapter interfaces
- `testdata/manifest.csv` — 20 prefilled rows, 65% code-mix (R5 ✅), required
  stress variants assigned (noise / pause / fast / number-heavy)
- 61 unit tests (metrics, manifest, WAV parsing, E.164, key custody, providers, report)

## Open risks

- Migrations are hand-verified only — not yet run against a live Supabase
  instance (no Postgres in the build environment). First `supabase db push`
  may surface syntax nits. Low risk, checked carefully.
- Azure short-audio STT is single-language; code-mix clips run as `te-IN`,
  which penalizes its WER on Tenglish. The report calls this out.
- WER across providers is muddied by loanword script choice (Latin vs
  Telugu); report includes raw transcripts for eyeballing.

## Next action (for Teja)

1. Record the 20 clips per `testdata/README.md`, fix `reference_transcript`
   values to match what you actually said.
2. Get keys: Sarvam (free tier), Azure Speech (free F0, `centralindia`),
   optionally Google. Copy `.env.example` → `.env`.
3. Run `pnpm bakeoff` and `pnpm bakeoff:tts`; commit `reports/bakeoff-report.md`.

Then Phase 0 gate closes and Phase 1 (browser voice loop + call-flow script
for your review) begins.
