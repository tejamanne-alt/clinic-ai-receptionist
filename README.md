# వాణి · Vaani

Telugu-first AI voice receptionist for Indian clinics. A caller dials the
clinic, speaks Telugu / English / Tenglish code-mix, and books a real
appointment — it lands in the clinic dashboard and triggers a WhatsApp
confirmation (with in-call consent).

The full build contract lives in [`CLAUDE.md`](./CLAUDE.md); current progress
in [`BUILD_STATE.md`](./BUILD_STATE.md).

## Stack

Next.js 15 (App Router) · TypeScript strict · Supabase (Postgres + RLS) ·
Vapi voice orchestration · Sarvam / Azure Speech behind a `SpeechProvider`
adapter · WhatsApp via a `MessagingProvider` adapter.

## Getting started

```bash
pnpm install
cp .env.example .env        # fill in server-side keys (never NEXT_PUBLIC_)

# local Postgres for the full (integration) test suite:
pnpm db:setup               # creates + migrates + seeds a local vaani DB
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vaani

pnpm typecheck && pnpm lint && pnpm test
pnpm dev                    # /  status · /call browser call · /dashboard
```

Unit tests run without a DB; the integration suite (double-book race, RLS,
consent gate, webhook) needs `DATABASE_URL`. `pnpm test:ci` fails loudly if the
DB is missing so integration coverage can't be silently skipped.

Against a real Supabase project, apply `supabase/migrations/*.sql` in order
(`supabase db push`) then `supabase/seed.sql` for a demo clinic with two
doctors and two weeks of 15-minute slots.

## What works today

- **Booking core** — deterministic tools reading Postgres (I1); no double-book
  (DB constraint + `FOR UPDATE`, I6); book / cancel / reschedule / info / callback.
- **Call-flow engine** — the full §6 state machine as a pure, tested reducer:
  slot-fill order, explicit-yes readback gate, consent-before-WhatsApp, silence
  and confusion ladders, medical deflection, language mirroring.
- **Voice** — Vapi assistant built from the prompt files + tool registry;
  `/call` browser page with live transcript and first-audio latency.
- **Dashboard** — today's appointments, call log with outcomes, callback queue.
- **WhatsApp** — consent-gated confirmation (per-call consent, DB-backstopped).
- **Audits** — `pnpm audit:keys` (client-bundle secret scan), `pnpm audit:latency`,
  `pnpm roi`.

See `BUILD_STATE.md` for exact gate status and the human-blocked items.

## Phase 0 — STT/TTS bake-off

The bake-off decides whether Sarvam or Azure is the default speech provider
(§4 of the contract). It scores each provider on your own recorded clips —
Telugu-heavy, code-mix-heavy, phone-mic-real.

1. Record the ~20 clips listed in [`testdata/manifest.csv`](./testdata/manifest.csv)
   (conventions in [`testdata/README.md`](./testdata/README.md)), drop the
   `.wav` files into `testdata/`, and correct each `reference_transcript` to
   what you actually said.
2. `pnpm bakeoff` → `reports/bakeoff-report.md` (WER/CER, p50/p95 latency,
   real-time factor, per-language breakdown, suggested default).
3. `pnpm bakeoff:tts` → `reports/tts-samples/` WAVs from Sarvam Bulbul and
   Azure te-IN voices, for a listening test.

## Repository layout

```
CLAUDE.md                  build contract (source of truth)
BUILD_STATE.md             phase / gate / next-action state
prompts/                   versioned prompt files (VOICE / ANALYSIS / EXTRACTION kept separate)
scripts/bakeoff/           STT bake-off harness + TTS sample generator
src/app/                   Next.js app (dashboard lands Phase 2)
src/lib/speech/            SpeechProvider adapter interfaces + providers
src/lib/phone.ts           E.164 normalization, digit-pair readback
supabase/migrations/       schema, RLS, transactional booking functions
testdata/                  bake-off clips + manifest (recordings not committed by default)
tests/                     vitest unit tests
```
