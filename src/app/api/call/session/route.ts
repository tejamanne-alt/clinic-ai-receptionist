import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

/**
 * Mints the browser-call configuration. I2: the Vapi PUBLIC key (safe to
 * expose — it can only start calls, not read data) and the assistant id go
 * to the client; the private key and all provider keys stay server-side.
 * The clinic is resolved server-side, never taken from the client.
 */
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const publicKey = process.env.VAPI_PUBLIC_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!publicKey || !assistantId) {
    return NextResponse.json(
      {
        error: "voice_not_configured",
        message:
          "Set VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID (run scripts/vapi/sync-assistant.ts) to enable the browser call.",
      },
      { status: 503 },
    );
  }

  // Demo: bind the browser call to the seeded demo clinic. In production this
  // comes from the authenticated session, not user input.
  let clinicId = process.env.DEMO_CLINIC_ID ?? "00000000-0000-0000-0000-000000000001";
  let clinicName = "Vaani demo clinic";
  try {
    const { rows } = await getPool().query<{ id: string; name: string }>(
      `select id, name from public.clinics where id = $1`,
      [clinicId],
    );
    if (rows[0]) {
      clinicId = rows[0].id;
      clinicName = rows[0].name;
    }
  } catch {
    // DB not reachable in a pure front-end demo — still return the keys.
  }

  return NextResponse.json({
    publicKey,
    assistantId,
    // metadata rides along on the call so the webhook can trust clinic scope
    metadata: { clinicId },
    clinicName,
  });
}
