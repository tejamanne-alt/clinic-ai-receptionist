import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOL_REGISTRY } from "../tools";
import { toJsonSchema } from "./schema-to-json";

/**
 * Builds the Vapi assistant definition from versioned prompt files (R3) and
 * the tool registry (I1). No spoken strings or tool shapes are duplicated
 * here — this is pure assembly, so the assistant can never drift from the
 * code that actually runs the tools.
 */

export interface AssistantBuildOptions {
  clinicId: string;
  clinicName: string;
  today: string;
  /** absolute webhook URL Vapi calls for tool execution + events */
  serverUrl: string;
  voiceModel?: string;
}

function loadSystemPrompt(opts: AssistantBuildOptions): string {
  const file = path.join(process.cwd(), "prompts", "voice", "system.md");
  const raw = readFileSync(file, "utf8");
  // strip the metadata/header block; keep everything from the first heading
  const body = raw.slice(raw.indexOf("# Vaani"));
  return body
    .replaceAll("{clinicName}", opts.clinicName)
    .replaceAll("{clinicId}", opts.clinicId)
    .replaceAll("{today}", opts.today);
}

export function buildToolDefinitions() {
  return Object.entries(TOOL_REGISTRY).map(([name, entry]) => ({
    type: "function" as const,
    function: {
      name,
      description: entry.description,
      parameters: toJsonSchema(entry.schema),
    },
  }));
}

export function buildAssistant(opts: AssistantBuildOptions) {
  return {
    name: `Vaani · ${opts.clinicName}`,
    firstMessageMode: "assistant-speaks-first" as const,
    // Language mirroring happens in-model; the STT provider auto-detects te/en/mix.
    transcriber: {
      provider: "azure",
      language: "te-IN",
    },
    model: {
      provider: "openai",
      model: opts.voiceModel ?? "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "system" as const, content: loadSystemPrompt(opts) }],
      tools: buildToolDefinitions(),
    },
    voice: {
      // Sarvam Bulbul is the Phase-0 shortlist primary; Azure te-IN is the
      // documented fallback. Final default set by the bake-off (§4).
      provider: "azure",
      voiceId: "te-IN-ShrutiNeural",
    },
    server: { url: opts.serverUrl },
    // §6 rules 6 & 9: barge-in on, short silence windows.
    startSpeakingPlan: { waitSeconds: 0.4 },
    stopSpeakingPlan: { numWords: 1 },
    silenceTimeoutSeconds: 10,
    maxDurationSeconds: 600,
    metadata: { clinicId: opts.clinicId },
  };
}
