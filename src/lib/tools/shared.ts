import type { Pool } from "pg";
import { slotLabel } from "../time";

/**
 * I1: tools are the only source of facts spoken to callers. Every result is
 * plain JSON traceable to a Postgres read; the voice layer phrases it but
 * may not amend it. ok:false results carry machine codes the call-flow
 * reacts to deterministically.
 */
export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; alternatives?: SlotOption[] };

export interface SlotOption {
  slot_start: string;
  slot_end: string;
  doctor_id: string;
  doctor_name: string;
  /** preformatted clinic-local label so the LLM never does date math (I1) */
  label: string;
}

export function fail(code: string, message: string, alternatives?: SlotOption[]): ToolResult<never> {
  return alternatives ? { ok: false, code, message, alternatives } : { ok: false, code, message };
}

interface SlotRow {
  slot_start: Date;
  slot_end: Date;
  doctor_id: string;
  doctor_name: string;
}

export function toSlotOption(row: SlotRow): SlotOption {
  return {
    slot_start: row.slot_start.toISOString(),
    slot_end: row.slot_end.toISOString(),
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name,
    label: slotLabel(row.slot_start),
  };
}

/** §6 rule 3: on conflict, offer the nearest alternatives *from the DB*. */
export async function nearestAlternatives(
  pool: Pool,
  clinicId: string,
  doctorId: string,
  wantedIso: string,
  limit = 2,
): Promise<SlotOption[]> {
  const { rows } = await pool.query<SlotRow>(
    `select s.slot_start, s.slot_end, s.doctor_id, d.name as doctor_name
       from public.slots s
       join public.doctors d on d.id = s.doctor_id
      where s.clinic_id = $1
        and s.doctor_id = $2
        and s.status = 'open'
        and s.slot_start > now()
      order by abs(extract(epoch from (s.slot_start - $3::timestamptz))) asc
      limit $4`,
    [clinicId, doctorId, wantedIso, limit],
  );
  return rows.map(toSlotOption);
}

/** Postgres raise-exception messages we convert into typed tool failures. */
export function pgErrorCode(err: unknown): string | null {
  // The double-book unique index (I6) raises SQLSTATE 23505 if a confirmed
  // appointment already exists for the slot even when slots.status lagged —
  // treat it as SLOT_TAKEN so the caller still gets alternatives (§6 rule 3).
  const pgCode = (err as { code?: string; constraint?: string } | null)?.code;
  if (pgCode === "23505" && (err as { constraint?: string }).constraint === "appointments_no_double_book") {
    return "SLOT_TAKEN";
  }
  if (err instanceof Error) {
    const m = /^(SLOT_TAKEN|SLOT_NOT_FOUND|CLINIC_MISMATCH|APPOINTMENT_NOT_FOUND_OR_NOT_CONFIRMED|DOCTOR_NOT_FOUND)/.exec(
      err.message,
    );
    return m?.[1] ?? null;
  }
  return null;
}
