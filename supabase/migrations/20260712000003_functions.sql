-- Vaani §5 — booking functions. §5 hard constraint: appointment writes
-- happen inside a transaction that re-checks slot availability. Each
-- function runs in its own transaction; the SELECT ... FOR UPDATE
-- serializes racing bookings on the same slot, and the partial unique
-- index (I6) backstops anything that slips through.

create or replace function public.create_booking(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_patient_id uuid,
  p_slot_start timestamptz,
  p_call_id uuid default null,
  p_source text default 'voice'
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
    -- caller tool must respond by offering alternatives from list_open_slots
    raise exception 'SLOT_TAKEN' using errcode = 'P0003';
  end if;

  update public.slots set status = 'booked' where id = v_slot.id;

  insert into public.appointments
    (clinic_id, doctor_id, patient_id, slot_id, slot_start, slot_end, status, source, call_id)
  values
    (p_clinic_id, p_doctor_id, p_patient_id, v_slot.id, v_slot.slot_start, v_slot.slot_end,
     'confirmed', p_source, p_call_id)
  returning * into v_appt;

  return v_appt;
end $$;

create or replace function public.cancel_booking(p_appointment_id uuid)
returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_appt public.appointments%rowtype;
begin
  update public.appointments
     set status = 'cancelled'
   where id = p_appointment_id and status = 'confirmed'
  returning * into v_appt;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND_OR_NOT_CONFIRMED' using errcode = 'P0002';
  end if;

  -- release the slot for rebooking
  update public.slots
     set status = 'open'
   where id = v_appt.slot_id and status = 'booked';

  return v_appt;
end $$;

-- Expand schedule_templates into concrete slots over a date range.
-- Idempotent: existing (doctor_id, slot_start) rows are left untouched.
create or replace function public.generate_slots(
  p_doctor_id uuid,
  p_from date,
  p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_day date;
  t record;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer := 0;
  v_tz constant text := 'Asia/Kolkata';
begin
  select clinic_id into v_clinic from public.doctors where id = p_doctor_id;
  if v_clinic is null then
    raise exception 'DOCTOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_day := p_from;
  while v_day <= p_to loop
    for t in
      select * from public.schedule_templates st
      where st.doctor_id = p_doctor_id
        and st.weekday = extract(dow from v_day)::smallint
        and (st.valid_from is null or v_day >= st.valid_from)
        and (st.valid_to is null or v_day <= st.valid_to)
    loop
      v_start := (v_day + t.start_time) at time zone v_tz;
      while v_start + make_interval(mins => t.slot_minutes)
            <= (v_day + t.end_time) at time zone v_tz loop
        v_end := v_start + make_interval(mins => t.slot_minutes);
        insert into public.slots (clinic_id, doctor_id, slot_start, slot_end)
        values (v_clinic, p_doctor_id, v_start, v_end)
        on conflict (doctor_id, slot_start) do nothing;
        if found then
          v_count := v_count + 1;
        end if;
        v_start := v_end;
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;

  return v_count;
end $$;
