import type { Pool } from "pg";
import { getPool } from "../db";
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

async function ensureCall(pool: Pool, callId: string, clinicId?: string): Promise<string | null> {
  if (!clinicId) {
    const found = await pool.query<{ clinic_id: string }>(
      `select clinic_id from public.calls where provider_call_id = $1 limit 1`,
      [callId],
    );
    return found.rows[0]?.clinic_id ?? null;
  }
  await pool.query(
    `insert into public.calls (provider, provider_call_id, clinic_id, direction)
     values ('vapi', $1, $2, 'inbound')
     on conflict do nothing`,
    [callId, clinicId],
  );
  return clinicId;
}

async function logEvent(
  pool: Pool,
  callId: string,
  eventType: string,
  payload: Record<string, unknown>,
  latencyMs?: number,
): Promise<void> {
  const call = await pool.query<{ id: string }>(
    `select id from public.calls where provider_call_id = $1 limit 1`,
    [callId],
  );
  const id = call.rows[0]?.id;
  if (!id) return;
  await pool.query(
    `insert into public.call_events (call_id, event_type, payload, latency_ms) values ($1, $2, $3, $4)`,
    [id, eventType, payload, latencyMs ?? null],
  );
}

export async function handleVapiMessage(message: VapiMessage, pool: Pool = getPool()): Promise<WebhookResult> {
  const callId = message.call?.id;
  const clinicId = message.call?.metadata?.clinicId;

  switch (message.type) {
    case "tool-calls":
    case "function-call": {
      const calls: VapiToolCall[] =
        message.toolCalls ??
        message.toolCallList ??
        (message.functionCall
          ? [{ id: "legacy", function: { name: message.functionCall.name, arguments: message.functionCall.parameters } }]
          : []);

      if (callId) await ensureCall(pool, callId, clinicId);

      // Only these tools' schemas accept a call_id; injecting it into others
      // would trip their strict() validation (I5).
      const CALL_ID_TOOLS = new Set(["create_booking", "request_callback"]);
      let internalCallId: string | null = null;
      if (callId) {
        const internal = await pool.query<{ id: string }>(
          `select id from public.calls where provider_call_id = $1 limit 1`,
          [callId],
        );
        internalCallId = internal.rows[0]?.id ?? null;
      }

      const results = await Promise.all(
        calls.map(async (tc) => {
          const name = tc.function.name;
          const args = parseArgs(tc.function.arguments);
          // I1: inject the trusted clinic_id / call_id from call metadata,
          // never trust the model to supply them.
          if (clinicId) args.clinic_id = clinicId;
          if (internalCallId && CALL_ID_TOOLS.has(name)) args.call_id = internalCallId;

          const t0 = performance.now();
          const result = await executeTool(name, args, pool);
          const latencyMs = Math.round(performance.now() - t0);
          if (callId) {
            await logEvent(pool, callId, `tool:${name}`, { ok: result.ok, code: result.ok ? null : result.code }, latencyMs);
          }
          return { toolCallId: tc.id, name, result: JSON.stringify(result) };
        }),
      );

      return { status: 200, body: { results } };
    }

    case "status-update": {
      if (callId && clinicId) await ensureCall(pool, callId, clinicId);
      if (callId && message.status) await logEvent(pool, callId, `status:${message.status}`, { status: message.status });
      return { status: 200, body: { ok: true } };
    }

    case "speech-update":
    case "transcript": {
      if (callId) {
        await logEvent(pool, callId, message.type, {
          role: (message.role as string) ?? null,
          transcriptType: (message.transcriptType as string) ?? null,
        });
      }
      return { status: 200, body: { ok: true } };
    }

    case "end-of-call-report": {
      if (callId) {
        const transcript = (message.artifact as { messages?: unknown })?.messages ?? message.transcript ?? [];
        await pool.query(
          `update public.calls
              set ended_at = now(),
                  outcome = coalesce(outcome, $2),
                  transcript = $3
            where provider_call_id = $1`,
          [callId, mapEndedReason(message.endedReason), JSON.stringify(transcript)],
        );
        await logEvent(pool, callId, "end-of-call", { endedReason: message.endedReason ?? null });
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
