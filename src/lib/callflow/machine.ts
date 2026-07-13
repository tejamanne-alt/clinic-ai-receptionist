import { formatDigitsInPairs, normalizeToE164 } from "../phone";
import type { SlotOption, ToolResult } from "../tools/shared";
import {
  detectLanguage,
  extractName,
  extractPhoneDigits,
  isMedicalQuestion,
  parseDoctorChoice,
  parseIntent,
  parseOptionChoice,
  parseYesNo,
} from "./lexicon";
import type {
  ClinicConfig,
  FlowAction,
  FlowContext,
  FlowEvent,
  FlowStep,
  Intent,
  ScriptKey,
} from "./types";

/**
 * Deterministic §6 call-flow machine — a pure reducer.
 *
 * Guarantees enforced structurally, not by prompt:
 *  - every SAY is a script key (R3); params only echo caller input or carry
 *    tool-result data injected via TOOL_RESULT events (I1)
 *  - create_booking is only reachable after an explicit yes at
 *    CONFIRM_READBACK followed by the consent question (§6 rules 4–5)
 *  - slot alternatives spoken are exactly the ones the tool returned (rule 3)
 *  - silence: one reprompt (~4s), callback offer (~8s) (rule 6)
 *  - two failed parses → menu prompts; third → ESCALATE (rule 7)
 *  - medical questions deflect and return to the previous question (rule 8, I4)
 */

export function createFlow(config: ClinicConfig): FlowContext {
  return {
    config,
    state: "GREET",
    returnState: "GREET",
    language: "te", // §6 rule 1 default: polite Telugu until the caller speaks
    languageLocked: false,
    intent: null,
    slotFillField: null,
    collected: {},
    offeredSlots: [],
    failedParses: 0,
    silenceReprompts: 0,
    turn: 0,
    ended: false,
    infoTopic: "general",
  };
}

function say(key: ScriptKey, params?: Record<string, unknown>): FlowAction {
  return params ? { type: "SAY", key, params } : { type: "SAY", key };
}
function callTool(tool: string, input: Record<string, unknown>): FlowAction {
  return { type: "CALL_TOOL", tool, input };
}
function log(event: string, params?: Record<string, unknown>): FlowAction {
  return params ? { type: "LOG", event, params } : { type: "LOG", event };
}

function nationalPairs(phoneE164: string): string {
  const digits = phoneE164.replace(/^\+/, "");
  const national = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return formatDigitsInPairs(national);
}

