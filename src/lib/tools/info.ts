import type { Pool } from "pg";
import { normalizeToE164 } from "../phone";
import type { ClinicInfoInput, RequestCallbackInput } from "./schemas";
import { fail, type ToolResult } from "./shared";

export interface ClinicInfo {
  clinic_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  doctors: Array<{
    doctor_id: string;
    name: string;
    specialty: string | null;
    consultation_fee_inr: number | null;
  }>;
  /** weekday 0 = Sunday, sessions in clinic-local HH:MM */
  timings: Array<{ weekday: number; sessions: Array<{ start: string; end: string }> }>;
}

export async function getClinicInfo(pool: Pool, input: ClinicInfoInput): Promise<ToolResult<ClinicInfo>> {
  const clinic = await pool.query<{ id: string; name: string; address: string | null; phone: string | null }>(
    `select id, name, address, phone from public.clinics where id = $1`,
    [input.clinic_id],
  );
  const c = clinic.rows[0];
  if (!c) return fail("CLINIC_NOT_FOUND", "No clinic with that id.");

  const doctors = await pool.query<{
    id: string;
    name: string;
    specialty: string | null;
    consultation_fee_inr: number | null;
  }>(
    `select id, name, specialty, consultation_fee_inr
       from public.doctors where clinic_id = $1 and active order by name`,
    [input.clinic_id],
  );

  const timings = await pool.query<{ weekday: number; start_time: string; end_time: string }>(
    `select distinct st.weekday, st.start_time::text as start_time, st.end_time::text as end_time
       from public.schedule_templates st
       join public.doctors d on d.id = st.doctor_id
      where d.clinic_id = $1 and d.active
      order by st.weekday, start_time`,
    [input.clinic_id],
  );

  const byDay = new Map<number, Array<{ start: string; end: string }>>();
  for (const t of timings.rows) {
    const sessions = byDay.get(t.weekday) ?? [];
    sessions.push({ start: t.start_time.slice(0, 5), end: t.end_time.slice(0, 5) });
    byDay.set(t.weekday, sessions);
  }

  return {
    ok: true,
    data: {
      clinic_id: c.id,
      name: c.name,
      address: c.address,
      phone: c.phone,
      doctors: doctors.rows.map((d) => ({
        doctor_id: d.id,
        name: d.name,
        specialty: d.specialty,
        consultation_fee_inr: d.consultation_fee_inr,
      })),
      timings: [...byDay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([weekday, sessions]) => ({ weekday, sessions })),
    },
  };
}

export async function requestCallback(
  pool: Pool,
  input: RequestCallbackInput,
): Promise<ToolResult<{ callback_id: string }>> {
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizeToE164(input.phone);
    if (!phone) return fail("INVALID_PHONE", "Phone number could not be normalized — re-ask or omit it.");
  }
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.callback_requests (clinic_id, call_id, phone, name, reason)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.clinic_id, input.call_id ?? null, phone, input.name ?? null, input.reason],
  );
  const row = rows[0];
  if (!row) throw new Error("callback insert returned no row");
  return { ok: true, data: { callback_id: row.id } };
}
