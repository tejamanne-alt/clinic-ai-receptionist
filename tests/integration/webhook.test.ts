import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { handleVapiMessage, type VapiMessage } from "../../src/lib/vapi/webhook";
import { createFixture, dropFixture, HAS_DB, makePool, type Fixture } from "./helpers";

/**
 * Webhook against real Postgres: tool-calls execute deterministically, the
 * model-supplied clinic_id is overridden by trusted call metadata (I1), and
 * every tool call lands as a latency-stamped call_event (R4 / I7).
 */
describe.skipIf(!HAS_DB)("vapi webhook (integration)", () => {
  let pool: Pool;
  let fx: Fixture;
  const providerCallId = `vapi_${randomUUID()}`;

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

  function msg(overrides: Partial<VapiMessage>): VapiMessage {
    return {
      type: "tool-calls",
      call: { id: providerCallId, metadata: { clinicId: fx.clinicId } },
      ...overrides,
    };
  }

  it("creates the call row and runs find_slots, logging a latency event", async () => {
    const res = await handleVapiMessage(
      msg({
        toolCalls: [{ id: "tc1", function: { name: "find_slots", arguments: JSON.stringify({ limit: 5 }) } }],
      }),
      pool,
    );
    expect(res.status).toBe(200);
    const results = (res.body as { results: Array<{ result: string }> }).results;
    const parsed = JSON.parse(results[0]!.result) as { ok: boolean };
    expect(parsed.ok).toBe(true);

    const call = await pool.query(`select id from public.calls where provider_call_id = $1`, [providerCallId]);
    expect(call.rows).toHaveLength(1);
    const events = await pool.query(
      `select event_type, latency_ms from public.call_events where call_id = $1 and event_type = 'tool:find_slots'`,
      [call.rows[0]!.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("overrides a spoofed clinic_id with the trusted metadata one (I1)", async () => {
    const otherClinic = randomUUID();
    const res = await handleVapiMessage(
      msg({
        toolCalls: [
          {
            id: "tc2",
            // model tries to point the tool at a different clinic
            function: { name: "get_clinic_info", arguments: JSON.stringify({ clinic_id: otherClinic }) },
          },
        ],
      }),
      pool,
    );
    const parsed = JSON.parse((res.body as { results: Array<{ result: string }> }).results[0]!.result) as {
      ok: boolean;
      data?: { clinic_id: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.clinic_id).toBe(fx.clinicId); // NOT otherClinic
  });

  it("books through the webhook and stamps the appointment with the internal call_id", async () => {
    const res = await handleVapiMessage(
      msg({
        toolCalls: [
          {
            id: "tc3",
            function: {
              name: "create_booking",
              arguments: JSON.stringify({
                doctor_id: fx.doctorId,
                patient_name: "Webhook Caller",
                patient_phone: "9812345670",
                slot_start: fx.slotStarts[0],
                confirmed: true,
                whatsapp_consent: true,
              }),
            },
          },
        ],
      }),
      pool,
    );
    const parsed = JSON.parse((res.body as { results: Array<{ result: string }> }).results[0]!.result) as {
      ok: boolean;
      data?: { appointment_id: string };
    };
    expect(parsed.ok).toBe(true);

    const appt = await pool.query(
      `select a.call_id, c.provider_call_id from public.appointments a
         join public.calls c on c.id = a.call_id where a.id = $1`,
      [parsed.data!.appointment_id],
    );
    expect(appt.rows[0]!.provider_call_id).toBe(providerCallId);
  });

  it("persists transcript + outcome on end-of-call-report (I7)", async () => {
    await handleVapiMessage(
      {
        type: "end-of-call-report",
        call: { id: providerCallId, metadata: { clinicId: fx.clinicId } },
        endedReason: "customer-ended-call",
        artifact: { messages: [{ role: "assistant", message: "namaste" }] },
      } as VapiMessage,
      pool,
    );
    const call = await pool.query(
      `select outcome, ended_at, transcript from public.calls where provider_call_id = $1`,
      [providerCallId],
    );
    // This call booked earlier in the suite; the booking outcome must win over
    // the hangup reason (coalesce preserves 'booked' — a booked call is booked).
    expect(call.rows[0]!.outcome).toBe("booked");
    expect(call.rows[0]!.ended_at).not.toBeNull();
    expect(JSON.stringify(call.rows[0]!.transcript)).toContain("namaste");
  });

  it("ignores unknown message types without erroring", async () => {
    const res = await handleVapiMessage({ type: "hang" } as VapiMessage, pool);
    expect(res.status).toBe(200);
  });
});
