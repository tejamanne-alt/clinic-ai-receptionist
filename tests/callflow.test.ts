import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFlow, reduce } from "../src/lib/callflow/machine";
import { parseScript, renderLine } from "../src/lib/callflow/script";
import type { ClinicConfig, FlowAction, FlowContext, FlowEvent } from "../src/lib/callflow/types";
import type { SlotOption, ToolResult } from "../src/lib/tools/shared";

const SCRIPT = parseScript(
  readFileSync(path.join(__dirname, "..", "prompts", "voice", "callflow.te-en.md"), "utf8"),
);

const CONFIG: ClinicConfig = {
  clinicId: "00000000-0000-0000-0000-000000000001",
  clinicName: "Sri Venkateswara Clinic",
  doctors: [
    { id: "00000000-0000-0000-0000-000000000011", name: "Dr. Ramesh" },
    { id: "00000000-0000-0000-0000-000000000012", name: "Dr. Lakshmi" },
  ],
};

const SLOT_A: SlotOption = {
  slot_start: "2026-07-14T04:30:00.000Z",
  slot_end: "2026-07-14T04:45:00.000Z",
  doctor_id: CONFIG.doctors[0]!.id,
  doctor_name: "Dr. Ramesh",
  label: "Tuesday, 14 July, 10:00 am",
};
const SLOT_B: SlotOption = {
  ...SLOT_A,
  slot_start: "2026-07-14T04:45:00.000Z",
  slot_end: "2026-07-14T05:00:00.000Z",
  label: "Tuesday, 14 July, 10:15 am",
};

class Sim {
  ctx: FlowContext;
  history: FlowAction[][] = [];
  constructor(config = CONFIG) {
    this.ctx = createFlow(config);
  }
  step(event: FlowEvent): FlowAction[] {
    const { context, actions } = reduce(this.ctx, event);
    this.ctx = context;
    this.history.push(actions);
    return actions;
  }
  say(actions: FlowAction[]): string[] {
    return actions.filter((a) => a.type === "SAY").map((a) => a.key as string);
  }
  toolCalls(actions: FlowAction[]): Array<{ tool: string; input: Record<string, unknown> }> {
    return actions
      .filter((a) => a.type === "CALL_TOOL")
      .map((a) => ({ tool: a.tool as string, input: a.input ?? {} }));
  }
  utter(text: string): FlowAction[] {
    return this.step({ type: "CALLER_UTTERANCE", text });
  }
  toolOk(tool: string, data: unknown): FlowAction[] {
    return this.step({ type: "TOOL_RESULT", tool, result: { ok: true, data } as ToolResult });
  }
  toolFail(tool: string, code: string, alternatives?: SlotOption[]): FlowAction[] {
    return this.step({
      type: "TOOL_RESULT",
      tool,
      result: { ok: false, code, message: code, ...(alternatives ? { alternatives } : {}) } as ToolResult,
    });
  }
}

