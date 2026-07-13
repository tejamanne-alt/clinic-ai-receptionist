import type { LanguageTag } from "../speech/types";
import type { ScriptKey } from "./types";

/**
 * Loader for prompts/voice/callflow.te-en.md (R3: spoken lines live in the
 * versioned prompt file, never in code). The engine emits ScriptKeys; this
 * resolves them to reviewed text. `mix` callers get the `te` lines — they
 * are written as natural Tenglish code-mix.
 */

export type ScriptTable = Record<string, { te: string; en: string }>;

const SECTION = /^##\s+([a-z_]+)\s*$/;
const LINE = /^-\s+(te|en):\s+(.+)$/;

export function parseScript(markdown: string): ScriptTable {
  const table: ScriptTable = {};
  let current: string | null = null;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ") || line === "---") {
      current = null; // notes sections are not speakable
      continue;
    }
    const section = SECTION.exec(line);
    if (section?.[1]) {
      current = section[1];
      table[current] = table[current] ?? { te: "", en: "" };
      continue;
    }
    const entry = LINE.exec(line);
    if (current && entry?.[1] && entry[2]) {
      const slot = table[current];
      if (slot) slot[entry[1] as "te" | "en"] = entry[2].trim();
    }
  }
  return table;
}

/** Fill {placeholders}; missing params stay visible as {name} so tests catch them. */
export function renderLine(
  table: ScriptTable,
  key: ScriptKey,
  language: LanguageTag,
  params: Record<string, unknown> = {},
): string {
  const entry = table[key];
  if (!entry) throw new Error(`script line missing for key "${key}"`);
  const text = language === "en" ? entry.en : entry.te;
  return text.replace(/\{([a-zA-Z_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return whole;
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === "object" && v !== null && "label" in v ? String((v as { label: unknown }).label) : String(v)))
        .join(", ");
    }
    return String(value);
  });
}
