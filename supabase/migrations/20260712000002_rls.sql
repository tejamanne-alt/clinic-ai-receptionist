-- Vaani §5 — row-level security: clinic staff see only their own clinic's
-- rows. Server-side tools use the service role (bypasses RLS) and validate
-- clinic scope in code; dashboard users authenticate via Supabase auth.

-- security definer so policies on clinic_members don't recurse
create or replace function public.is_clinic_member(target_clinic uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = target_clinic and m.user_id = auth.uid()
  );
$$;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.doctors enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.slots enable row level security;
alter table public.patients enable row level security;
alter table public.calls enable row level security;
alter table public.appointments enable row level security;
alter table public.call_events enable row level security;
alter table public.messages enable row level security;
alter table public.callback_requests enable row level security;

-- clinics: members can read and update their own clinic; creation is an
-- onboarding (service-role) operation.
create policy clinics_select on public.clinics
  for select using (public.is_clinic_member(id));
create policy clinics_update on public.clinics
  for update using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));

-- clinic_members: users see their own memberships and fellow members.
create policy clinic_members_select on public.clinic_members
  for select using (user_id = auth.uid() or public.is_clinic_member(clinic_id));

-- clinic-scoped tables: full CRUD for members of that clinic.
create policy doctors_all on public.doctors
  for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy slots_all on public.slots
  for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy patients_all on public.patients
  for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy appointments_all on public.appointments
  for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));
create policy callback_requests_all on public.callback_requests
  for all using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

-- schedule_templates carry no clinic_id — scope via the owning doctor.
create policy schedule_templates_all on public.schedule_templates
  for all
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_id and public.is_clinic_member(d.clinic_id)))
  with check (exists (
    select 1 from public.doctors d
    where d.id = doctor_id and public.is_clinic_member(d.clinic_id)));

-- calls / call_events / messages: read-only in the dashboard; writes come
-- from the voice/messaging pipeline via service role (I7 audit integrity).
create policy calls_select on public.calls
  for select using (public.is_clinic_member(clinic_id));
create policy call_events_select on public.call_events
  for select using (exists (
    select 1 from public.calls c
    where c.id = call_id and public.is_clinic_member(c.clinic_id)));
create policy messages_select on public.messages
  for select using (public.is_clinic_member(clinic_id));
