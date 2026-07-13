import type { Pool } from "pg";
import type { ZodTypeAny } from "zod";
import { getPool } from "../db";
import { cancelBooking, createBooking, findSlots, rescheduleBooking } from "./booking";
import { getClinicInfo, requestCallback } from "./info";
import {
  cancelBookingInput,
  clinicInfoInput,
  createBookingInput,
  findSlotsInput,
  requestCallbackInput,
  rescheduleBookingInput,
} from "./schemas";
import { fail, type ToolResult } from "./shared";

type Handler = (pool: Pool, input: never) => Promise<ToolResult>;

interface ToolEntry {
  schema: ZodTypeAny;
  handler: Handler;
  description: string;
}

/**
 * The complete tool surface the voice LLM can reach. Anything not in this
 * registry does not exist as far as a call is concerned (I1). Input passes
 * zod (I5) before any handler runs; handlers only read/write Postgres via
 * parameterized queries.
 */
export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  find_slots: {
    schema: findSlotsInput,
    handler: findSlots as Handler,
    description: "List open appointment slots (optionally for one doctor / time window).",
  },
  create_booking: {
    schema: createBookingInput,
    handler: createBooking as Handler,
    description: "Book a confirmed slot after explicit caller confirmation (confirmed=true).",
  },
  cancel_booking: {
    schema: cancelBookingInput,
    handler: cancelBooking as Handler,
    description: "Cancel the caller's upcoming confirmed appointment (matched by phone).",
  },
  reschedule_booking: {
    schema: rescheduleBookingInput,
    handler: rescheduleBooking as Handler,
    description: "Move the caller's upcoming appointment to a new slot atomically.",
  },
  get_clinic_info: {
    schema: clinicInfoInput,
    handler: getClinicInfo as Handler,
    description: "Clinic address, phone, doctors, consultation fees, and timings.",
  },
  request_callback: {
    schema: requestCallbackInput,
    handler: requestCallback as Handler,
    description: "Log a human-callback request (FALLBACK / ESCALATE / SILENCE paths).",
  },
};

export async function executeTool(name: string, rawInput: unknown, pool?: Pool): Promise<ToolResult> {
  const entry = TOOL_REGISTRY[name];
  if (!entry) return fail("UNKNOWN_TOOL", `No such tool: ${name}`);

  const parsed = entry.schema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "INVALID_INPUT",
      `Invalid ${name} input: ${issue?.path.join(".") ?? "?"} — ${issue?.message ?? "validation failed"}`,
    );
  }

  try {
    return await entry.handler(pool ?? getPool(), parsed.data as never);
  } catch (err) {
    // Never leak raw driver errors to the voice layer; log server-side.
    console.error(`[tool:${name}]`, err);
    return fail("TOOL_ERROR", "Internal error executing the tool. Apologize and offer a callback.");
  }
}
