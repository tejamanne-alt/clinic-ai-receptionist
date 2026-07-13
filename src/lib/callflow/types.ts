import type { LanguageTag } from "../speech/types";
import type { SlotOption, ToolResult } from "../tools/shared";

/** §6 state machine: primary path + global states. */
export type FlowStateName =
  | "GREET"
  | "INTENT"
  | "SLOT_FILL"
  | "TOOL"
  | "CONFIRM_READBACK"
  | "CLOSE"
  | "SILENCE"
  | "CONFUSION"
  | "ESCALATE";

export type Intent = "BOOK" | "RESCHEDULE" | "CANCEL" | "INFO" | "FALLBACK";

/** §6 rule 2 slot-fill order for BOOK. */
export type SlotFillField = "doctor" | "datetime" | "slot_choice" | "name" | "phone" | "consent" | "correction";

/**
 * Every line the receptionist can say is a key into the bilingual script at
 * prompts/voice/callflow.te-en.md (R3: no spoken strings in code). Params
 * carry ONLY tool-result or caller-echo data (I1).
 */
export type ScriptKey =
  | "greeting"
  | "ask_intent_menu"
  | "ask_doctor"
  | "ask_datetime"
  | "offer_slots"
  | "no_slots_offer_callback"
  | "ask_name"
  | "ask_phone"
  | "phone_reask"
  | "confirm_readback"
  | "confirm_readback_reschedule"
  | "ask_consent"
  | "booked_confirm"
  | "whatsapp_will_send"
  | "offer_alternatives"
  | "ask_correction"
  | "info_summary"
  | "anything_else"
  | "ask_phone_for_cancel"
  | "ask_phone_for_reschedule"
  | "ask_which_appointment"
  | "cancel_confirmed"
  | "no_appointment_found"
  | "medical_deflect"
  | "clarify"
  | "escalate_promise"
  | "silence_reprompt"
  | "silence_callback"
  | "tool_error_apology"
  | "goodbye";

export interface FlowAction {
  type: "SAY" | "CALL_TOOL" | "END_CALL" | "LOG";
  /** SAY */
  key?: ScriptKey;
  params?: Record<string, unknown>;
  /** CALL_TOOL */
  tool?: string;
  input?: Record<string, unknown>;
  /** LOG (I7 audit trail) */
  event?: string;
}

export interface ClinicConfig {
  clinicId: string;
  clinicName: string;
  doctors: Array<{ id: string; name: string }>;
}

export interface CollectedSlots {
  doctorId?: string | "any";
  doctorName?: string;
  datetimePreference?: string;
  chosenSlot?: SlotOption;
  /** existing appointment being moved (reschedule disambiguation) */
  oldSlotStart?: string;
  patientName?: string;
  patientPhone?: string;
  whatsappConsent?: boolean;
}

export type InfoTopic = "fee" | "timings" | "address" | "general";

export interface FlowContext {
  config: ClinicConfig;
  state: FlowStateName;
  /** where to return after a global-state detour (§6 rule 8) */
  returnState: FlowStateName;
  language: LanguageTag;
  languageLocked: boolean;
  intent: Intent | null;
  slotFillField: SlotFillField | null;
  collected: CollectedSlots;
  offeredSlots: SlotOption[];
  /** consecutive failed intent/answer parses (§6 rule 7) */
  failedParses: number;
  /** reprompts issued in the current silence episode (§6 rule 6) */
  silenceReprompts: number;
  /** slot_choice currently picks WHICH existing appointment (cancel/reschedule) */
  disambiguating?: boolean;
  infoTopic: InfoTopic;
  turn: number;
  callId?: string;
  ended: boolean;
}

export type FlowEvent =
  | { type: "CALL_STARTED"; callId?: string }
  | { type: "CALLER_UTTERANCE"; text: string }
  | { type: "TOOL_RESULT"; tool: string; result: ToolResult }
  | { type: "SILENCE"; seconds: number }
  | { type: "HANGUP" };

export interface FlowStep {
  context: FlowContext;
  actions: FlowAction[];
}
