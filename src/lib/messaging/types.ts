/**
 * MessagingProvider adapter (§4). WhatsApp vendors (Gupshup / MSG91) sit
 * behind this interface so the confirmation flow never binds to one vendor.
 * Keys are server-side only (I2).
 */
export interface WhatsAppMessage {
  toPhone: string; // E.164
  templateName: string;
  /** ordered template variables */
  variables: string[];
  /** human-readable body stored for the dashboard/audit */
  body: string;
}

export interface SendResult {
  providerMessageId: string;
  status: "sent" | "queued";
}

export interface MessagingProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: WhatsAppMessage): Promise<SendResult>;
}
