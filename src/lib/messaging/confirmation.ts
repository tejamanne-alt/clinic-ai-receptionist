import type { Pool } from "pg";
import { getPool } from "../db";
import { slotLabel } from "../time";
import { selectProvider } from "./providers";
import type { MessagingProvider } from "./types";

/**
 * §6 rule 5 + I7, enforced in code AND in the DB: a WhatsApp confirmation is
 * sent ONLY with recorded in-call consent. The messages row is written with
 * consent_verified, and the DB check constraint (messages_consent_before_send)
 * refuses to mark it sent/delivered without it — a belt-and-braces guarantee
 * that a prompt or bug cannot message a patient who did not agree.
 */

export interface ConfirmationRequest {
  clinicId: string;
  appointmentId: string;
  callId?: string;
}

export type ConfirmationOutcome =
  | { sent: true; messageId: string; provider: string }
  | { sent: false; reason: "no_consent" | "not_found" | "send_failed"; detail?: string };

interface ApptRow {
  patient_id: string;
  patient_name: string;
  phone: string;
  /** consent recorded for THIS booking (§6 rule 5), not the sticky patient flag */
  whatsapp_consent: boolean;
  doctor_name: string;
  slot_start: Date;
  clinic_name: string;
}

export async function sendBookingConfirmation(
  req: ConfirmationRequest,
  pool: Pool = getPool(),
  provider: MessagingProvider = selectProvider(),
): Promise<ConfirmationOutcome> {
  const { rows } = await pool.query<ApptRow>(
    `select p.id as patient_id, p.full_name as patient_name, p.phone,
            a.whatsapp_consent,
            d.name as doctor_name, a.slot_start, c.name as clinic_name
       from public.appointments a
       join public.patients p on p.id = a.patient_id
       join public.doctors d on d.id = a.doctor_id
       join public.clinics c on c.id = a.clinic_id
      where a.id = $1 and a.clinic_id = $2 and a.status = 'confirmed'`,
    [req.appointmentId, req.clinicId],
  );
  const appt = rows[0];
  if (!appt) return { sent: false, reason: "not_found" };

  // The gate. No consent → no send, no message row marked sent.
  if (!appt.whatsapp_consent) {
    return { sent: false, reason: "no_consent" };
  }

  const label = slotLabel(appt.slot_start);
  const body = `Namaste ${appt.patient_name}, your appointment at ${appt.clinic_name} with ${appt.doctor_name} is confirmed for ${label}. Reply here to reschedule.`;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "booking_confirmation";

  // insert queued row first (audit even if the send throws). consent_verified
  // carries the real per-booking consent so the DB check constraint
  // (messages_consent_before_send) is a genuine backstop, not always-true.
  const inserted = await pool.query<{ id: string }>(
    `insert into public.messages
       (clinic_id, patient_id, appointment_id, call_id, provider, to_phone,
        template_name, body, consent_verified, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')
     returning id`,
    [
      req.clinicId,
      appt.patient_id,
      req.appointmentId,
      req.callId ?? null,
      provider.name,
      appt.phone,
      templateName,
      body,
      appt.whatsapp_consent,
    ],
  );
  const messageId = inserted.rows[0]?.id;
  if (!messageId) throw new Error("message insert returned no row");

  try {
    const result = await provider.send({
      toPhone: appt.phone,
      templateName,
      variables: [appt.patient_name, appt.clinic_name, appt.doctor_name, label],
      body,
    });
    await pool.query(
      `update public.messages set status = 'sent', provider_message_id = $2, sent_at = now() where id = $1`,
      [messageId, result.providerMessageId],
    );
    return { sent: true, messageId, provider: provider.name };
  } catch (err) {
    await pool.query(`update public.messages set status = 'failed' where id = $1`, [messageId]);
    return { sent: false, reason: "send_failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
