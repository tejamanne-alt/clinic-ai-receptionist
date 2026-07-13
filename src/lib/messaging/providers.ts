import type { MessagingProvider, SendResult, WhatsAppMessage } from "./types";

/** Gupshup WhatsApp template send. */
export const gupshupProvider: MessagingProvider = {
  name: "gupshup",
  isConfigured: () => Boolean(process.env.GUPSHUP_API_KEY && process.env.GUPSHUP_SOURCE_NUMBER),
  async send(message: WhatsAppMessage): Promise<SendResult> {
    const apiKey = process.env.GUPSHUP_API_KEY;
    const source = process.env.GUPSHUP_SOURCE_NUMBER;
    const appName = process.env.GUPSHUP_APP_NAME ?? "";
    if (!apiKey || !source) throw new Error("Gupshup not configured");

    const form = new URLSearchParams({
      channel: "whatsapp",
      source,
      destination: message.toPhone.replace(/^\+/, ""),
      "src.name": appName,
      template: JSON.stringify({ id: message.templateName, params: message.variables }),
    });

    const res = await fetch("https://api.gupshup.io/wa/api/v1/template/msg", {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Gupshup HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = (await res.json()) as { messageId?: string; status?: string };
    return { providerMessageId: data.messageId ?? "unknown", status: "sent" };
  },
};

/**
 * Console provider — the default in dev/demo so the booking flow is fully
 * exercisable without a paid WhatsApp number. It records to stdout and
 * returns a synthetic id; the message row is still written with consent
 * checked, so the audit trail is identical to a real send.
 */
export const consoleProvider: MessagingProvider = {
  name: "console",
  isConfigured: () => true,
  async send(message: WhatsAppMessage): Promise<SendResult> {
    console.log(`[whatsapp:console] → ${message.toPhone}: ${message.body}`);
    return { providerMessageId: `console-${Date.now().toString(36)}`, status: "sent" };
  },
};

export function selectProvider(): MessagingProvider {
  if (gupshupProvider.isConfigured()) return gupshupProvider;
  return consoleProvider;
}
