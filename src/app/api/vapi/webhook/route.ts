import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleVapiMessage, type VapiMessage } from "@/lib/vapi/webhook";

/**
 * Vapi server webhook. All tool execution happens here, server-side (I2) —
 * the browser never touches Postgres or provider keys. When
 * VAPI_WEBHOOK_SECRET is set we verify Vapi's signature before doing any work.
 */
export const runtime = "nodejs";

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return true; // unset in local dev; required in prod (documented)
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-vapi-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { message?: VapiMessage };
  try {
    payload = JSON.parse(rawBody) as { message?: VapiMessage };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!payload.message) {
    return NextResponse.json({ error: "missing message" }, { status: 400 });
  }

  try {
    const result = await handleVapiMessage(payload.message);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[vapi webhook]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
