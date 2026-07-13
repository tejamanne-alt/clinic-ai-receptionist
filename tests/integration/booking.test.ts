import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { executeTool } from "../../src/lib/tools";
import { createFixture, dropFixture, HAS_DB, makePool, nextPhone, type Fixture } from "./helpers";

/**
 * Phase 2 gate evidence (§7): double-book race under concurrency (I6),
 * conflict-alternative flow (§6 rule 3), cancellation, reschedule.
 * Runs against real Postgres; skipped only when DATABASE_URL is absent.
 */
describe.skipIf(!HAS_DB)("booking tools (integration)", () => {
  let pool: Pool;
  let fx: Fixture;

  beforeAll(async () => {
    pool = makePool();
    fx = await createFixture(pool);
  });
  afterAll(async () => {
    if (pool) {
      if (fx) await dropFixture(pool, fx);
      await pool.end();
    }
  });

  function bookingInput(slotStart: string, overrides: Record<string, unknown> = {}) {
    return {
      clinic_id: fx.clinicId,
      doctor_id: fx.doctorId,
      patient_name: "Race Tester",
      patient_phone: nextPhone(),
      slot_start: slotStart,
      confirmed: true,
      ...overrides,
    };
  }

  it("books the happy path and returns DB-sourced facts only", async () => {
    const slot = fx.slotStarts[0]!;
    const result = await executeTool("create_booking", bookingInput(slot), pool);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { doctor_name: string; consultation_fee_inr: number; slot_start: string };
      expect(data.doctor_name).toBe("Dr. Test Ramesh");
      expect(data.consultation_fee_inr).toBe(300);
      expect(new Date(data.slot_start).toISOString()).toBe(slot);
    }
    const slots = await pool.query(
      `select status from public.slots where doctor_id = $1 and slot_start = $2::timestamptz`,
      [fx.doctorId, slot],
    );
    expect(slots.rows[0]?.status).toBe("booked");
  });

  it("refuses to book without the explicit CONFIRM_READBACK yes (§6 rule 4)", async () => {
    const result = await executeTool(
      "create_booking",
      bookingInput(fx.slotStarts[1]!, { confirmed: false }),
      pool,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFIRM_REQUIRED");
  });

  it("survives a 12-way double-book race: exactly one winner (I6)", async () => {
    const slot = fx.slotStarts[2]!;
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        executeTool("create_booking", bookingInput(slot, { patient_name: `Racer ${i}` }), pool),
      ),
    );
    const winners = attempts.filter((r) => r.ok);
    const losers = attempts.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(11);
    for (const l of losers) {
      if (!l.ok) expect(l.code).toBe("SLOT_TAKEN");
    }
    const confirmed = await pool.query(
      `select count(*)::int as n from public.appointments
        where doctor_id = $1 and slot_start = $2::timestamptz and status = 'confirmed'`,
      [fx.doctorId, slot],
    );
    expect(confirmed.rows[0]?.n).toBe(1);
  });

  it("offers exactly the nearest 2 DB alternatives on conflict (§6 rule 3)", async () => {
    const takenSlot = fx.slotStarts[2]!; // booked by the race test
    const result = await executeTool("create_booking", bookingInput(takenSlot), pool);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SLOT_TAKEN");
      expect(result.alternatives).toBeDefined();
      expect(result.alternatives!.length).toBeLessThanOrEqual(2);
      expect(result.alternatives!.length).toBeGreaterThan(0);
      for (const alt of result.alternatives!) {
        // every alternative must be a real open slot in the DB — never invented
        const check = await pool.query(
          `select status from public.slots where doctor_id = $1 and slot_start = $2::timestamptz`,
          [alt.doctor_id, alt.slot_start],
        );
        expect(check.rows[0]?.status).toBe("open");
        expect(alt.label.length).toBeGreaterThan(5);
      }
    }
  });

  it("cancels by phone and reopens the slot", async () => {
    const slot = fx.slotStarts[3]!;
    const phone = nextPhone();
    const booked = await executeTool("create_booking", bookingInput(slot, { patient_phone: phone }), pool);
    expect(booked.ok).toBe(true);

    const cancelled = await executeTool(
      "cancel_booking",
      { clinic_id: fx.clinicId, patient_phone: phone },
      pool,
    );
    expect(cancelled.ok).toBe(true);

    const slotRow = await pool.query(
      `select status from public.slots where doctor_id = $1 and slot_start = $2::timestamptz`,
      [fx.doctorId, slot],
    );
    expect(slotRow.rows[0]?.status).toBe("open");
  });

  it("reschedules atomically and keeps the old booking if the new slot is taken", async () => {
    const oldSlot = fx.slotStarts[4]!;
    const freeSlot = fx.slotStarts[5]!;
    const phone = nextPhone();
    const booked = await executeTool("create_booking", bookingInput(oldSlot, { patient_phone: phone }), pool);
    expect(booked.ok).toBe(true);

    // reschedule onto the slot the race test already booked → must fail whole
    const takenSlot = fx.slotStarts[2]!;
    const failed = await executeTool(
      "reschedule_booking",
      { clinic_id: fx.clinicId, patient_phone: phone, new_slot_start: takenSlot },
      pool,
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe("SLOT_TAKEN");
      expect(failed.alternatives).toBeDefined();
    }
    const oldStill = await pool.query(
      `select status from public.appointments where doctor_id = $1 and slot_start = $2::timestamptz`,
      [fx.doctorId, oldSlot],
    );
    expect(oldStill.rows[0]?.status).toBe("confirmed");

    // now to a genuinely free slot → old cancelled, new confirmed
    const moved = await executeTool(
      "reschedule_booking",
      { clinic_id: fx.clinicId, patient_phone: phone, new_slot_start: freeSlot },
      pool,
    );
    expect(moved.ok).toBe(true);

    const states = await pool.query(
      `select slot_start, status from public.appointments a
        join public.patients p on p.id = a.patient_id
       where p.phone = '+91' || $1 and a.clinic_id = $2 order by a.created_at`,
      [phone, fx.clinicId],
    );
    expect(states.rows.map((r: { status: string }) => r.status).sort()).toEqual(["cancelled", "confirmed"]);
    const freed = await pool.query(
      `select status from public.slots where doctor_id = $1 and slot_start = $2::timestamptz`,
      [fx.doctorId, oldSlot],
    );
    expect(freed.rows[0]?.status).toBe("open");
  });

  it("returns MULTIPLE_MATCHES when the phone has several upcoming bookings", async () => {
    const phone = nextPhone();
    // doctor B's mirrored slots are all open — book two of them
    const a = await executeTool(
      "create_booking",
      bookingInput(fx.slotStarts[0]!, { doctor_id: fx.doctorBId, patient_phone: phone }),
      pool,
    );
    const b = await executeTool(
      "create_booking",
      bookingInput(fx.slotStarts[1]!, { doctor_id: fx.doctorBId, patient_phone: phone }),
      pool,
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const ambiguous = await executeTool("cancel_booking", { clinic_id: fx.clinicId, patient_phone: phone }, pool);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.code).toBe("MULTIPLE_MATCHES");

    const specific = await executeTool(
      "cancel_booking",
      { clinic_id: fx.clinicId, patient_phone: phone, slot_start: fx.slotStarts[0]! },
      pool,
    );
    expect(specific.ok).toBe(true);
  });

  it("find_slots returns only open slots in ascending order", async () => {
    const result = await executeTool(
      "find_slots",
      { clinic_id: fx.clinicId, doctor_id: fx.doctorId, limit: 20 },
      pool,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { slots } = result.data as { slots: Array<{ slot_start: string }> };
      expect(slots.length).toBeGreaterThan(0);
      const starts = slots.map((s) => s.slot_start);
      expect([...starts].sort()).toEqual(starts);
      // the raced/booked slot must not appear
      expect(starts).not.toContain(fx.slotStarts[2]!);
    }
  });

  it("get_clinic_info reports doctors, fees, and timings from the DB", async () => {
    const result = await executeTool("get_clinic_info", { clinic_id: fx.clinicId }, pool);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const info = result.data as {
        name: string;
        doctors: Array<{ name: string; consultation_fee_inr: number | null }>;
      };
      expect(info.doctors).toHaveLength(2);
      expect(info.doctors.map((d) => d.consultation_fee_inr).sort()).toEqual([300, 400]);
    }
  });

  it("logs a callback request (SILENCE / ESCALATE path)", async () => {
    const result = await executeTool(
      "request_callback",
      { clinic_id: fx.clinicId, phone: nextPhone(), name: "Silent Caller", reason: "silence timeout" },
      pool,
    );
    expect(result.ok).toBe(true);
    const rows = await pool.query(
      `select status from public.callback_requests where clinic_id = $1`,
      [fx.clinicId],
    );
    expect(rows.rows[0]?.status).toBe("open");
  });
});
