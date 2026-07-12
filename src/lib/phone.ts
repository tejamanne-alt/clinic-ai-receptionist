/**
 * Phone-number utilities (§5 data contract: numbers are normalized to E.164
 * before storage; §6 rule 2: digits are read back to callers in pairs).
 */

const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Normalize a raw phone string (as dictated by a caller or typed by staff)
 * to E.164. Returns null when the input cannot be normalized safely —
 * callers of this function must treat null as "re-ask", never guess.
 *
 * Defaults to India (+91): bare 10-digit mobiles (6–9 prefix) and
 * 0-trunk-prefixed variants are accepted.
 */
export function normalizeToE164(raw: string, defaultCountryCode = "91"): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.length === 0) return null;

  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) return E164.test(s) ? s : null;
  if (!/^[0-9]+$/.test(s)) return null;

  // strip trunk zeros ("098491...")
  s = s.replace(/^0+/, "");

  if (defaultCountryCode === "91") {
    if (/^[6-9][0-9]{9}$/.test(s)) return `+91${s}`;
    if (/^91[6-9][0-9]{9}$/.test(s)) return `+${s}`;
    return null;
  }

  const candidate = `+${defaultCountryCode}${s}`;
  return E164.test(candidate) ? candidate : null;
}

/**
 * Format a number's digits in pairs for voice read-back
 * ("9849123456" → "98 49 12 34 56"). Pass national digits only if the
 * country code should not be read back; an odd count leaves a final single.
 */
export function formatDigitsInPairs(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  const pairs = digits.match(/[0-9]{1,2}/g);
  return pairs ? pairs.join(" ") : "";
}
