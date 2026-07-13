import { z } from "zod";

/**
 * I5: every tool input originates from caller speech relayed by the LLM —
 * untrusted, twice over. Schemas are .strict() (unknown keys rejected),
 * strings are length-capped, and phones are re-normalized server-side
 * regardless of what the model claims.
 */

const uuid = z.string().uuid();
const isoTimestamp = z.string().datetime({ offset: true });
const phoneRaw = z.string().trim().min(5).max(25);

export const findSlotsInput = z
  .object({
    clinic_id: uuid,
    doctor_id: uuid.optional(),
    /** search window start; defaults to now */
    from: isoTimestamp.optional(),
    /** search window end; defaults to +7 days */
    to: isoTimestamp.optional(),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export const createBookingInput = z
  .object({
    clinic_id: uuid,
    doctor_id: uuid,
    patient_name: z.string().trim().min(1).max(120),
    patient_phone: phoneRaw,
    slot_start: isoTimestamp,
    call_id: uuid.optional(),
    whatsapp_consent: z.boolean().default(false),
    /** §6 rule 4: must be true, set only after the caller's explicit yes
     * at CONFIRM_READBACK. The webhook rejects false/absent. */
    confirmed: z.boolean().default(false),
  })
  .strict();

export const cancelBookingInput = z
  .object({
    clinic_id: uuid,
    patient_phone: phoneRaw,
    doctor_id: uuid.optional(),
    /** disambiguates when the caller has several upcoming appointments */
    slot_start: isoTimestamp.optional(),
  })
  .strict();

export const rescheduleBookingInput = z
  .object({
    clinic_id: uuid,
    patient_phone: phoneRaw,
    new_slot_start: isoTimestamp,
    doctor_id: uuid.optional(),
    old_slot_start: isoTimestamp.optional(),
  })
  .strict();

export const clinicInfoInput = z.object({ clinic_id: uuid }).strict();

export const requestCallbackInput = z
  .object({
    clinic_id: uuid,
    phone: phoneRaw.optional(),
    name: z.string().trim().max(120).optional(),
    reason: z.string().trim().max(500).default("Caller requested a callback"),
    call_id: uuid.optional(),
  })
  .strict();

export type FindSlotsInput = z.infer<typeof findSlotsInput>;
export type CreateBookingInput = z.infer<typeof createBookingInput>;
export type CancelBookingInput = z.infer<typeof cancelBookingInput>;
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingInput>;
export type ClinicInfoInput = z.infer<typeof clinicInfoInput>;
export type RequestCallbackInput = z.infer<typeof requestCallbackInput>;