function optionLabels(slots: readonly SlotOption[]): string[] {
  return slots.map((s) => s.label);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ClinicInfoPayload {
  name?: string;
  address?: string | null;
  phone?: string | null;
  doctors?: Array<{ name: string; specialty?: string | null; consultation_fee_inr?: number | null }>;
  timings?: Array<{ weekday: number; sessions: Array<{ start: string; end: string }> }>;
}

/**
 * Assemble a spoken INFO line from the get_clinic_info payload (I1: facts
 * come only from the tool result; this just phrases them). The voice model
 * localizes wording; the numbers/strings here are the DB's.
 */
function formatInfoLine(topic: FlowContext["infoTopic"], data: unknown): string {
  const info = (data ?? {}) as ClinicInfoPayload;
  const doctors = info.doctors ?? [];

  if (topic === "fee") {
    const fees = doctors
      .filter((d) => d.consultation_fee_inr != null)
      .map((d) => `${d.name} ₹${d.consultation_fee_inr}`);
    return fees.length ? `Consultation fee: ${fees.join(", ")}.` : "Please ask our staff about the consultation fee.";
  }
  if (topic === "address") {
    return info.address ? `We are at ${info.address}.` : "Let me have our staff share the address with you.";
  }
  if (topic === "timings") {
    const days = (info.timings ?? []).map((t) => {
      const sessions = t.sessions.map((s) => `${s.start}–${s.end}`).join(", ");
      return `${WEEKDAYS[t.weekday] ?? "Day " + t.weekday}: ${sessions}`;
    });
    return days.length ? `Clinic timings — ${days.join("; ")}.` : "Please ask our staff for the current timings.";
  }
  // general: a compact combined line
  const parts: string[] = [];
  if (info.address) parts.push(`We are at ${info.address}`);
  if (doctors.length) parts.push(`doctors: ${doctors.map((d) => d.name).join(", ")}`);
  return parts.length ? `${parts.join("; ")}.` : "How can I help you with your appointment?";
}

/** RESCHEDULE has no patient-name slot, so it uses a readback line without
 * {patientName} (avoids speaking a leaked placeholder). */
function readbackKey(ctx: FlowContext): ScriptKey {
  return ctx.intent === "RESCHEDULE" ? "confirm_readback_reschedule" : "confirm_readback";
}

function readbackParams(ctx: FlowContext): Record<string, unknown> {
  return {
    patientName: ctx.collected.patientName ?? null,
    doctorName: ctx.collected.chosenSlot?.doctor_name ?? ctx.collected.doctorName ?? null,
    label: ctx.collected.chosenSlot?.label ?? null,
    phonePairs: ctx.collected.patientPhone ? nationalPairs(ctx.collected.patientPhone) : null,
  };
}

/** The prompt to re-issue during slot_choice — differs when the caller is
 * choosing WHICH existing appointment (disambiguation) vs a fresh offer. */
function slotChoiceKey(ctx: FlowContext): { key: ScriptKey; params?: Record<string, unknown> } {
  return ctx.disambiguating
    ? { key: "ask_which_appointment", params: { options: ctx.offeredSlots } }
    : { key: "offer_slots", params: { options: ctx.offeredSlots } };
}

/** The question to repeat after a medical-deflection detour (§6 rule 8). */
function currentQuestionKey(ctx: FlowContext): { key: ScriptKey; params?: Record<string, unknown> } | null {
  if (ctx.state === "CONFIRM_READBACK") return { key: readbackKey(ctx), params: readbackParams(ctx) };
  // At the intent-gathering states, re-prompt with the menu so rule 8's
  // "return to the previous question" is honored rather than going silent.
  if (ctx.state === "GREET" || ctx.state === "INTENT" || ctx.state === "CONFUSION") {
    return { key: "ask_intent_menu" };
  }
  if (ctx.state === "SLOT_FILL") {
    switch (ctx.slotFillField) {
      case "doctor":
        return { key: "ask_doctor", params: { doctors: ctx.config.doctors.map((d) => d.name) } };
      case "datetime":
        return { key: "ask_datetime" };
      case "slot_choice":
        return slotChoiceKey(ctx);
      case "name":
        return { key: "ask_name" };
      case "phone":
        return { key: "ask_phone" };
      case "consent":
        return { key: "ask_consent" };
      default:
        return null;
    }
  }
  return null;
}

/** §6 rule 7 ladder for unparseable answers. Returns actions; mutates ctx. */
function parseFailure(ctx: FlowContext, reAsk: { key: ScriptKey; params?: Record<string, unknown> } | null): FlowAction[] {
  ctx.failedParses += 1;
  if (ctx.failedParses >= 3) {
    return escalate(ctx, "three consecutive failed parses");
  }
  if (ctx.failedParses === 2) {
    // menu-style prompts on the second failure
    if (ctx.state === "INTENT" || ctx.state === "CONFUSION") {
      ctx.state = "CONFUSION";
      return [say("ask_intent_menu"), log("confusion_menu")];
    }
    return reAsk ? [say(reAsk.key, reAsk.params), log("reprompt_menu")] : [say("clarify")];
  }
  const actions: FlowAction[] = [say("clarify")];
  if (reAsk) actions.push(say(reAsk.key, reAsk.params));
  return actions;
}

function escalate(ctx: FlowContext, reason: string): FlowAction[] {
  ctx.state = "CLOSE";
  ctx.ended = true;
  const input: Record<string, unknown> = {
    clinic_id: ctx.config.clinicId,
    reason: `ESCALATE: ${reason}`,
  };
  if (ctx.collected.patientPhone) input.phone = ctx.collected.patientPhone;
  if (ctx.collected.patientName) input.name = ctx.collected.patientName;
  if (ctx.callId) input.call_id = ctx.callId;
  return [log("escalate", { reason }), say("escalate_promise"), callTool("request_callback", input), say("goodbye"), { type: "END_CALL" }];
}

function nextMissingBookField(ctx: FlowContext): "name" | "phone" | null {
  if (!ctx.collected.patientName) return "name";
  if (!ctx.collected.patientPhone) return "phone";
  return null;
}

/** After a slot is chosen (fresh offer OR conflict alternatives), continue the §6 rule-2 order. */
function afterSlotChosen(ctx: FlowContext): FlowAction[] {
  const missing = nextMissingBookField(ctx);
  if (ctx.intent === "RESCHEDULE") {
    ctx.state = "CONFIRM_READBACK";
    return [say(readbackKey(ctx), readbackParams(ctx))];
  }
  if (missing === "name") {
    ctx.state = "SLOT_FILL";
    ctx.slotFillField = "name";
    return [say("ask_name")];
  }
  if (missing === "phone") {
    ctx.state = "SLOT_FILL";
    ctx.slotFillField = "phone";
    return [say("ask_phone")];
  }
  ctx.state = "CONFIRM_READBACK";
  return [say(readbackKey(ctx), readbackParams(ctx))];
}

function beginIntent(ctx: FlowContext, intent: Intent, text: string): FlowAction[] {
  ctx.intent = intent;
  ctx.failedParses = 0;
  switch (intent) {
    case "BOOK": {
      const doctor = parseDoctorChoice(text, ctx.config.doctors);
      ctx.state = "SLOT_FILL";
      if (doctor) {
        ctx.collected.doctorId = doctor.id;
        ctx.collected.doctorName = doctor.name;
        ctx.slotFillField = "datetime";
        return [log("intent", { intent }), say("ask_datetime")];
      }
      ctx.slotFillField = "doctor";
      return [log("intent", { intent }), say("ask_doctor", { doctors: ctx.config.doctors.map((d) => d.name) })];
    }
    case "INFO": {
      const t = text.toLowerCase();
      ctx.infoTopic = /fee|cost|charge|entha|ఎంత/.test(t)
        ? "fee"
        : /address|ekkada|ఎక్కడ|location|direction/.test(t)
          ? "address"
          : /timing|open|close|సమయం|sunday|hours/.test(t)
            ? "timings"
            : "general";
      ctx.state = "TOOL";
      return [log("intent", { intent }), callTool("get_clinic_info", { clinic_id: ctx.config.clinicId })];
    }
    case "CANCEL": {
      ctx.state = "SLOT_FILL";
      ctx.slotFillField = "phone";
      return [log("intent", { intent }), say("ask_phone_for_cancel")];
    }
    case "RESCHEDULE": {
      ctx.state = "SLOT_FILL";
      ctx.slotFillField = "phone";
      return [log("intent", { intent }), say("ask_phone_for_reschedule")];
    }
    case "FALLBACK": {
      return escalate(ctx, "caller asked for a human");
    }
  }
}

function handleUtterance(ctx: FlowContext, text: string): FlowAction[] {
  ctx.turn += 1;
  ctx.silenceReprompts = 0;

  if (!ctx.languageLocked) {
    // §6 rule 1: mirror the caller's language from turn 1
    ctx.language = detectLanguage(text);
    ctx.languageLocked = true;
  }

  // I4: medical question in ANY state → scripted deflection, then return
  // to the question we were on (§6 rule 8)
  if (isMedicalQuestion(text) && ctx.state !== "CLOSE") {
    const back = currentQuestionKey(ctx);
    const actions: FlowAction[] = [log("medical_deflect"), say("medical_deflect")];
    if (back) actions.push(say(back.key, back.params));
    return actions;
  }

  switch (ctx.state) {
    case "GREET":
    case "INTENT":
    case "CONFUSION": {
      const intent = parseIntent(text);
      if (!intent) return parseFailure(ctx, null);
      return beginIntent(ctx, intent, text);
    }

    case "SLOT_FILL":
      return handleSlotFill(ctx, text);

    case "CONFIRM_READBACK": {
      const yn = parseYesNo(text);
      if (yn === null) return parseFailure(ctx, { key: readbackKey(ctx), params: readbackParams(ctx) });
      ctx.failedParses = 0;
      if (yn) {
        if (ctx.intent === "RESCHEDULE") {
          ctx.state = "TOOL";
          const input: Record<string, unknown> = {
            clinic_id: ctx.config.clinicId,
            patient_phone: ctx.collected.patientPhone,
            new_slot_start: ctx.collected.chosenSlot?.slot_start,
          };
          if (ctx.collected.oldSlotStart) input.old_slot_start = ctx.collected.oldSlotStart;
          return [callTool("reschedule_booking", input)];
        }
        // §6 rule 5: consent line BEFORE any WhatsApp send — asked before
        // booking so the consent boolean rides along on create_booking.
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "consent";
        return [say("ask_consent")];
      }
      // caller said no → ask what to change; re-run availability
      ctx.state = "SLOT_FILL";
      ctx.slotFillField = "datetime";
      return [say("ask_correction")];
    }

    case "TOOL":
      // barge-in while a tool runs — the TTS layer halts speech (§6 rule 9);
      // the machine just logs, the pending TOOL_RESULT will drive the flow.
      return [log("utterance_during_tool", { text })];

    case "CLOSE":
      return [];

    default:
      return [];
  }
}

function handleSlotFill(ctx: FlowContext, text: string): FlowAction[] {
  switch (ctx.slotFillField) {
    case "doctor": {
      const doctor = parseDoctorChoice(text, ctx.config.doctors);
      if (!doctor) {
        return parseFailure(ctx, { key: "ask_doctor", params: { doctors: ctx.config.doctors.map((d) => d.name) } });
      }
      ctx.failedParses = 0;
      ctx.collected.doctorId = doctor.id;
      ctx.collected.doctorName = doctor.name;
      ctx.slotFillField = "datetime";
      return [say("ask_datetime")];
    }

    case "datetime": {
      if (text.trim().length === 0) return parseFailure(ctx, { key: "ask_datetime" });
      ctx.failedParses = 0;
      ctx.collected.datetimePreference = text.trim().slice(0, 200);
      ctx.state = "TOOL";
      const input: Record<string, unknown> = { clinic_id: ctx.config.clinicId, limit: 2 };
      if (ctx.collected.doctorId && ctx.collected.doctorId !== "any") input.doctor_id = ctx.collected.doctorId;
      return [callTool("find_slots", input)];
    }

    case "slot_choice": {
      const idx = parseOptionChoice(text, optionLabels(ctx.offeredSlots));
      if (idx === null) {
        return parseFailure(ctx, slotChoiceKey(ctx));
      }
      ctx.failedParses = 0;
      const chosen = ctx.offeredSlots[idx];
      if (!chosen) return parseFailure(ctx, slotChoiceKey(ctx));

      if (ctx.disambiguating) {
        // choosing WHICH existing appointment (cancel/reschedule)
        ctx.disambiguating = false;
        if (ctx.intent === "CANCEL") {
          ctx.state = "TOOL";
          return [
            callTool("cancel_booking", {
              clinic_id: ctx.config.clinicId,
              patient_phone: ctx.collected.patientPhone,
              slot_start: chosen.slot_start,
            }),
          ];
        }
        ctx.collected.oldSlotStart = chosen.slot_start;
        ctx.slotFillField = "datetime";
        return [say("ask_datetime")];
      }

      ctx.collected.chosenSlot = chosen;
      return afterSlotChosen(ctx);
    }

    case "name": {
      const name = extractName(text);
      if (!name) return parseFailure(ctx, { key: "ask_name" });
      ctx.failedParses = 0;
      ctx.collected.patientName = name;
      ctx.slotFillField = "phone";
      return [say("ask_phone")];
    }

    case "phone": {
      const digits = extractPhoneDigits(text);
      const phone = digits ? normalizeToE164(digits) : null;
      if (!phone) {
        ctx.failedParses += 1;
        if (ctx.failedParses >= 3) return escalate(ctx, "could not capture phone number");
        return [say("phone_reask")];
      }
      ctx.failedParses = 0;
      ctx.collected.patientPhone = phone;
      if (ctx.intent === "CANCEL") {
        ctx.state = "TOOL";
        return [callTool("cancel_booking", { clinic_id: ctx.config.clinicId, patient_phone: phone })];
      }
      if (ctx.intent === "RESCHEDULE") {
        ctx.slotFillField = "datetime";
        return [say("ask_datetime")];
      }
      // BOOK: §6 rule 2 — read the digits back in pairs inside the full readback
      ctx.state = "CONFIRM_READBACK";
      return [say(readbackKey(ctx), readbackParams(ctx))];
    }

    case "consent": {
      const yn = parseYesNo(text);
      if (yn === null) return parseFailure(ctx, { key: "ask_consent" });
      ctx.failedParses = 0;
      ctx.collected.whatsappConsent = yn;
      ctx.state = "TOOL";
      const input: Record<string, unknown> = {
        clinic_id: ctx.config.clinicId,
        doctor_id: ctx.collected.chosenSlot?.doctor_id,
        patient_name: ctx.collected.patientName,
        patient_phone: ctx.collected.patientPhone,
        slot_start: ctx.collected.chosenSlot?.slot_start,
        whatsapp_consent: yn,
        confirmed: true, // the explicit yes happened at CONFIRM_READBACK
      };
      if (ctx.callId) input.call_id = ctx.callId;
      return [callTool("create_booking", input)];
    }

    default:
      return [];
  }
}

function handleToolResult(ctx: FlowContext, tool: string, result: ToolResult): FlowAction[] {
  const actions: FlowAction[] = [log("tool_result", { tool, ok: result.ok })];

  switch (tool) {
    case "get_clinic_info": {
      if (result.ok) {
        ctx.state = "INTENT";
        // I1: the spoken line is assembled from the tool payload only — the
        // machine phrases facts, it never sources them.
        actions.push(
          say("info_summary", { infoLine: formatInfoLine(ctx.infoTopic, result.data) }),
          say("anything_else"),
        );
      } else {
        ctx.state = "INTENT";
        actions.push(say("tool_error_apology"), say("anything_else"));
      }
      return actions;
    }

    case "find_slots": {
      if (!result.ok) {
        actions.push(say("tool_error_apology"));
        return actions.concat(escalate(ctx, "find_slots failed"));
      }
      const slots = (result.data as { slots: SlotOption[] }).slots;
      if (slots.length === 0) {
        actions.push(say("no_slots_offer_callback"));
        return actions.concat(escalate(ctx, "no open slots in window"));
      }
      ctx.offeredSlots = slots.slice(0, 2);
      ctx.state = "SLOT_FILL";
      ctx.slotFillField = "slot_choice";
      actions.push(say("offer_slots", { options: ctx.offeredSlots }));
      return actions;
    }

    case "create_booking":
    case "reschedule_booking": {
      if (result.ok) {
        ctx.state = "CLOSE";
        ctx.ended = true;
        const data = result.data as { label?: string; doctor_name?: string };
        actions.push(
          say("booked_confirm", {
            label: data.label ?? null,
            doctorName: data.doctor_name ?? null,
            moved: tool === "reschedule_booking",
          }),
        );
        if (ctx.collected.whatsappConsent) actions.push(say("whatsapp_will_send"));
        actions.push(say("goodbye"), { type: "END_CALL" });
        return actions;
      }
      if ((result.code === "SLOT_TAKEN" || result.code === "SLOT_NOT_FOUND") && result.alternatives?.length) {
        // §6 rule 3: offer exactly the tool's nearest alternatives
        ctx.offeredSlots = result.alternatives.slice(0, 2);
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "slot_choice";
        actions.push(say("offer_alternatives", { options: ctx.offeredSlots }));
        return actions;
      }
      if (result.code === "MULTIPLE_MATCHES" && result.alternatives?.length) {
        ctx.offeredSlots = result.alternatives.slice(0, 3);
        ctx.disambiguating = true;
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "slot_choice";
        actions.push(say("ask_which_appointment", { options: ctx.offeredSlots }));
        return actions;
      }
      if (result.code === "INVALID_PHONE") {
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "phone";
        actions.push(say("phone_reask"));
        return actions;
      }
      if (result.code === "APPOINTMENT_NOT_FOUND") {
        ctx.state = "INTENT";
        actions.push(say("no_appointment_found"), say("anything_else"));
        return actions;
      }
      actions.push(say("tool_error_apology"));
      return actions.concat(escalate(ctx, `${tool} failed: ${result.code}`));
    }

    case "cancel_booking": {
      if (result.ok) {
        ctx.state = "INTENT";
        const data = result.data as { label?: string; doctor_name?: string };
        actions.push(
          say("cancel_confirmed", { label: data.label ?? null, doctorName: data.doctor_name ?? null }),
          say("anything_else"),
        );
        return actions;
      }
      if (result.code === "MULTIPLE_MATCHES" && result.alternatives?.length) {
        ctx.offeredSlots = result.alternatives.slice(0, 3);
        ctx.disambiguating = true;
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "slot_choice";
        actions.push(say("ask_which_appointment", { options: ctx.offeredSlots }));
        return actions;
      }
      if (result.code === "APPOINTMENT_NOT_FOUND") {
        ctx.state = "INTENT";
        actions.push(say("no_appointment_found"), say("anything_else"));
        return actions;
      }
      if (result.code === "INVALID_PHONE") {
        ctx.state = "SLOT_FILL";
        ctx.slotFillField = "phone";
        actions.push(say("phone_reask"));
        return actions;
      }
      actions.push(say("tool_error_apology"));
      return actions.concat(escalate(ctx, `cancel failed: ${result.code}`));
    }

    case "request_callback":
      return actions;

    default:
      return actions;
  }
}

export function reduce(prev: FlowContext, event: FlowEvent): FlowStep {
  // clone: reducer stays pure for callers even though helpers mutate the copy
  const ctx: FlowContext = structuredClone(prev);
  if (ctx.ended && event.type !== "HANGUP") {
    return { context: ctx, actions: [] };
  }

  switch (event.type) {
    case "CALL_STARTED": {
      ctx.callId = event.callId;
      ctx.state = "INTENT";
      return {
        context: ctx,
        actions: [log("call_started"), say("greeting", { clinicName: ctx.config.clinicName })],
      };
    }

    case "CALLER_UTTERANCE":
      return { context: ctx, actions: handleUtterance(ctx, event.text) };

    case "TOOL_RESULT":
      return { context: ctx, actions: handleToolResult(ctx, event.tool, event.result) };

    case "SILENCE": {
      // §6 rule 6: reprompt once around 4s; around 8s offer a callback,
      // log a callback_request, end warmly.
      if (event.seconds >= 8 || ctx.silenceReprompts >= 1) {
        ctx.state = "CLOSE";
        ctx.ended = true;
        const input: Record<string, unknown> = {
          clinic_id: ctx.config.clinicId,
          reason: "Caller went silent — promised a callback",
        };
        if (ctx.collected.patientPhone) input.phone = ctx.collected.patientPhone;
        if (ctx.collected.patientName) input.name = ctx.collected.patientName;
        if (ctx.callId) input.call_id = ctx.callId;
        return {
          context: ctx,
          actions: [
            log("silence_callback"),
            say("silence_callback"),
            callTool("request_callback", input),
            say("goodbye"),
            { type: "END_CALL" },
          ],
        };
      }
      ctx.silenceReprompts += 1;
      return { context: ctx, actions: [log("silence_reprompt"), say("silence_reprompt")] };
    }

    case "HANGUP": {
      ctx.ended = true;
      ctx.state = "CLOSE";
      return { context: ctx, actions: [log("hangup")] };
    }
  }
}
