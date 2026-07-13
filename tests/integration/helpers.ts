import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * Integration-test fixtures against real Postgres (DATABASE_URL).
 * Each suite creates its own clinic/doctor/slots so runs never collide and
 * no teardown is required for correctness (fixtures are still cleaned up).
 */

export const HAS_DB = Boolean(process.env.DATABASE_URL);

export function makePool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}

export interface Fixture {
  clinicId: string;
  doctorId: string;
  doctorBId: string;
  /** open slots, ascending, 30 min apart starting tomorrow 10:00 UTC */
  slotStarts: string[];
}

export async function createFixture(pool: Pool, slotCount = 6): Promise<Fixture> {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const doctorBId = randomUUID();

  await pool.query(`insert into public.clinics (id, name, address, phone) values ($1, $2, $3, $4)`, [
    clinicId,
    `Test Clinic ${clinicId.slice(0, 8)}`,
    "Test Street, Hyderabad",
    "+914012345678",
  ]);
  await pool.query(
    `insert into public.doctors (id, clinic_id, name, specialty, consultation_fee_inr)
     values ($1, $3, 'Dr. Test Ramesh', 'General Physician', 300),
            ($2, $3, 'Dr. Test Lakshmi', 'Pediatrician', 400)`,
    [doctorId, doctorBId, clinicId],
  );

  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 1);
  base.setUTCHours(10, 0, 0, 0);

  const slotStarts: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    const start = new Date(base.getTime() + i * 30 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    slotStarts.push(start.toISOString());
    await pool.query(
      `insert into public.slots (clinic_id, doctor_id, slot_start, slot_end) values ($1, $2, $3, $4)`,
      [clinicId, doctorId, start.toISOString(), end.toISOString()],
    );
    // doctor B mirrors the same times so cross-doctor tests have material
    await pool.query(
      `insert into public.slots (clinic_id, doctor_id, slot_start, slot_end) values ($1, $2, $3, $4)`,
      [clinicId, doctorBId, start.toISOString(), end.toISOString()],
    );
  }
  return { clinicId, doctorId, doctorBId, slotStarts };
}

export async function dropFixture(pool: Pool, f: Fixture): Promise<void> {
  // clinics cascade to doctors/slots/patients/appointments/calls/etc.
  await pool.query(`delete from public.clinics where id = $1`, [f.clinicId]);
}

let phoneCounter = 7_000_000_000;
/** unique valid Indian mobile per call site */
export function nextPhone(): string {
  phoneCounter += 1;
  return `9${String(phoneCounter).slice(1)}`;
}
