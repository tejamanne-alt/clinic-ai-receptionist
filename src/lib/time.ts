/** Clinic-local formatting for slot times. All storage is UTC timestamptz. */

export const CLINIC_TZ = "Asia/Kolkata";

const labelFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: CLINIC_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "Monday, 14 July, 10:15 am" — deterministic, fed to the voice layer so
 * the LLM never invents its own date arithmetic (I1). */
export function slotLabel(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return labelFormat.format(d);
}
