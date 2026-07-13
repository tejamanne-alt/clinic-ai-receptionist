# First-time setup

A staged guide: each stage ends with something you can verify. You can stop
after Stage 3 and have a fully working local system (booking core + dashboard +
tests); Stages 4–7 add external services one phase at a time and each needs a
provider account.

Time: ~15 min to Stage 3; each later stage is another 15–30 min depending on
account signups.

---

## Prerequisites

- **Node 20+** and **pnpm** (`npm install -g pnpm` or `corepack enable`)
- **git**
- A **Postgres 16** you can reach — Docker is the easiest (below). Only needed
  from Stage 3 on; Stage 2 runs without a database.

---

## Stage 1 — Get the code

```bash
git clone <your-repo-url> clinic-ai-receptionist
cd clinic-ai-receptionist
git checkout claude/clinic-ai-receptionist-zsrit9
pnpm install
cp .env.example .env
```

Leave `.env` mostly empty for now — every external key is optional until its
stage. **Never** put a secret in a `NEXT_PUBLIC_*` variable (a test enforces this).

---

## Stage 2 — Verify the code (no database needed)

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Unit tests run without a DB (the integration suites skip themselves). You should
see the unit tests green. This proves the install and the build are sound.

---

## Stage 3 — Database + full test suite + the app

### 3a. Start Postgres

**Docker (macOS / Windows / Linux — recommended):**
```bash
docker run -d --name vaani-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vaani \
  -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vaani
```

**Or a managed Supabase project (the production path):** create a project, then
```bash
# uses the Supabase CLI; auth schema + roles already exist there
supabase link --project-ref <ref>
supabase db push                       # applies supabase/migrations/*
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
export DATABASE_URL="<your supabase pooler connection string>"
```

### 3b. Apply schema + seed (Docker / self-managed Postgres)

```bash
pnpm db:setup      # reads $DATABASE_URL; creates the auth stub, runs
                   # migrations, seeds a demo clinic (2 doctors, 2 weeks of slots)
```

`db:setup` is idempotent — safe to re-run. (Skip this for Supabase; `db push`
already applied the migrations.)

### 3c. Run everything

```bash
pnpm test          # now 136 tests incl. the real-Postgres integration suite
pnpm dev           # http://localhost:3000
```

Open:
- **`/dashboard`** — today's appointments, call log, callback queue (seeded clinic)
- **`/call`** — the browser call page (shows "voice not configured" until Stage 5)
- **`/`** — status page

Add `pnpm test:ci` to CI — it fails loudly if `DATABASE_URL` is missing so the
integration tests can never be silently skipped.

**✅ You now have a working local system.** Everything below is optional and
adds one external service per stage.

---

## Stage 4 (Phase 0) — Speech bake-off  *(optional)*

Decides whether Sarvam or Azure is the default speech provider, scored on your
own recorded clips.

1. Get a key for at least one: **Sarvam** (free tier, sarvam.ai) → `SARVAM_API_KEY`;
   and/or **Azure Speech** (free F0 tier, region `centralindia`) → `AZURE_SPEECH_KEY`,
   `AZURE_SPEECH_REGION`. Put them in `.env`.
2. Record the 20 clips listed in `testdata/manifest.csv` (guide in
   `testdata/README.md`), drop the `.wav` files in `testdata/`, and correct each
   `reference_transcript` to what you actually said.
3. Run:
   ```bash
   pnpm bakeoff        # → reports/bakeoff-report.md (WER/CER, latency, suggested default)
   pnpm bakeoff:tts    # → reports/tts-samples/ WAVs to listen to
   ```

---

## Stage 5 (Phase 1) — Voice in the browser

Needs a **Vapi** account (vapi.ai).

1. Copy your keys into `.env`:
   ```
   VAPI_PRIVATE_KEY=...        # server-only
   VAPI_PUBLIC_KEY=...         # public — can only start calls
   VAPI_WEBHOOK_SECRET=...     # any strong random string; also set it in Vapi
   ```
2. Expose your local webhook so Vapi can reach it (tools run server-side):
   ```bash
   npx ngrok http 3000
   # copy the https URL into .env:
   #   PUBLIC_BASE_URL=https://<subdomain>.ngrok.app
   ```
3. Create the assistant from the prompt files + tools:
   ```bash
   pnpm vapi:sync             # prints an assistant id
   # put it in .env:  VAPI_ASSISTANT_ID=...
   ```
4. Restart `pnpm dev`, open **`/call`**, click **Start call**, and speak. The page
   streams the transcript and shows first-audio latency (target < 1.5s).

> **Human gate:** review `prompts/voice/callflow.te-en.md` (the bilingual script)
> for tone before you rely on it — it's marked *pending review*.

---

## Stage 6 (Phase 2) — WhatsApp confirmation

Without any WhatsApp key, bookings already work and confirmations are **logged to
the console** (consent is still recorded and gated). To send real messages:

1. Set up **Gupshup** (gupshup.io): approve a `booking_confirmation` template,
   then in `.env`:
   ```
   GUPSHUP_API_KEY=...
   GUPSHUP_APP_NAME=...
   GUPSHUP_SOURCE_NUMBER=...          # your WhatsApp business number, digits only
   WHATSAPP_TEMPLATE_NAME=booking_confirmation
   ```
2. Book through `/call` with WhatsApp consent = yes → the confirmation is sent to
   the caller's number. (Decline consent → nothing is sent; enforced in code and
   by a DB constraint.)

---

## Stage 7 (Phase 3) — Real phone number (PSTN)

Human-in-the-loop; full runbook in **`docs/telephony.md`**. In short: buy an
Exotel/Plivo number, point a SIP trunk at your Vapi number, attach the assistant.
Then follow **`docs/demo-script.md`** for the 90-second cold-call demo.

---

## Deploying (Vercel)

1. Import the repo in Vercel.
2. Add every `.env` value as a Vercel environment variable (server-side; only the
   `NEXT_PUBLIC_*` ones are exposed to the browser).
3. Point `PUBLIC_BASE_URL` and the Vapi webhook at your Vercel URL instead of ngrok.
4. Use a Supabase (or other managed) Postgres for `DATABASE_URL`.

---

## Troubleshooting

- **`DATABASE_URL is not set`** — export it (Stage 3a) before `pnpm test`/`pnpm dev`.
- **`psql: connection refused`** — the Postgres container isn't running: `docker start vaani-pg`.
- **`pnpm db:setup` says "psql client not found"** — install the client: macOS
  `brew install libpq && brew link --force libpq`; Debian `apt install postgresql-client`.
- **Integration tests skipped** — `DATABASE_URL` isn't set; they skip by design. Use
  `pnpm test:ci` to make that a hard failure.
- **`/call` shows "voice not configured"** — you haven't done Stage 5 (Vapi keys +
  `pnpm vapi:sync`).
- **Vapi tool calls do nothing** — `PUBLIC_BASE_URL` must be a public https URL
  reachable by Vapi (ngrok/Vercel), and the webhook path is `/api/vapi/webhook`.

See `BUILD_STATE.md` for exact per-phase gate status.
