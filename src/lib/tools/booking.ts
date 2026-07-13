import type { Pool } from "pg";
import { normalizeToE164 } from "../phone";
import { slotLabel } from "../time";
import type {
  CancelBookingInput,
  CreateBookingInput,
  FindSlotsInput,
  RescheduleBookingInput,
} from "./schemas";
import { fail, nearestAlternatives, pgErrorCode, toSlotOption, type SlotOption, type ToolResult } from "./shared";

interface AppointmentRow {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  slot_id: string | null;
  slot_start: Date;
  slot_end: Date;
  status: string;
}

export interface BookingData {
  appointment_id: string;
  doctor_id: string;
  doctor_name: string;
  consultation_fee_inr: number | null;
  patient_name: string;
  patient_phone: string;
  slot_start: string;
  slot_end: string;
  label: string;
}

export async function findSlots(pool: Pool, input: FindSlotsInput): Promise<ToolResult<{ slots: SlotOption[] }>> {
  const params: unknown[] = [input.clinic_id];
  let where = "s.clinic_id = $1 and s.status = 'open' and s.slot_start >= coalesce($2::timestamptz, now())";
  params.push(input.from ?? null);
  where += " and s.slot_start <= coalesce($3::timestamptz, now() + interval '7 days')";
  params.push(input.to ?? null);
  if (input.doctor_id) {
    params.push(input.doctor_id);
    where += ` and s.doctor_id = $${params.length}`;
  }
  params.push(input.limit);
  const { rows } = await pool.query(
    `select s.slot_start, s.slot_end, s.doctor_id, d.name as doctor_name
       from public.slots s
       join public.doctors d on d.id = s.doctor_id and d.active
      where ${where}
      order by s.slot_start asc
      limit $${params.length}`,
    params,
  );
  return { ok: true, data: { slots: rows.map(toSlotOption) } };
}

/** Find-or-create the patient by clinic+phone+name (families share phones). */
async function upsertPatient(
  pool: Pool,
  clinicId: string,
  name: string,
  phone: string,
  whatsappConsent: boolean,
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `select id from public.patients
      where clinic_id = $1 and phone = $2 and lower(full_name) = lower($3) and deleted_at is null
      limit 1`,
    [clinicId, phone, name],
  );
  const found = existing.rows[0];
  if (found) {
    if (whatsappConsent) {
      await pool.query(`update public.patients set whatsapp_consent = true where id = $1`, [found.id]);
    }
    return found.id;
  }
  const inserted = await pool.query<{ id: string }>(
    `insert into public.patients (clinic_id, full_name, phone, whatsapp_consent)
     values ($1, $2, $3, $4) returning id`,
    [clinicId, name, phone, whatsappConsent],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("patient insert returned no row");
  return row.id;
}

export async function createBooking(pool: Pool, input: CreateBookingInput): Promise<ToolResult<BookingData>> {
  const phone = normalizeToE164(input.patient_phone);
  if (!phone) {
    return fail("INVALID_PHONE", "Phone number could not be normalized to E.164 — re-ask the caller digit by digit.");
  }
  if (!input.confirmed) {
    // §6 rule 4: explicit yes at CONFIRM_READBACK before any write.
    return fail(
      "CONFIRM_REQUIRED",
      "Read back name, doctor, date and time, get an explicit yes, then call again with confirmed=true.",
    );
  }

  const doctor = await pool.query<{ name: string; consultation_fee_inr: number | null }>(
    `select name, consultation_fee_inr from public.doctors where id = $1 and clinic_id = $2 and active`,
    [input.doctor_id, input.clinic_id],
  );
  const doc = doctor.rows[0];
  if (!doc) return fail("DOCTOR_NOT_FOUND", "No active doctor with that id at this clinic.");

  const patientId = await upsertPatient(pool, input.clinic_id, input.patient_name, phone, input.whatsapp_consent);

  try {
    const { rows } = await pool.query<AppointmentRow>(
      `select * from public.create_booking($1, $2, $3, $4::timestamptz, $5, 'voice')`,
      [input.clinic_id, input.doctor_id, patientId, input.slot_start, input.call_id ?? null],
    );
    const appt = rows[0];
    if (!appt) throw new Error("create_booking returned no row");
    return {
      ok: true,
      data: {
        appointment_id: appt.id,
        doctor_id: input.doctor_id,
        doctor_name: doc.name,
        consultation_fee_inr: doc.consultation_fee_inr,
        patient_name: input.patient_name,
        patient_phone: phone,
        slot_start: appt.slot_start.toISOString(),
        slot_end: appt.slot_end.toISOString(),
        label: slotLabel(appt.slot_start),
      },
    };
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === "SLOT_TAKEN" || code === "SLOT_NOT_FOUND") {
      const alternatives = await nearestAlternatives(pool, input.clinic_id, input.doctor_id, input.slot_start);
      return fail(code, "That slot is not available. Offer exactly these alternatives.", alternatives);
    }
    throw err;
  }
}