describe("GREET → BOOK happy path (§6 rules 1–5)", () => {
  it("walks the full slot-fill order and gates booking on explicit yes + consent", () => {
    const sim = new Sim();

    // greeting names the clinic (rule 1)
    const greet = sim.step({ type: "CALL_STARTED", callId: "00000000-0000-0000-0000-00000000c a11".replace(/\s/g, "") });
    expect(sim.say(greet)).toEqual(["greeting"]);
    expect(greet.find((a) => a.key === "greeting")?.params).toMatchObject({ clinicName: "Sri Venkateswara Clinic" });

    // turn 1 mirrors language: Tenglish → mix (rule 1)
    const a1 = sim.utter("Hello, నాకు doctor appointment కావాలి");
    expect(sim.ctx.language).toBe("mix");
    expect(sim.say(a1)).toEqual(["ask_doctor"]); // slot-fill starts with doctor (rule 2)

    const a2 = sim.utter("Ramesh గారు");
    expect(sim.say(a2)).toEqual(["ask_datetime"]); // then date/time (rule 2)

    const a3 = sim.utter("రేపు morning");
    expect(sim.toolCalls(a3)).toHaveLength(1);
    expect(sim.toolCalls(a3)[0]?.tool).toBe("find_slots");

    // options offered come from the tool result, verbatim (rule 3 / I1)
    const a4 = sim.toolOk("find_slots", { slots: [SLOT_A, SLOT_B] });
    expect(sim.say(a4)).toEqual(["offer_slots"]);
    expect(a4.find((a) => a.key === "offer_slots")?.params).toEqual({ options: [SLOT_A, SLOT_B] });

    const a5 = sim.utter("first one");
    expect(sim.say(a5)).toEqual(["ask_name"]); // then name (rule 2)

    const a6 = sim.utter("naa peru Suresh Kumar");
    expect(sim.say(a6)).toEqual(["ask_phone"]); // then phone (rule 2)
    expect(sim.ctx.collected.patientName).toBe("Suresh Kumar");

    // phone digits read back in pairs inside the readback (rules 2 & 4)
    const a7 = sim.utter("98491 23456");
    expect(sim.say(a7)).toEqual(["confirm_readback"]);
    const readback = a7.find((a) => a.key === "confirm_readback")?.params as Record<string, unknown>;
    expect(readback.phonePairs).toBe("98 49 12 34 56");
    expect(readback.patientName).toBe("Suresh Kumar");
    expect(readback.doctorName).toBe("Dr. Ramesh");
    expect(readback.label).toBe(SLOT_A.label);

    // no booking yet — explicit yes required (rule 4)
    expect(sim.history.flat().filter((a) => a.tool === "create_booking")).toHaveLength(0);

    // yes → consent line BEFORE any WhatsApp send (rule 5)
    const a8 = sim.utter("అవును, correct");
    expect(sim.say(a8)).toEqual(["ask_consent"]);

    const a9 = sim.utter("yes పంపండి");
    const calls = sim.toolCalls(a9);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("create_booking");
    expect(calls[0]?.input).toMatchObject({
      confirmed: true,
      whatsapp_consent: true,
      patient_phone: "+919849123456",
      slot_start: SLOT_A.slot_start,
      doctor_id: SLOT_A.doctor_id,
    });

    const a10 = sim.toolOk("create_booking", { appointment_id: "x", label: SLOT_A.label, doctor_name: "Dr. Ramesh" });
    // consent was yes → the WhatsApp notice line is included
    expect(sim.say(a10)).toEqual(["booked_confirm", "whatsapp_will_send", "goodbye"]);
    expect(a10.some((a) => a.type === "END_CALL")).toBe(true);
    expect(sim.ctx.ended).toBe(true);
  });

  it("skips the doctor question when the caller names the doctor up front", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    const a = sim.utter("Dr. Lakshmi appointment kavali next week");
    expect(sim.say(a)).toEqual(["ask_datetime"]);
    expect(sim.ctx.collected.doctorName).toBe("Dr. Lakshmi");
  });

  it('accepts "any doctor" (§6 rule 2)', () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("appointment kavali");
    const a = sim.utter("evaraina doctor chalu");
    expect(sim.say(a)).toEqual(["ask_datetime"]);
    expect(sim.ctx.collected.doctorId).toBe("any");
  });
});

describe("slot conflict (§6 rule 3)", () => {
  it("offers exactly the tool's alternatives and re-runs the readback gate", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book appointment with Ramesh");
    sim.utter("tomorrow");
    sim.toolOk("find_slots", { slots: [SLOT_A, SLOT_B] });
    sim.utter("first");
    sim.utter("Suresh");
    sim.utter("9849123456");
    sim.utter("yes");
    sim.utter("yes"); // consent → create_booking fires

    // conflict: alternatives come back from the tool
    const alt = sim.toolFail("create_booking", "SLOT_TAKEN", [SLOT_B]);
    expect(sim.say(alt)).toContain("offer_alternatives");
    expect(alt.find((a) => a.key === "offer_alternatives")?.params).toEqual({ options: [SLOT_B] });

    // caller picks the alternative → must pass readback + yes again (rule 4)
    const pick = sim.utter("10:15 sare");
    expect(sim.say(pick)).toEqual(["confirm_readback"]);
    const yes = sim.utter("avunu");
    expect(sim.say(yes)).toEqual(["ask_consent"]);
    const consent = sim.utter("vaddu"); // caller refuses WhatsApp this time
    const call = sim.toolCalls(consent)[0];
    expect(call?.tool).toBe("create_booking");
    expect(call?.input).toMatchObject({ whatsapp_consent: false, slot_start: SLOT_B.slot_start });
  });
});

describe("silence handling (§6 rule 6)", () => {
  it("reprompts once (~4s), then offers callback and ends warmly (~8s)", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    const r1 = sim.step({ type: "SILENCE", seconds: 4 });
    expect(sim.say(r1)).toEqual(["silence_reprompt"]);

    const r2 = sim.step({ type: "SILENCE", seconds: 8 });
    expect(sim.say(r2)).toEqual(["silence_callback", "goodbye"]);
    const cb = sim.toolCalls(r2)[0];
    expect(cb?.tool).toBe("request_callback");
    expect(r2.some((a) => a.type === "END_CALL")).toBe(true);
    expect(sim.ctx.ended).toBe(true);
  });

  it("a caller utterance resets the silence episode", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.step({ type: "SILENCE", seconds: 4 });
    sim.utter("appointment kavali");
    const again = sim.step({ type: "SILENCE", seconds: 4 });
    expect(sim.say(again)).toEqual(["silence_reprompt"]); // reprompt, not hangup
  });
});

