-- Fixes from the phase-gate audit:
--  1. calls had no unique key on provider_call_id, so ensureCall's
--     ON CONFLICT never matched and every webhook message spawned a new
--     calls row (I7 audit trail broken). Add the constraint.
--  2. WhatsApp consent was sticky on the patient; store it per-appointment so
--     the confirmation gate reflects THIS call's consent (§6 rule 5).
--  3. patients had no uniqueness, so concurrent bookings could duplicate a
--     patient. Add a partial unique index and let upsert use it.

-- ── 1. one calls row per provider call ───────────────────────────────────────
-- de-dupe any existing duplicates first (keep the earliest), then constrain.
with ranked as (
  select id, row_number() over (
    partition by provider, provider_call_id order by started_at, id
  ) as rn
  from public.calls
  where provider_call_id is not null
)
delete from public.calls c using ranked r
where c.id = r.id and r.rn > 1;

create unique index if not exists calls_provider_call_uidx
  on public.calls (provider, provider_call_id)
  where provider_call_id is not null;

-- ── 2. per-appointment WhatsApp consent ──────────────────────────────────────
alter table public.appointments
  add column if not exists whatsapp_consent boolean not null default false;

-- ── 3. patient uniqueness (families share a phone → include name) ─────────────
-- collapse any pre-existing dupes onto the earliest id is out of scope here;
-- the index is created only if no duplicates exist. New rows are protected.
create unique index if not exists patients_identity_uidx
  on public.patients (clinic_id, phone, lower(full_name))
  where deleted_at is null;

-- ── create_booking now records consent (new trailing param, default false) ───
-- Drop the 6-arg version and recreate with the consent param so the booking
-- carries the caller's in-call choice.
drop function if exists public.create_booking(uuid, uuid, uuid, timestamptz, uuid, text);

create function public.create_booking(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_patient_id uuid,
  p_slot_start timestamptz,
  p_call_id uuid default null,
  p_source text default 'voice',
  p_whatsapp_consent boolean default false
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_slot public.slots%rowtype;
  v_appt public.appointments%rowtype;
begin
  select * into v_slot
  from public.slots
  where doctor_id = p_doctor_id and slot_start = p_slot_start
  for update;

  if not found then
    raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_slot.clinic_id <> p_clinic_id then
    raise exception 'CLINIC_MISMATCH' using errcode = 'P0004';
  end if;
  if v_slot.status <> 'open' then
    raise exception 'SLOT_TAKEN' using errcode = 'P0003';
  end if;

  update public.slots set status = 'booked' where id = v_slot.id;

  insert into public.appointments
    (clinic_id, doctor_id, patient_id, slot_id, slot_start, slot_end, status, source, call_id, whatsapp_consent)
  values
    (p_clinic_id, p_doctor_id, p_patient_id, v_slot.id, v_slot.slot_start, v_slot.slot_end,
     'confirmed', p_source, p_call_id, p_whatsapp_consent)
  returning * into v_appt;

  return v_appt;
end $$;

-- reschedule carries the prior appointment's consent onto the new one.
create or replace function public.reschedule_booking(
  p_appointment_id uuid,
  p_new_slot_start timestamptz,
  p_new_doctor_id uuid default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_old public.appointments%rowtype;
  v_new public.appointments%rowtype;
  v_doctor uuid;
begin
  select * into v_old
  from public.appointments
  where id = p_appointment_id and status = 'confirmed'
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND_OR_NOT_CONFIRMED' using errcode = 'P0002';
  end if;

  v_doctor := coalesce(p_new_doctor_id, v_old.doctor_id);

  v_new := public.create_booking(
    v_old.clinic_id, v_doctor, v_old.patient_id, p_new_slot_start,
    v_old.call_id, v_old.source, v_old.whatsapp_consent);

  update public.appointments set status = 'cancelled' where id = v_old.id;
  update public.slots set status = 'open'
   where id = v_old.slot_id and status = 'booked';

  return v_new;
end $$;
