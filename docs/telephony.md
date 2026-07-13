# Phase 3 — PSTN via SIP trunk (human-in-loop)

Goal: an Indian phone number that, when dialled, reaches the Vaani assistant.
Telephony config is a **human gate** (§7) — it needs a real number, KYC, and
provider dashboards. This doc is the runbook.

## Architecture

```
Caller's phone ──PSTN──▶ Exotel/Plivo number ──SIP trunk──▶ Vapi ──▶ assistant
                                                              │
                                                              ├─ tools → /api/vapi/webhook → Postgres
                                                              └─ STT/TTS (Sarvam primary, Azure fallback)
```

Vapi terminates the SIP leg and runs the same assistant the browser demo uses
(`scripts/vapi/sync-assistant.ts`) — so everything tested in Phases 1–2 carries
over unchanged. Only the transport in front of Vapi is new.

## Option A — Exotel (recommended for India)

1. Buy an Exophone (virtual number) in the Exotel dashboard; complete KYC.
2. In Vapi, create a **SIP trunk** credential (Vapi → Phone Numbers → SIP).
   Vapi gives you a SIP URI + credentials.
3. In Exotel, create a **SIP** connect applet / trunk pointing at the Vapi SIP
   URI; route the Exophone's incoming calls to it.
4. Attach the Vaani assistant to the Vapi phone number (`assistantId` from
   sync-assistant.ts).
5. Set `VAPI_WEBHOOK_SECRET` in prod and confirm `PUBLIC_BASE_URL` is the live
   HTTPS host so tool calls reach `/api/vapi/webhook`.

## Option B — Plivo

Same shape: Plivo number → SIP trunk → Vapi SIP URI. Use Plivo's XML/`<Dial>`
to the SIP endpoint if trunk routing isn't available on your plan.

## Barge-in & silence tuning (§6 rules 6, 9)

Tuned in the assistant config (`src/lib/vapi/assistant.ts`):
- `stopSpeakingPlan.numWords: 1` — TTS halts as soon as the caller speaks.
- `startSpeakingPlan.waitSeconds: 0.4` — snappy turn-taking.
- `silenceTimeoutSeconds: 10` — backstop; the flow itself reprompts at ~4s and
  offers a callback at ~8s.
Adjust on real PSTN audio (jitter/echo differ from WebRTC).

## Cold-call gate (§7 Phase 3)

The phase closes when someone dials the number from an unfamiliar phone and
completes a booking end-to-end. Capture:
- a 90-second recording (`docs/demo-script.md`),
- the dashboard row that appears,
- the WhatsApp confirmation screenshot,
- `reports/latency-report.md` regenerated from that call's events.

## Cost note (Phase 10 builder context: usage-based free tiers)

Exotel/Plivo bill per-minute + number rental; Vapi bills per-minute; Sarvam/
Azure per-character/second. All usage-based — no idle cost between demos. Keep
`maxDurationSeconds` capped (600s) so a stuck call can't run up a bill.
