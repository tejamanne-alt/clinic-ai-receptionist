import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { sendBookingConfirmation } from "../../src/lib/messaging/confirmation";
import type { MessagingProvider } from "../../src/lib/messaging/types";
import { executeTool } from "../../src/lib/tools";
import { createFixture, dropFixture, HAS_DB, makePool, nextPhone, type Fixture } from "./helpers";

/**
 * Phase 2 gate: WhatsApp confirmation is sent ONLY with in-call consent
 * (§6 rule 5, I7). Uses a spy provider so no external call is made; the
 * consent gate is enforced in code and, as a backstop, by the DB constraint.
 */
describe.skipIf(!HAS_DB)("WhatsApp confirmation consent gate (integration)", () => {
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

  function spyProvider(): MessagingProvider & { calls: number } {
    return {
      name: "spy",
      calls: 0,
      isConfigured: () => true,
      async send() {
        this.calls += 1;
        return { providerMessageId: "spy-1", status: "sent" as const };
      },
    };
  }

  async function book(consent: boolean, slotStart: string): Promise<string> {
    const res = await executeTool(
      "create_booking",
      {
        clinic_id: fx.clinicId,
        doctor_id: fx.doctorId,
        patient_name: "Consent Tester",
        patient_phone: nextPhone(),
        slot_start: slotStart,
        confirmed: true,
        whatsapp_consent: consent,
      },
      pool,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("booking failed in fixture");
    return (res.data as { appointment_id: string }).appointment_id;
  }

  it("sends when consent was given", async () => {
    const provider = spyProvider();
    const appointmentId = await book(true, fx.slotStarts[0]!);
    const outcome = await sendBookingConfirmation({ clinicId: fx.clinicId, appointmentId }, pool, provider);
    expect(outcome.sent).toBe(true);
    expect(provider.calls).toBe(1);

    const msg = await pool.query(`select status, consent_verified from public.messages where appointment_id = $1`, [
      appointmentId,
    ]);
    expect(msg.rows[0]?.status).toBe("sent");
    expect(msg.rows[0]?.consent_verified).toBe(true);
  });

  it("REFUSES to send without consent — no provider call, no message row", async () => {
    const provider = spyProvider();
    const appointmentId = await book(false, fx.slotStarts[1]!);
    const outcome = await sendBookingConfirmation({ clinicId: fx.clinicId, appointmentId }, pool, provider);
    expect(outcome).toEqual({ sent: false, reason: "no_consent" });
    expect(provider.calls).toBe(0);

    const msg = await pool.query(`select count(*)::int as n from public.messages where appointment_id = $1`, [
      appointmentId,
    ]);
    expect(msg.rows[0]?.n).toBe(0);
  });

  it("a RETURNING patient who declines on a later call is NOT messaged (consent is per-call, not sticky)", async () => {
    const provider = spyProvider();
    const phone = nextPhone();
    // call 1: same patient consents
    const first = await executeTool(
      "create_booking",
      {
        clinic_id: fx.clinicId,
        doctor_id: fx.doctorId,
        patient_name: "Sticky Consent",
        patient_phone: phone,
        slot_start: fx.slotStarts[3]!,
        confirmed: true,
        whatsapp_consent: true,
      },
      pool,
    );
    expect(first.ok).toBe(true);
    const firstId = first.ok ? (first.data as { appointment_id: string }).appointment_id : "";
    expect((await sendBookingConfirmation({ clinicId: fx.clinicId, appointmentId: firstId }, pool, provider)).sent).toBe(true);

    // call 2: SAME name+phone, now DECLINES
    const second = await executeTool(
      "create_booking",
      {
        clinic_id: fx.clinicId,
        doctor_id: fx.doctorId,
        patient_name: "Sticky Consent",
        patient_phone: phone,
        slot_start: fx.slotStarts[4]!,
        confirmed: true,
        whatsapp_consent: false,
      },
      pool,
    );
    expect(second.ok).toBe(true);
    const secondId = second.ok ? (second.data as { appointment_id: string }).appointment_id : "";
    const callsBefore = provider.calls;
    const outcome = await sendBookingConfirmation({ clinicId: fx.clinicId, appointmentId: secondId }, pool, provider);
    expect(outcome).toEqual({ sent: false, reason: "no_consent" });
    expect(provider.calls).toBe(callsBefore); // no new send
    // and the patient flag was downgraded to reflect the latest decline
    const patient = await pool.query(`select whatsapp_consent from public.patients where phone = $1`, [
      `+91${phone}`,
    ]);
    expect(patient.rows[0]?.whatsapp_consent).toBe(false);
  });

  it("the DB constraint backstops a send attempt without consent", async () => {
    // Directly attempt to insert a 'sent' message with consent false — the
    // messages_consent_before_send CHECK must reject it (defense in depth).
    await expect(
      pool.query(
        `insert into public.messages (clinic_id, to_phone, status, consent_verified)
         values ($1, '+919812345670', 'sent', false)`,
        [fx.clinicId],
      ),
    ).rejects.toThrow(/messages_consent_before_send|violates check constraint/);
  });

  it("marks the row failed when the provider throws, keeping the audit trail", async () => {
    const throwing: MessagingProvider = {
      name: "boom",
      isConfigured: () => true,
      send: vi.fn(async () => {
        throw new Error("gupshup 500");
      }),
    };
    const appointmentId = await book(true, fx.slotStarts[2]!);
    const outcome = await sendBookingConfirmation({ clinicId: fx.clinicId, appointmentId }, pool, throwing);
    expect(outcome.sent).toBe(false);
    if (!outcome.sent) expect(outcome.reason).toBe("send_failed");
    const msg = await pool.query(`select status from public.messages where appointment_id = $1`, [appointmentId]);
    expect(msg.rows[0]?.status).toBe("failed");
  });
});
