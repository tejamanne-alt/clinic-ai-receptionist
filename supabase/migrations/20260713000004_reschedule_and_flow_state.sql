-- Phase 2: atomic reschedule (§5: appointment writes inside a transaction
-- that re-checks availability) + per-call flow state for the §6 machine.

-- Books the new slot BEFORE releasing the old one: if the new slot is taken,
-- SLOT_TAKEN aborts the whole transaction and the old appointment survives.
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
    v_old.call_id, v_old.source);

  update public.appointments set status = 'cancelled' where id = v_old.id;
  update public.slots set status = 'open'
   where id = v_old.slot_id and status = 'booked';

  return v_new;
end $$;

-- Mirror of the deterministic call-flow machine state, updated by the
-- orchestrator webhook per turn (I7 auditability; lets the server refuse
-- tools that are illegal in the current state).
alter table public.calls add column if not exists flow_state jsonb;
