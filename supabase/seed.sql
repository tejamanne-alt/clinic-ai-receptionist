-- Demo seed: one clinic, two doctors, weekday schedules, two weeks of slots.
-- Run after migrations: psql ... -f supabase/seed.sql (or supabase db reset).

insert into public.clinics (id, name, address, phone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Sri Venkateswara Clinic',
  'Ameerpet, Hyderabad',
  '+914040404040'
)
on conflict (id) do nothing;

insert into public.doctors (id, clinic_id, name, specialty, consultation_fee_inr)
values
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Dr. Ramesh', 'General Physician', 300),
  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   'Dr. Lakshmi', 'Pediatrician', 400)
on conflict (id) do nothing;

-- Mon–Sat: morning 10:00–13:00, evening 18:00–21:00, 15-minute slots.
insert into public.schedule_templates (doctor_id, weekday, start_time, end_time, slot_minutes)
select d.id, w.weekday, s.start_time, s.end_time, 15
from public.doctors d
cross join (values (1),(2),(3),(4),(5),(6)) as w(weekday)
cross join (values
  (time '10:00', time '13:00'),
  (time '18:00', time '21:00')
) as s(start_time, end_time)
where d.clinic_id = '00000000-0000-0000-0000-000000000001'
on conflict (doctor_id, weekday, start_time) do nothing;

select public.generate_slots(d.id, current_date, current_date + 13)
from public.doctors d
where d.clinic_id = '00000000-0000-0000-0000-000000000001';
