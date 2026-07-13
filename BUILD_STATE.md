# BUILD_STATE

_Last updated: 2026-07-13 (session 2 — autonomous overnight run)_

## Where we are

Phases 0–3 are **code-complete and machine-verified** to the limit of what a
CI box can check. The remaining gate items are the ones the contract makes
human/hardware-dependent (recorded audio clips, a live phone call, a paid
WhatsApp/telephony number) — those are flagged **HUMAN-BLOCKED** below.

Reprioritization note: Phase 1's and Phase 2's *official* gates both need
Teja's keys/mic/phone, so this session inverted the build order to maximize
machine-checkable progress — the deterministic booking core, call-flow engine,
webhook, dashboard, and audits were built and tested first; the browser/PSTN
capture is what's left for a human.

## Gate status

| Phase | Gate | Status |
|---|---|---|
| 0 | typecheck + lint + test green | ✅ PASS (136 tests) |
| 0 | bake-off report from ≥20 clips | ⛔ HUMAN-BLOCKED — needs recorded clips + a provider key |
| 1 | call completes slot-fill; p50 first-audio <1.5s | ⚠️ engine + script done and tested; **live recorded call is HUMAN-BLOCKED** (needs Vapi keys + mic) |
| 1 | call-flow script reviewed by Teja | ⛔ HUMAN GATE — `prompts/voice/callflow.te-en.md` v1 drafted, awaiting review |
| 2 | double-book race / conflict / cancel suite | ✅ PASS (real-Postgres integration tests) |
| 2 | live WhatsApp confirmation on a real number | ⚠️ flow + consent gate done and tested with a spy/console provider; **real send is HUMAN-BLOCKED** (needs Gupshup number) |
| 3 | cold call from an unfamiliar phone books E2E | ⛔ HUMAN-BLOCKED — runbook in `docs/telephony.md` |

Inner loop (every change): `pnpm typecheck && pnpm lint && DATABASE_URL=… pnpm test` — all green.

## What exists (session 2 additions in **bold**)

- Next.js 15 + TS strict scaffold; **/call browser page, /dashboard, API routes**
- `supabase/migrations/` — §5 schema, RLS, `create_booking`/`cancel_booking`/
  **`reschedule_booking`**, `generate_slots`; **per-appointment WhatsApp consent,
  unique index on `calls(provider, provider_call_id)`, patient identity unique index**
- **`src/lib/tools/`** — zod-validated tool registry (find_slots, create_booking,
  cancel, reschedule, get_clinic_info, request_callback); all facts from Postgres (I1)
- **`src/lib/callflow/`** — deterministic §6 state machine + Tenglish lexicon +
  bilingual script loader
- **`src/lib/vapi/`** — assistant builder from prompt files + tools, webhook
  (tool exec, audit logging, latency events, fail-closed clinic scope)
- **`src/lib/messaging/`** — MessagingProvider adapter (Gupshup + console),
  consent-gated confirmation sender
- **`src/lib/speech/fallback.ts`** — Sarvam→Azure failover with honest reporting
- `scripts/` — bake-off harness (Phase 0), **db setup, vapi sync, key-exposure
  audit, latency report, ROI one-pager**
- Prompts: VOICE (`system.md`, `callflow.te-en.md`) / ANALYSIS / EXTRACTION, separate (I3)
- **136 tests** (89 unit + 47 real-Postgres integration): double-book race,
  RLS probe, transcript injection, consent gate incl. returning-patient,
  webhook clinic-scope + no-duplicate-calls, call-flow §6 rules

## Audit results (§8 outer loop)

- **Security:** key-exposure grep of the client bundle — ✅ clean (`pnpm audit:keys`).
  RLS probe — ✅ zero cross-clinic rows. Transcript injection — ✅ inert data.
- **Data integrity:** 12-way double-book race — ✅ exactly one winner (I6).
- **Resiliency:** STT primary-kill failover — ✅ tested, reports honestly.
- **Adversarial review:** three independent reviewers audited the full diff;
  **all confirmed findings fixed** — consent leak for returning patients,
  duplicate call rows, yes/no substring bug ("incorrect"→yes), option-choice
  ordering ("second one"→slot 2), INFO placeholder leak, reschedule doctor
  overload, 23505→alternatives, fail-closed clinic scope, patient race.
  Regression tests added for each. `test:ci` (REQUIRE_DB=1) fails loudly if the
  integration suite would skip.

## Open risks

- Migrations verified against local Postgres, not yet against a live Supabase
  project — first `supabase db push` may surface a nit (low risk).
- `calls.language_detected` is not yet persisted (needs the ANALYSIS-phase
  post-call pass or a language field from Vapi); intent/from_phone/consent are.
- Voice-model live behavior (I4 deflection, barge-in) is enforced by the
  system prompt + deterministic engine but is not machine-checkable without a
  live call — verify during the Phase 1 recording.

## Next action (for Teja)

1. **Record the 20 bake-off clips** (`testdata/README.md`), add a provider key,
   run `pnpm bakeoff` + `pnpm bakeoff:tts` → closes Phase 0.
2. **Review `prompts/voice/callflow.te-en.md`** (tone/wording) — Phase 1 human gate.
3. Set Vapi keys, `pnpm vapi:sync`, open `/call`, record the GREET→BOOK call with
   latency logs → closes Phase 1.
4. Add a Gupshup number → live WhatsApp confirmation → closes Phase 2.
5. Follow `docs/telephony.md` for the SIP number + `docs/demo-script.md` for the
   90-second cold-call demo → closes Phase 3.

Local dev: `pnpm db:setup` (Postgres on :5432) then `DATABASE_URL=… pnpm test`.
