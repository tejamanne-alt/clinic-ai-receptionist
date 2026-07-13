import { z, type ZodTypeAny } from "zod";

/**
 * Minimal Zod → JSON Schema for the tool-definition surface. Kept tiny and
 * dependency-free because it only needs to cover the shapes our tool schemas
 * actually use (object/string/number/boolean/enum/optional/default). It is
 * exercised by tests against the real registry so an unsupported shape fails
 * loudly rather than silently emitting a bad schema.
 */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: string[];
  items?: JsonSchema;
  format?: string;
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  // peel optional/default/nullable wrappers
  for (;;) {
    const def = inner._def as { typeName?: string; innerType?: ZodTypeAny };
    if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault" || def.typeName === "ZodNullable") {
      optional = optional || def.typeName !== "ZodNullable";
      if (def.innerType) {
        inner = def.innerType;
        continue;
      }
    }
    break;
  }
  return { inner, optional };
}

export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string };

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const { inner, optional } = unwrap(value);
      properties[key] = toJsonSchema(inner);
      if (!optional) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) {
    const checks = (schema._def as { checks?: Array<{ kind: string }> }).checks ?? [];
    const out: JsonSchema = { type: "string" };
    if (checks.some((c) => c.kind === "datetime")) out.format = "date-time";
    if (checks.some((c) => c.kind === "uuid")) out.format = "uuid";
    return out;
  }
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: (schema._def as { values: string[] }).values };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: toJsonSchema((schema._def as { type: ZodTypeAny }).type) };
  }
  const { inner } = unwrap(schema);
  if (inner !== schema) return toJsonSchema(inner);
  throw new Error(`unsupported zod type in tool schema: ${def.typeName ?? "unknown"}`);
}
