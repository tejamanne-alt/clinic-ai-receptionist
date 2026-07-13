import { describe, expect, it } from "vitest";
import { buildToolDefinitions } from "../src/lib/vapi/assistant";
import { toJsonSchema } from "../src/lib/vapi/schema-to-json";
import {
  cancelBookingInput,
  createBookingInput,
  findSlotsInput,
} from "../src/lib/tools/schemas";

describe("zod → JSON Schema for tool definitions", () => {
  it("converts create_booking with correct required/optional split", () => {
    const schema = toJsonSchema(createBookingInput);
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    // required: fields with no default/optional
    expect(schema.required).toContain("clinic_id");
    expect(schema.required).toContain("patient_name");
    expect(schema.required).toContain("slot_start");
    // .default(false) makes these optional in the tool interface
    expect(schema.required).not.toContain("confirmed");
    expect(schema.required).not.toContain("whatsapp_consent");
    expect(schema.required).not.toContain("call_id");
    // formats propagate so the model emits valid values
    expect(schema.properties?.clinic_id?.format).toBe("uuid");
    expect(schema.properties?.slot_start?.format).toBe("date-time");
  });

  it("marks doctor_id optional in find_slots", () => {
    const schema = toJsonSchema(findSlotsInput);
    expect(schema.required).toContain("clinic_id");
    expect(schema.required).not.toContain("doctor_id");
    expect(schema.required).not.toContain("limit"); // has a default
  });

  it("keeps phone as a plain string in cancel", () => {
    const schema = toJsonSchema(cancelBookingInput);
    expect(schema.properties?.patient_phone?.type).toBe("string");
  });

  it("produces a definition for every registered tool", () => {
    const defs = buildToolDefinitions();
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "find_slots",
        "create_booking",
        "cancel_booking",
        "reschedule_booking",
        "get_clinic_info",
        "request_callback",
      ]),
    );
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.function.description.length).toBeGreaterThan(10);
      expect(d.function.parameters.type).toBe("object");
    }
  });
});
