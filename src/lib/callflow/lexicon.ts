import type { LanguageTag } from "../speech/types";
import type { Intent } from "./types";

/**
 * Deterministic parsers over caller utterances. These power the state
 * machine's tests and the server-side guard; the runtime LLM does richer
 * understanding, but nothing the LLM claims can bypass these guards on the
 * tool side (I5). Caller text is data — these functions only classify it.
 *
 * R5 reality: Tenglish is the norm, so every lexicon carries Telugu script,
 * romanized Telugu, and English forms.
 */

const TELUGU_SCRIPT = /[ఀ-౿]/;
const LATIN = /[a-zA-Z]/;

const ROMAN_TELUGU_HINTS = [
  "kavali", "cheyandi", "cheyali", "chey", "unnaya", "unnara", "entha", "enti",
  "repu", "ippudu", "garu", "andi", "ledu", "kaadu", "avunu", "vaddu",
  "cheppandi", "cheskondi", "dorukutunda", "matladacha", "ki ", "lo ", "ga ",
];

export function detectLanguage(text: string): LanguageTag {
  const t = text.toLowerCase();
  const hasTelugu = TELUGU_SCRIPT.test(t);
  const hasLatin = LATIN.test(t);
  if (hasTelugu && hasLatin) return "mix";
  if (hasTelugu) return "te";
  const romanHits = ROMAN_TELUGU_HINTS.filter((w) => t.includes(w)).length;
  if (romanHits >= 1 && hasLatin) return "mix";
  return "en";
}

const CANCEL_WORDS = ["cancel", "రద్దు", "raddu", "vaddu appointment", "cancil"];
const RESCHEDULE_WORDS = [
  "reschedule", "postpone", "change", "shift", "మార్చ", "marchali", "marchandi",
  "time change", "vere time", "vere roju",
];
const BOOK_WORDS = [
  "book", "appointment", "slot", "అపాయింట్మెంట్", "బుక్", "kavali", "dorukutunda",
  "free slots", "available",
];
const INFO_WORDS = [
  "fee", "fees", "charge", "cost", "entha", "ఎంత", "timing", "timings", "open",
  "close", "address", "ekkada", "ఎక్కడ", "సమయం", "directions", "location",
];
const FALLBACK_WORDS = [
  "matladacha", "matladali", "మాట్లాడ", "talk to doctor", "speak to doctor",
  "line lo", "call back", "callback", "human", "staff", "receptionist please",
];

function hasAny(text: string, words: readonly string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

/** Priority: cancel/reschedule beat book ("cancel my appointment" contains "appointment"). */
export function parseIntent(text: string): Intent | null {
  if (hasAny(text, CANCEL_WORDS)) return "CANCEL";
  if (hasAny(text, RESCHEDULE_WORDS)) return "RESCHEDULE";
  if (hasAny(text, FALLBACK_WORDS)) return "FALLBACK";
  if (hasAny(text, INFO_WORDS)) return "INFO";
  if (hasAny(text, BOOK_WORDS)) return "BOOK";
  return null;
}

const MEDICAL_WORDS = [
  "jwaram", "జ్వరం", "fever", "medicine", "mandu", "మందు", "tablet", "dose",
  "pain", "నొప్పి", "noppi", "symptom", "prescri", "treatment", "sick",
  "vanthulu", "వాంతులు", "cold", "cough", "daggu", "దగ్గు", "bp ", "sugar level",
];

/** I4: any request for medical guidance gets the scripted deflection. */
export function isMedicalQuestion(text: string): boolean {
  return hasAny(text, MEDICAL_WORDS);
}

const YES_WORDS = [
  "yes", "yeah", "yep", "avunu", "అవును", "sare", "సరే", "ok", "okay", "correct",
  "right", "haan", "ha ", "confirm", "cheyandi", "book cheyandi", "sure",
];
const NO_WORDS = ["no", "kaadu", "కాదు", "vaddu", "వద్దు", "nahi", "not", "wrong", "cancel"];

export function parseYesNo(text: string): boolean | null {
  const t = ` ${text.toLowerCase().trim()} `;
  // "no" checked first: "no no correct kaadu" is a refusal
  if (NO_WORDS.some((w) => t.includes(w))) return false;
  if (YES_WORDS.some((w) => t.includes(w))) return true;
  return null;
}

/** Extract a dialable phone number from spoken/transcribed digits. */
export function extractPhoneDigits(text: string): string | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 10 || digits.length > 14) return null;
  return digits;
}

const ANY_DOCTOR_WORDS = ["any", "evaraina", "ఎవరైనా", "evarina", "anyone", "whoever", "chalu"];

/** Match a doctor mention against the clinic's roster; "any" is §6-legal. */
export function parseDoctorChoice(
  text: string,
  doctors: ReadonlyArray<{ id: string; name: string }>,
): { id: string | "any"; name?: string } | null {
  const t = text.toLowerCase();
  for (const d of doctors) {
    const surname = d.name.toLowerCase().replace(/^dr\.?\s*/, "");
    const parts = surname.split(/\s+/).filter((p) => p.length >= 3);
    if (parts.some((p) => t.includes(p))) return { id: d.id, name: d.name };
  }
  if (hasAny(text, ANY_DOCTOR_WORDS)) return { id: "any" };
  return null;
}

const FIRST_WORDS = ["first", "mondati", "మొదటి", "one", "1", "okati", "ఒకటి"];
const SECOND_WORDS = ["second", "rendodi", "రెండో", "two", "2", "rendu", "రెండు"];

/** Which of the ≤2 offered slots did the caller pick? */
export function parseOptionChoice(text: string, optionLabels: readonly string[]): number | null {
  const t = text.toLowerCase();
  for (let i = 0; i < optionLabels.length; i++) {
    const label = optionLabels[i];
    if (!label) continue;
    // match on a distinctive fragment of the label (e.g. "10:15 am" or weekday)
    const fragments = label.toLowerCase().split(/[,\s]+/).filter((f) => f.length >= 3);
    if (fragments.some((f) => t.includes(f))) return i;
  }
  if (hasAny(text, FIRST_WORDS)) return 0;
  if (hasAny(text, SECOND_WORDS) && optionLabels.length > 1) return 1;
  return null;
}

/** Strip lead-ins so "naa peru Ramesh" / "my name is Ramesh" → "Ramesh". */
export function extractName(text: string): string | null {
  const cleaned = text
    .replace(/\b(my name is|name is|this is|i am|i'm)\b/gi, " ")
    .replace(/(నా పేరు|naa peru|na peru|peru)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 120) return null;
  return cleaned;
}
