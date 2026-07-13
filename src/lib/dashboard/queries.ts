import { getPool } from "../db";
import { slotLabel } from "../time";

/**
 * Read models for the clinic dashboard (§3: today's appointments, call log
 * with transcripts and outcomes, callback queue). Server-only. In production
 * these run under the authenticated Supabase user so RLS scopes rows; here
 * we scope explicitly by clinicId as well, so the query is safe regardless.
 */

export interface AppointmentView {
  id: string;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  label: string;
  slotStart: string;
  status: string;
  source: string;
}

export async function todaysAppointments(clinicId: string): Promise<AppointmentView[]> {
  const { rows } = await getPool().query(
    `select a.id, p.full_name as patient_name, p.phone as patient_phone,
            d.name as doctor_name, a.slot_start, a.status, a.source
       from public.appointments a
       join public.patients p on p.id = a.patient_id
       join public.doctors d on d.id = a.doctor_id
      where a.clinic_id = $1
        and a.slot_start >= date_trunc('day', now() at time zone 'Asia/Kolkata')
        and a.slot_start <  date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day'
      order by a.slot_start asc`,
    [clinicId],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    patientName: r.patient_name as string,
    patientPhone: r.patient_phone as string,
    doctorName: r.doctor_name as string,
    slotStart: (r.slot_start as Date).toISOString(),
    label: slotLabel(r.slot_start as Date),
    status: r.status as string,
    source: r.source as string,
  }));
}

export interface CallView {
  id: string;
  fromPhone: string | null;
  intent: string | null;
  outcome: string | null;
  language: string | null;
  startedAt: string;
  durationSec: number | null;
  turns: number;
}

export async function recentCalls(clinicId: string, limit = 50): Promise<CallView[]> {
  const { rows } = await getPool().query(
    `select id, from_phone, intent, outcome, language_detected, started_at, ended_at,
            jsonb_array_length(coalesce(transcript, '[]'::jsonb)) as turns
       from public.calls
      where clinic_id = $1
      order by started_at desc
      limit $2`,
    [clinicId, limit],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    fromPhone: (r.from_phone as string) ?? null,
    intent: (r.intent as string) ?? null,
    outcome: (r.outcome as string) ?? null,
    language: (r.language_detected as string) ?? null,
    startedAt: (r.started_at as Date).toISOString(),
    durationSec: r.ended_at ? Math.round(((r.ended_at as Date).getTime() - (r.started_at as Date).getTime()) / 1000) : null,
    turns: Number(r.turns ?? 0),
  }));
}

export interface TranscriptTurn {
  role?: string;
  text?: string;
  message?: string;
}

export async function callTranscript(clinicId: string, callId: string): Promise<TranscriptTurn[]> {
  const { rows } = await getPool().query<{ transcript: TranscriptTurn[] }>(
    `select transcript from public.calls where id = $1 and clinic_id = $2`,
    [callId, clinicId],
  );
  return rows[0]?.transcript ?? [];
}

export interface CallbackView {
  id: string;
  name: string | null;
  phone: string | null;
  reason: string | null;
  status: string;
  createdAt: string;
}

export async function openCallbacks(clinicId: string): Promise<CallbackView[]> {
  const { rows } = await getPool().query(
    `select id, name, phone, reason, status, created_at
       from public.callback_requests
      where clinic_id = $1 and status = 'open'
      order by created_at desc`,
    [clinicId],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    reason: (r.reason as string) ?? null,
    status: r.status as string,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export interface DashboardSummary {
  clinicId: string;
  clinicName: string;
  appointments: AppointmentView[];
  calls: CallView[];
  callbacks: CallbackView[];
}

export async function loadDashboard(clinicId: string): Promise<DashboardSummary | null> {
  const clinic = await getPool().query<{ id: string; name: string }>(
    `select id, name from public.clinics where id = $1`,
    [clinicId],
  );
  const c = clinic.rows[0];
  if (!c) return null;
  const [appointments, calls, callbacks] = await Promise.all([
    todaysAppointments(clinicId),
    recentCalls(clinicId),
    openCallbacks(clinicId),
  ]);
  return { clinicId: c.id, clinicName: c.name, appointments, calls, callbacks };
}