describe("confusion ladder (§6 rule 7)", () => {
  it("2 failed parses → menu prompts; 3rd → ESCALATE with human-callback promise", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });

    const f1 = sim.utter("hmmm ala kaadu emo");
    expect(sim.say(f1)).toEqual(["clarify"]);

    const f2 = sim.utter("asalu artham kaale");
    expect(sim.say(f2)).toEqual(["ask_intent_menu"]);
    expect(sim.ctx.state).toBe("CONFUSION");

    const f3 = sim.utter("blah blah blah");
    expect(sim.say(f3)).toEqual(["escalate_promise", "goodbye"]);
    expect(sim.toolCalls(f3)[0]?.tool).toBe("request_callback");
    expect(f3.some((a) => a.type === "END_CALL")).toBe(true);
  });

  it("menu answer recovers the flow", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("uhh");
    sim.utter("hmm");
    const a = sim.utter("booking kavali");
    expect(sim.say(a)).toEqual(["ask_doctor"]);
    expect(sim.ctx.intent).toBe("BOOK");
  });
});

describe("clinical guardrail (§6 rule 8, I4)", () => {
  it("deflects a medical question and returns to the pending question", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("appointment kavali");
    // now at ask_doctor; caller asks for medicine instead
    const a = sim.utter("నాకు జ్వరం గా ఉంది, ఏదైనా medicine చెప్పండి");
    expect(sim.say(a)).toEqual(["medical_deflect", "ask_doctor"]);
    expect(sim.ctx.state).toBe("SLOT_FILL");
    expect(sim.ctx.slotFillField).toBe("doctor");
  });

  it("deflects even during the readback", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book with Ramesh");
    sim.utter("tomorrow");
    sim.toolOk("find_slots", { slots: [SLOT_A] });
    sim.utter("first");
    sim.utter("Suresh");
    sim.utter("9849123456");
    const a = sim.utter("fever tablet kuda kavali");
    expect(sim.say(a)).toEqual(["medical_deflect", "confirm_readback"]);
  });
});

describe("cancel & reschedule (§3 intents)", () => {
  it("cancel: phone → tool → confirmation", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    const a1 = sim.utter("naa appointment cancel cheyali");
    expect(sim.say(a1)).toEqual(["ask_phone_for_cancel"]);
    const a2 = sim.utter("9849123456");
    expect(sim.toolCalls(a2)[0]).toMatchObject({
      tool: "cancel_booking",
      input: { patient_phone: "+919849123456" },
    });
    const a3 = sim.toolOk("cancel_booking", { cancelled: true, doctor_name: "Dr. Ramesh", label: SLOT_A.label });
    expect(sim.say(a3)).toEqual(["cancel_confirmed", "anything_else"]);
  });

  it("cancel with multiple matches asks which appointment", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("cancel cheyandi");
    sim.utter("9849123456");
    const a = sim.toolFail("cancel_booking", "MULTIPLE_MATCHES", [SLOT_A, SLOT_B]);
    expect(sim.say(a)).toEqual(["ask_which_appointment"]);
    const pick = sim.utter("second");
    expect(sim.toolCalls(pick)[0]).toMatchObject({
      tool: "cancel_booking",
      input: { slot_start: SLOT_B.slot_start },
    });
  });

  it("reschedule: phone → new time → readback → tool", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    const a1 = sim.utter("appointment time change cheyagalara? Wednesday ki");
    expect(sim.say(a1)).toEqual(["ask_phone_for_reschedule"]);
    sim.utter("9849123456");
    sim.toolOk("find_slots", { slots: [SLOT_A, SLOT_B] });
    sim.utter("second option");
    const yes = sim.utter("avunu");
    expect(sim.toolCalls(yes)[0]).toMatchObject({
      tool: "reschedule_booking",
      input: { new_slot_start: SLOT_B.slot_start, patient_phone: "+919849123456" },
    });
  });
});

describe("INFO intent (I1: facts only from tools)", () => {
  it("fee question → get_clinic_info → summary carries the tool payload", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    const a1 = sim.utter("consultation fee entha?");
    expect(sim.toolCalls(a1)[0]?.tool).toBe("get_clinic_info");
    const info = { name: "Sri Venkateswara Clinic", doctors: [{ name: "Dr. Ramesh", consultation_fee_inr: 300 }] };
    const a2 = sim.toolOk("get_clinic_info", info);
    const summary = a2.find((a) => a.key === "info_summary");
    // the spoken line is assembled from the tool payload (I1), fee included
    expect(summary?.params?.infoLine).toBe("Consultation fee: Dr. Ramesh ₹300.");
    expect(sim.say(a2)).toEqual(["info_summary", "anything_else"]);
  });
});

