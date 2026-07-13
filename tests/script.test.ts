import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFlow, reduce } from "../src/lib/callflow/machine";
import { parseScript, renderLine } from "../src/lib/callflow/script";
import type { FlowAction, FlowContext, FlowEvent, ScriptKey } from "../src/lib/callflow/types";

const ALL_KEYS: ScriptKey[] = [
  "greeting", "ask_intent_menu", "ask_doctor", "ask_datetime", "offer_slots",
  "no_slots_offer_callback", "ask_name", "ask_phone", "phone_reask",
  "confirm_readback", "confirm_readback_reschedule", "ask_consent", "booked_confirm",
  "whatsapp_will_send", "offer_alternatives",
  "ask_correction", "info_summary", "anything_else", "ask_phone_for_cancel",
  "ask_phone_for_reschedule", "ask_which_appointment", "cancel_confirmed",
  "no_appointment_found", "medical_deflect", "clarify", "escalate_promise",
  "silence_reprompt", "silence_callback", "tool_error_apology", "goodbye",
];

const md = readFileSync(path.join(__dirname, "..", "prompts", "voice", "callflow.te-en.md"), "utf8");
const table = parseScript(md);

describe("callflow script (R3: text lives in prompts/, engine emits keys)", () => {
  it("covers every engine ScriptKey in both languages", () => {
    for (const key of ALL_KEYS) {
      expect(table[key], `missing section "${key}"`).toBeDefined();
      expect(table[key]?.te, `missing te line for "${key}"`).toBeTruthy();
      expect(table[key]?.en, `missing en line for "${key}"`).toBeTruthy();
    }
  });

  it("greeting names the clinic (§6 rule 1)", () => {
    const line = renderLine(table, "greeting", "te", { clinicName: "శ్రీ వెంకటేశ్వర క్లినిక్" });
    expect(line).toContain("శ్రీ వెంకటేశ్వర క్లినిక్");
    expect(line).not.toContain("{clinicName}");
  });

  it("uses the exact I4 deflection line from the contract", () => {
    expect(renderLine(table, "medical_deflect", "te")).toBe(
      "అది డాక్టర్ గారు consultation లో చెప్తారు — నేను appointment book చేయగలను.",
    );
  });

  it("renders slot options from arrays of tool results", () => {
    const line = renderLine(table, "offer_slots", "en", {
      options: [{ label: "Tuesday, 14 July, 10:00 am" }, { label: "Tuesday, 14 July, 10:15 am" }],
    });
    expect(line).toContain("Tuesday, 14 July, 10:00 am, Tuesday, 14 July, 10:15 am");
  });

  it("keeps unfilled placeholders visible so missing params can't pass silently", () => {
    expect(renderLine(table, "confirm_readback", "en", {})).toContain("{patientName}");
  });
});

describe("mocked-tools happy path, rendered end-to-end (Phase 1 deliverable)", () => {
  it("plays a complete GREET → BOOK call through the real script", () => {
    let ctx: FlowContext = createFlow({
      clinicId: "00000000-0000-0000-0000-000000000001",
      clinicName: "Sri Venkateswara Clinic",
      doctors: [{ id: "00000000-0000-0000-0000-000000000011", name: "Dr. Ramesh" }],
    });
    const transcript: string[] = [];

    const drive = (event: FlowEvent): FlowAction[] => {
      const step = reduce(ctx, event);
      ctx = step.context;
      for (const a of step.actions) {
        if (a.type === "SAY" && a.key) {
          transcript.push(renderLine(table, a.key, ctx.language, a.params ?? {}));
        }
      }
      return step.actions;
    };

    drive({ type: "CALL_STARTED" });
    drive({ type: "CALLER_UTTERANCE", text: "Hello, naaku doctor appointment kavali" });
    drive({ type: "CALLER_UTTERANCE", text: "Ramesh garu" });
    const toolCall = drive({ type: "CALLER_UTTERANCE", text: "repu morning" }).find((a) => a.type === "CALL_TOOL");
    expect(toolCall?.tool).toBe("find_slots");
    drive({
      type: "TOOL_RESULT",
      tool: "find_slots",
      result: {
        ok: true,
        data: {
          slots: [
            {
              slot_start: "2026-07-14T04:30:00.000Z",
              slot_end: "2026-07-14T04:45:00.000Z",
              doctor_id: "00000000-0000-0000-0000-000000000011",
              doctor_name: "Dr. Ramesh",
              label: "Tuesday, 14 July, 10:00 am",
            },
          ],
        },
      },
    });
    drive({ type: "CALLER_UTTERANCE", text: "first one sare" });
    drive({ type: "CALLER_UTTERANCE", text: "naa peru Suresh" });
    drive({ type: "CALLER_UTTERANCE", text: "9849123456" });
    drive({ type: "CALLER_UTTERANCE", text: "avunu correct" });
    const booking = drive({ type: "CALLER_UTTERANCE", text: "sare pampandi" }).find((a) => a.type === "CALL_TOOL");
    expect(booking?.tool).toBe("create_booking");
    drive({
      type: "TOOL_RESULT",
      tool: "create_booking",
      result: {
        ok: true,
        data: { appointment_id: "a1", label: "Tuesday, 14 July, 10:00 am", doctor_name: "Dr. Ramesh" },
      },
    });

    const call = transcript.join("\n");
    // no placeholder leaked into anything actually spoken
    for (const spoken of transcript) {
      expect(spoken).not.toMatch(/\{(clinicName|options|patientName|doctorName|label|phonePairs|doctors)\}/);
    }
    // the call reads like a call: greeting → questions → readback → consent → confirm
    expect(call).toContain("Sri Venkateswara Clinic");
    expect(call).toContain("98 49 12 34 56");
    expect(ctx.ended).toBe(true);
    expect(transcript.length).toBeGreaterThanOrEqual(9);
  });
});
