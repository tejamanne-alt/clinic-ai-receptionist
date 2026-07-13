import type { Pool } from "pg";
import { getPool } from "../db";
import { sendBookingConfirmation } from "../messaging/confirmation";
import { executeTool } from "../tools";

/**
 * Vapi server webhook handler (transport-agnostic so it is unit-testable
 * without Next). Handles the message types we rely on:
 *  - tool-calls / function-call: run the tool (I1/I5) and return results
 *  - status-update, end-of-call-report: persist call + transcript + events (I7)
 *  - transcript / speech events: latency + audit logging (R4)
 *
 * Every tool result is logged as a call_event with latency for the
 * outer-audit latency budget.
 */

export interface VapiToolCall {
  id: string;
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface VapiMessage {
  type: string;
  call?: { id?: string; metadata?: { clinicId?: string } };
  toolCalls?: VapiToolCall[];
  toolCallList?: VapiToolCall[];
  functionCall?: { name: string; parameters: Record<string, unknown> };
  status?: string;
  transcript?: unknown;
  endedReason?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function parseArgs(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return args ?? {};
}

interface ResolvedCall {
  internalId: string;
  clinicId: string;
}

/**
 * Idempotently resolve (and if needed create) the single calls row for a
 * provider call. Returns both the internal id and the authoritative clinic
 * id. The unique index calls_provider_call_uidx makes ON CONFLICT real, so a
 * call never spawns duplicate rows (I7). Returns null when no clinic can be
 * established — callers must fail closed rather than trust model input.
 */
async function ensureCall(pool: Pool, callId: string, clinicId: string | undefined, fromPhone?: string | null): Promise<ResolvedCall | null> {
  if (clinicId) {
    const upserted = await pool.query<{ id: string; clinic_id: string }>(
      `insert into public.calls (provider, provider_call_id, clinic_id, direction, from_phone)
       values ('vapi', $1, $2, 'inbound', $3)
       on conflict (provider, provider_call_id) where provider_call_id is not null
       do update set from_phone = coalesce(public.calls.from_phone, excluded.from_phone)
       returning id, clinic_id`,
      [callId, clinicId, fromPhone ?? null],
    );
    const row = upserted.rows[0];
    return row ? { internalId: row.id, clinicId: row.clinic_id } : null;
  }
  const found = await pool.query<{ id: string; clinic_id: string }>(
    `select id, clinic_id from public.calls where provider = 'vapi' and provider_call_id = $1 limit 1`,
    [callId],
  );
  const row = found.rows[0];
  return row ? { internalId: row.id, clinicId: row.clinic_id } : null;
}

async function logEvent(
  pool: Pool,
  internalCallId: string,
  eventType: string,
  payload: Record<string, unknown>,
  latencyMs?: number,
): Promise<void> {
  await pool.query(
    `insert into public.call_events (call_id, event_type, payload, latency_ms) values ($1, $2, $3, $4)`,
    [internalCallId, eventType, payload, latencyMs ?? null],
  );
}

/** Best-effort intent tag from the tool the model called (A2 audit record). */
function intentForTool(name: string): string | null {
  switch (name) {
    case "create_booking":
      return "BOOK";
    case "cancel_booking":
      return "CANCEL";
    case "reschedule_booking":
      return "RESCHEDULE";
    case "get_clinic_info":
      return "INFO";
    case "request_callback":
      return "FALLBACK";
    default:
      return null;
  }
}

export async function handleVapiMessage(message: VapiMessage, pool: Pool = getPool()): Promise<WebhookResult> {
  const callId = message.call?.id;
  const clinicId = message.call?.metadata?.clinicId;
  const fromPhone = (message.call as { customer?: { number?: string } } | undefined)?.customer?.number ?? null;

  switch (message.type) {
    case "tool-calls":
    case "function-call": {
      const calls: VapiToolCall[] =
        message.toolCalls ??
        message.toolCallList ??
        (message.functionCall
          ? [{ id: "legacy", function: { name: message.functionCall.name, arguments: message.functionCall.parameters } }]
          : []);

      // Resolve the authoritative clinic + internal call id ONCE. Fail closed
      // if we cannot establish a clinic — never fall back to model-supplied
      // clinic_id (I1/I5 cross-tenant guard).
      const resolved = callId ? await ensureCall(pool, callId, clinicId, fromPhone) : null;
      const effectiveClinicId = resolved?.clinicId ?? clinicId;
      if (!effectiveClinicId) {
        return { status: 400, body: { error: "no clinic scope for call" } };
      }
      const internalCallId = resolved?.internalId ?? null;

      // Only these tools' schemas accept a call_id; injecting it into others
      // would trip their strict() validation (I5).
      const CALL_ID_TOOLS = new Set(["create_booking", "request_callback"]);

      const results = await Promise.all(
        calls.map(async (tc) => {
          const name = tc.function.name;
          const args = parseArgs(tc.function.arguments);
          // I1: inject the trusted clinic_id / call_id, never trust the model.
          args.clinic_id = effectiveClinicId;
          if (internalCallId && CALL_ID_TOOLS.has(name)) args.call_id = internalCallId;

          const t0 = performance.now();
          const result = await executeTool(name, args, pool);
          const latencyMs = Math.round(performance.now() - t0);
          if (internalCallId) {
            await logEvent(pool, internalCallId, `tool:${name}`, { ok: result.ok, code: result.ok ? null : result.code }, latencyMs);
            // A2 audit record: tag the call's intent from the tool used.
            const intent = intentForTool(name);
            if (intent) {
              await pool.query(`update public.calls set intent = coalesce(intent, $2) where id = $1`, [internalCallId, intent]);
            }
          }

          // Post-commit side effects are wrapped so a failure here can NEVER
          // discard an already-successful booking (finding #8).
          if (name === "create_booking" && result.ok) {
            try {
              const data = result.data as { appointment_id?: string };
              if (data.appointment_id) {
                // §6 rule 5: confirmation is gated on THIS booking's stored consent.
                const outcome = await sendBookingConfirmation(
                  { clinicId: effectiveClinicId, appointmentId: data.appointment_id, callId: internalCallId ?? undefined },
                  pool,
                );
                if (internalCallId) await logEvent(pool, internalCallId, "whatsapp_confirmation", { ...outcome });
              }
              if (internalCallId) {
                const consent = typeof args.whatsapp_consent === "boolean" ? args.whatsapp_consent : null;
                await pool.query(`update public.calls set outcome = 'booked', whatsapp_consent = $2 where id = $1`, [
                  internalCallId,
                  consent,
                ]);
              }
            } catch (sideErr) {
              console.error("[vapi webhook] post-booking side effect failed", sideErr);
            }
          }

          return { toolCallId: tc.id, name, result: JSON.stringify(result) };
        }),
      );

      return { status: 200, body: { results } };
    }

    case "status-update": {
      const resolved = callId ? await ensureCall(pool, callId, clinicId, fromPhone) : null;
      if (resolved && message.status) await logEvent(pool, resolved.internalId, `status:${message.status}`, { status: message.status });
      return { status: 200, body: { ok: true } };
    }

    case "speech-update":
    case "transcript": {
      const resolved = callId ? await ensureCall(pool, callId, clinicId, fromPhone) : null;
      if (resolved) {
        await logEvent(pool, resolved.internalId, message.type, {
          role: (message.role as string) ?? null,
          transcriptType: (message.transcriptType as string) ?? null,
        });
      }
      return { status: 200, body: { ok: true } };
    }

    case "end-of-call-report": {
      const resolved = callId ? await ensureCall(pool, callId, clinicId, fromPhone) : null;
      if (resolved) {
        const transcript = (message.artifact as { messages?: unknown })?.messages ?? message.transcript ?? [];
        await pool.query(
          `update public.calls
              set ended_at = now(),
                  outcome = coalesce(outcome, $2),
                  transcript = $3
            where id = $1`,
          [resolved.internalId, mapEndedReason(message.endedReason), JSON.stringify(transcript)],
        );
        await logEvent(pool, resolved.internalId, "end-of-call", { endedReason: message.endedReason ?? null });
      }
      return { status: 200, body: { ok: true } };
    }

    default:
      return { status: 200, body: { ok: true, ignored: message.type } };
  }
}

function mapEndedReason(reason?: string): string | null {
  if (!reason) return null;
  if (reason.includes("customer-ended")) return "abandoned";
  if (reason.includes("assistant-ended")) return "info_given";
  return null;
}
