-- Vaani §5 data contract — core schema.
-- Targets Supabase Postgres (auth.users exists; pgcrypto for gen_random_uuid).

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── clinics ────────────────────────────────────────────────────────────────
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  -- E.164 enforced at the edge (§5); the check is a backstop
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  languages text[] not null default array['te','en'],
  whatsapp_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clinics_updated_at before update on public.clinics
  for each row execute function public.set_updated_at();

-- Staff ↔ clinic mapping that RLS policies key off (supports §5 "clinic
-- staff see only their own clinic's rows"). Not one of the ten §5 tables,
-- but required to express the rule against Supabase auth.
create table public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

-- ── doctors ────────────────────────────────────────────────────────────────
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  specialty text,
  -- I1: the fee spoken to callers comes from here via a tool, never the LLM
  consultation_fee_inr integer check (consultation_fee_inr >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index doctors_clinic_idx on public.doctors (clinic_id);
create trigger doctors_updated_at before update on public.doctors
  for each row execute function public.set_updated_at();

-- ── schedule_templates ─────────────────────────────────────────────────────
create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday (matches extract(dow …))
  start_time time not null,
  end_time time not null,
  slot_minutes smallint not null default 15 check (slot_minutes between 5 and 120),
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (doctor_id, weekday, start_time)
);

-- ── slots ──────────────────────────────────────────────────────────────────
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'open' check (status in ('open','booked','blocked')),
  created_at timestamptz not null default now(),
  check (slot_end > slot_start),
  unique (doctor_id, slot_start)
);
create index slots_lookup_idx on public.slots (doctor_id, status, slot_start);

-- ── patients ───────────────────────────────────────────────────────────────
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  full_name text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  preferred_language text check (preferred_language in ('te','en','mix')),
  whatsapp_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- I7 / DPDP: deletable on clinic request — soft delete now, purge job later
  deleted_at timestamptz
);
create index patients_clinic_phone_idx on public.patients (clinic_id, phone);
create trigger patients_updated_at before update on public.patients
  for each row execute function public.set_updated_at();

-- ── calls ──────────────────────────────────────────────────────────────────
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  provider text,                       -- vapi | retell
  provider_call_id text,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  from_phone text,
  to_phone text,
  language_detected text check (language_detected in ('te','en','mix')),
  intent text check (intent in ('BOOK','RESCHEDULE','CANCEL','INFO','FALLBACK')),
  outcome text check (outcome in (
    'booked','rescheduled','cancelled','info_given',
    'callback_requested','abandoned','escalated','failed')),
  transcript jsonb not null default '[]'::jsonb,  -- [{role, text, ts, lang}]
  whatsapp_consent boolean,            -- §6 rule 5: consent captured in-call
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index calls_clinic_started_idx on public.calls (clinic_id, started_at desc);

-- ── appointments ───────────────────────────────────────────────────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  slot_id uuid references public.slots(id) on delete set null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','cancelled','completed','no_show')),
  source text not null default 'voice' check (source in ('voice','dashboard','manual')),
  call_id uuid references public.calls(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start)
);
-- I6: the double-booking backstop. §5 hard constraint — never rely on prompts.
create unique index appointments_no_double_book
  on public.appointments (doctor_id, slot_start)
  where status = 'confirmed';
create index appointments_clinic_day_idx on public.appointments (clinic_id, slot_start);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- ── call_events ────────────────────────────────────────────────────────────
-- I7: append-only audit trail — state changes, tool calls/results, STT/TTS
-- timings (R4 latency evidence), barge-ins, escalations, errors.
create table public.call_events (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  ts timestamptz not null default now(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  latency_ms integer
);
create index call_events_call_idx on public.call_events (call_id, ts);

-- ── messages ───────────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  call_id uuid references public.calls(id) on delete set null,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  provider text,                       -- gupshup | msg91
  provider_message_id text,
  to_phone text not null check (to_phone ~ '^\+[1-9][0-9]{6,14}$'),
  template_name text,
  body text,
  consent_verified boolean not null default false,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- §6 rule 5 as a DB rule: nothing leaves without recorded consent
  constraint messages_consent_before_send
    check (status not in ('sent','delivered') or consent_verified)
);
create index messages_clinic_idx on public.messages (clinic_id, created_at desc);

-- ── callback_requests ──────────────────────────────────────────────────────
create table public.callback_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  name text,
  reason text,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index callback_requests_clinic_status_idx
  on public.callback_requests (clinic_id, status, created_at desc);
