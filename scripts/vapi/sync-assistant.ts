/**
 * Create/update the Vapi assistant from our prompt files + tool registry.
 *
 * Usage:
 *   VAPI_PRIVATE_KEY=... PUBLIC_BASE_URL=https://xxx.ngrok.app \
 *     pnpm tsx scripts/vapi/sync-assistant.ts [--clinic <uuid>] [--name "Clinic"]
 *
 * Prints the assistant id to put in VAPI_ASSISTANT_ID. The webhook URL is
 * PUBLIC_BASE_URL + /api/vapi/webhook. Idempotent when VAPI_ASSISTANT_ID is
 * already set (updates in place).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { buildAssistant } from "../../src/lib/vapi/assistant";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      clinic: { type: "string", default: process.env.DEMO_CLINIC_ID ?? "00000000-0000-0000-0000-000000000001" },
      name: { type: "string", default: "Vaani demo clinic" },
    },
  });

  const privateKey = process.env.VAPI_PRIVATE_KEY;
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!privateKey || !baseUrl) {
    console.error("Set VAPI_PRIVATE_KEY and PUBLIC_BASE_URL (public https URL of this app).");
    process.exitCode = 1;
    return;
  }

  const assistant = buildAssistant({
    clinicId: values.clinic ?? "",
    clinicName: values.name ?? "Vaani demo clinic",
    today: new Date().toISOString().slice(0, 10),
    serverUrl: `${baseUrl.replace(/\/$/, "")}/api/vapi/webhook`,
  });

  const existing = process.env.VAPI_ASSISTANT_ID;
  const url = existing ? `https://api.vapi.ai/assistant/${existing}` : "https://api.vapi.ai/assistant";
  const method = existing ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
    body: JSON.stringify(assistant),
  });
  if (!res.ok) {
    console.error(`Vapi ${method} failed: HTTP ${res.status}\n${(await res.text()).slice(0, 500)}`);
    process.exitCode = 1;
    return;
  }
  const data = (await res.json()) as { id?: string };
  console.log(`✅ assistant ${existing ? "updated" : "created"}: ${data.id}`);
  console.log(`   webhook: ${baseUrl.replace(/\/$/, "")}/api/vapi/webhook`);
  if (!existing) console.log(`   → set VAPI_ASSISTANT_ID=${data.id} in .env`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