describe("language mirroring (§6 rule 1)", () => {
  it.each([
    ["Hi, I'd like to book an appointment for my mother", "en"],
    ["నాకు అపాయింట్మెంట్ కావాలి", "te"],
    ["Saturday ki slot book cheyandi please", "mix"],
  ])("%s → %s", (text, lang) => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter(text);
    expect(sim.ctx.language).toBe(lang);
  });
});

describe("lexicon regressions (from review)", () => {
  it('"second one" selects the second slot, not the first', () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book with Ramesh");
    sim.utter("tomorrow");
    sim.toolOk("find_slots", { slots: [SLOT_A, SLOT_B] });
    sim.utter("the second one please");
    expect(sim.ctx.collected.chosenSlot?.slot_start).toBe(SLOT_B.slot_start);
  });

  it('"that\'s incorrect" at readback is a NO, not a YES (guards §6 rule 4)', () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book with Ramesh");
    sim.utter("tomorrow");
    sim.toolOk("find_slots", { slots: [SLOT_A] });
    sim.utter("first");
    sim.utter("Suresh");
    sim.utter("9849123456");
    const no = sim.utter("no that's incorrect");
    // must NOT proceed to consent/booking; asks for the correction instead
    expect(sim.say(no)).toEqual(["ask_correction"]);
    expect(sim.history.flat().some((a) => a.tool === "create_booking")).toBe(false);
  });

  it('a medical-sounding substring like "cold" in a normal answer is not deflected', () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book with Ramesh");
    // "could" and "cold" — must be treated as a datetime answer, not medical
    const a = sim.utter("could we do tomorrow");
    expect(sim.say(a)).not.toContain("medical_deflect");
    expect(sim.toolCalls(a)[0]?.tool).toBe("find_slots");
  });

  it("the third existing appointment is pickable in disambiguation", () => {
    const sim = new Sim();
    const SLOT_C = { ...SLOT_A, slot_start: "2026-07-15T04:30:00.000Z", label: "Wed, 15 July, 10:00 am" };
    sim.step({ type: "CALL_STARTED" });
    sim.utter("cancel cheyandi");
    sim.utter("9849123456");
    sim.toolFail("cancel_booking", "MULTIPLE_MATCHES", [SLOT_A, SLOT_B, SLOT_C]);
    const pick = sim.utter("the third one");
    expect(sim.toolCalls(pick)[0]).toMatchObject({
      tool: "cancel_booking",
      input: { slot_start: SLOT_C.slot_start },
    });
  });

  it("reschedule readback does not leak a {patientName} placeholder", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("reschedule my appointment");
    sim.utter("9849123456");
    sim.toolOk("find_slots", { slots: [SLOT_A, SLOT_B] });
    const rb = sim.utter("second");
    const say = rb.find((a) => a.type === "SAY");
    expect(say?.key).toBe("confirm_readback_reschedule");
    // the rendered line must not leak {patientName} (reschedule has no name slot)
    const rendered = renderLine(SCRIPT, "confirm_readback_reschedule", "en", say?.params ?? {});
    expect(rendered).not.toContain("{patientName}");
    expect(rendered).toContain(SLOT_B.label);
  });
});

describe("engine invariants", () => {
  it("never calls create_booking without confirmed=true (I1/§6 rule 4)", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.utter("book with Ramesh");
    sim.utter("tomorrow");
    sim.toolOk("find_slots", { slots: [SLOT_A] });
    sim.utter("first");
    sim.utter("Suresh");
    sim.utter("9849123456");
    sim.utter("yes");
    sim.utter("yes");
    const bookings = sim.history.flat().filter((a) => a.type === "CALL_TOOL" && a.tool === "create_booking");
    expect(bookings).toHaveLength(1);
    expect(bookings.every((b) => (b.input as { confirmed: boolean }).confirmed === true)).toBe(true);
  });

  it("reducer is pure — the input context is never mutated", () => {
    const sim = new Sim();
    const before = JSON.stringify(sim.ctx);
    reduce(sim.ctx, { type: "CALLER_UTTERANCE", text: "appointment kavali" });
    expect(JSON.stringify(sim.ctx)).toBe(before);
  });

  it("after END_CALL the machine goes quiet", () => {
    const sim = new Sim();
    sim.step({ type: "CALL_STARTED" });
    sim.step({ type: "SILENCE", seconds: 9 });
    expect(sim.ctx.ended).toBe(true);
    const a = sim.utter("hello?");
    expect(a).toEqual([]);
  });
});
