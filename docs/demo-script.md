# 90-second demo script (§7 Phase 3)

The mission demo: a cold caller books end-to-end, survives interruption,
silence, and a slot conflict; the booking hits the dashboard; WhatsApp lands.

## Setup (before recording)

1. `bash scripts/db/setup-local.sh` (or point at Supabase) — fresh seed data.
2. Ensure one popular slot is already taken so the conflict path triggers
   (book it from the dashboard or `create_booking`).
3. Open `/dashboard` on a second screen.
4. Phone ready for the WhatsApp confirmation (real number, consent = yes).

## Script (record the call + both screens)

| t | Caller (Telugu/Tenglish) | Vaani should | Proves |
|---|---|---|---|
| 0:00 | *(dials)* | "నమస్తే, [clinic]! Appointment బుక్ చేయాలా?" | greeting names clinic (rule 1) |
| 0:08 | "Ramesh garu appointment kavali repu morning" | asks / confirms doctor, then finds slots | slot-fill order, tools (I1) |
| 0:20 | *(interrupts mid-sentence)* "ah, 11 gantalaki" | TTS halts, takes the correction | barge-in (rule 9) |
| 0:30 | picks the taken slot | "ఆ time లేదు — ఇవి ఉన్నాయి…" offers 2 alts | conflict → real alternatives (rule 3) |
| 0:40 | "second one sare" | asks name | — |
| 0:48 | "Suresh" | asks phone | — |
| 0:55 | "98491 23456" | reads back "98 49 12 34 56", asks confirm | digit pairs, readback (rules 2,4) |
| 1:05 | *(goes silent ~5s)* | reprompts once | silence (rule 6) |
| 1:12 | "avunu correct" | asks WhatsApp consent | consent gate (rule 5) |
| 1:18 | "yes pampandi" | books, confirms date/time/doctor | deterministic booking (I6) |
| 1:25 | — | *(dashboard row appears; WhatsApp arrives)* | mission DoD |

## Bonus takes (keep clips)

- Clinical guardrail: "jwaram ga undi, medicine cheppandi" → deflects (I4).
- Escalation: mumble twice → menu → third fail → callback promise (rule 7).
- Resiliency: kill Sarvam key mid-demo → Azure fallback + honest apology (§8).

## Capture checklist

- [ ] 90s call recording
- [ ] dashboard screenshot with the new booking + call log outcome
- [ ] WhatsApp confirmation screenshot
- [ ] `pnpm tsx scripts/audit/latency-report.ts` regenerated for this call
- [ ] `bash scripts/audit/key-exposure.sh` green