interface CandidateRow extends AppointmentRow {
  doctor_name: string;
  patient_name: string;
}

async function findConfirmedAppointments(
  pool: Pool,
  clinicId: string,
  phone: string,
  doctorId?: string,
  slotStart?: string,
): Promise<CandidateRow[]> {
  const params: unknown[] = [clinicId, phone];
  let where = `a.clinic_id = $1 and p.phone = $2 and a.status = 'confirmed' and a.slot_start > now()`;
  if (doctorId) {
    params.push(doctorId);
    where += ` and a.doctor_id = $${params.length}`;
  }
  if (slotStart) {
    params.push(slotStart);
    where += ` and a.slot_start = $${params.length}::timestamptz`;
  }
  const { rows } = await pool.query<CandidateRow>(
    `select a.*, d.name as doctor_name, p.full_name as patient_name
       from public.appointments a
       join public.patients p on p.id = a.patient_id
       join public.doctors d on d.id = a.doctor_id
      where ${where}
      order by a.slot_start asc`,
    params,
  );
  return rows;
}

function describeCandidates(rows: CandidateRow[]): Array<{ slot_start: string; doctor_name: string; label: string }> {
  return rows.map((r) => ({
    slot_start: r.slot_start.toISOString(),
    doctor_name: r.doctor_name,
    label: slotLabel(r.slot_start),
  }));
}

export async function cancelBooking(
  pool: Pool,
  input: CancelBookingInput,
): Promise<ToolResult<{ cancelled: true; doctor_name: string; label: string }>> {
  const phone = normalizeToE164(input.patient_phone);
  if (!phone) return fail("INVALID_PHONE", "Phone number could not be normalized — re-ask the caller.");

  const candidates = await findConfirmedAppointments(pool, input.clinic_id, phone, input.doctor_id, input.slot_start);
  if (candidates.length === 0) {
    return fail("APPOINTMENT_NOT_FOUND", "No upcoming confirmed appointment for that phone number.");
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      code: "MULTIPLE_MATCHES",
      message: `Found ${candidates.length} upcoming appointments — ask which one: ${JSON.stringify(describeCandidates(candidates))}`,
    };
  }
  const target = candidates[0];
  if (!target) return fail("APPOINTMENT_NOT_FOUND", "No upcoming confirmed appointment for that phone number.");

  await pool.query(`select public.cancel_booking($1)`, [target.id]);
  return {
    ok: true,
    data: { cancelled: true, doctor_name: target.doctor_name, label: slotLabel(target.slot_start) },
  };
}

export async function rescheduleBooking(
  pool: Pool,
  input: RescheduleBookingInput,
): Promise<ToolResult<BookingData>> {
  const phone = normalizeToE164(input.patient_phone);
  if (!phone) return fail("INVALID_PHONE", "Phone number could not be normalized — re-ask the caller.");

  const candidates = await findConfirmedAppointments(
    pool,
    input.clinic_id,
    phone,
    input.doctor_id,
    input.old_slot_start,
  );
  if (candidates.length === 0) {
    return fail("APPOINTMENT_NOT_FOUND", "No upcoming confirmed appointment for that phone number.");
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      code: "MULTIPLE_MATCHES",
      message: `Found ${candidates.length} upcoming appointments — ask which one: ${JSON.stringify(describeCandidates(candidates))}`,
    };
  }
  const target = candidates[0];
  if (!target) return fail("APPOINTMENT_NOT_FOUND", "No upcoming confirmed appointment for that phone number.");

  try {
    const { rows } = await pool.query<AppointmentRow>(
      `select * from public.reschedule_booking($1, $2::timestamptz, $3)`,
      [target.id, input.new_slot_start, input.doctor_id ?? null],
    );
    const appt = rows[0];
    if (!appt) throw new Error("reschedule_booking returned no row");
    const doctor = await pool.query<{ name: string; consultation_fee_inr: number | null }>(
      `select name, consultation_fee_inr from public.doctors where id = $1`,
      [appt.doctor_id],
    );
    return {
      ok: true,
      data: {
        appointment_id: appt.id,
        doctor_id: appt.doctor_id,
        doctor_name: doctor.rows[0]?.name ?? "",
        consultation_fee_inr: doctor.rows[0]?.consultation_fee_inr ?? null,
        patient_name: target.patient_name,
        patient_phone: phone,
        slot_start: appt.slot_start.toISOString(),
        slot_end: appt.slot_end.toISOString(),
        label: slotLabel(appt.slot_start),
      },
    };
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === "SLOT_TAKEN" || code === "SLOT_NOT_FOUND") {
      const alternatives = await nearestAlternatives(
        pool,
        input.clinic_id,
        input.doctor_id ?? target.doctor_id,
        input.new_slot_start,
      );
      return fail(code, "That new slot is not available. Offer exactly these alternatives.", alternatives);
    }
    throw err;
  }
}
