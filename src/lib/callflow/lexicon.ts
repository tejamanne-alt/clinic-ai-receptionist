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

/** Substring match — used for INTENT keywords where Telugu agglutination
 * ("appointmentki", "slotki") means we WANT prefix/substring hits, and a
 * false positive is corrected by the subsequent slot-fill anyway. */
function hasAny(text: string, words: readonly string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

const LATIN_ONLY = /^[a-z0-9 ']+$/;

/**
 * Boundary-aware match — used where precision matters (yes/no, ordinals,
 * medical). For Latin/romanized keywords it requires word boundaries, so
 * "correct" no longer matches inside "incorrect" and "cold" no longer
 * matches inside "could". For Telugu-script keywords it falls back to
 * substring, since Telugu suffixes attach to the stem ("జ్వరంగా" ⊇ "జ్వరం").
 */
function hasWord(text: string, word: string): boolean {
  const t = text.toLowerCase();
  const w = word.toLowerCase();
  if (LATIN_ONLY.test(w)) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(t);
  }
  return t.includes(w);
}

function hasWordAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => hasWord(text, w));
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

/** I4: any request for medical guidance gets the scripted deflection.
 * Boundary-aware so "cold"/"pain"/"dose"/"bp" don't fire inside unrelated
 * words (e.g. a doctor surname or "I want a cold-drink slot"). */
export function isMedicalQuestion(text: string): boolean {
  return hasWordAny(text, MEDICAL_WORDS);
}

const YES_WORDS = [
  "yes", "yeah", "yep", "avunu", "అవును", "sare", "సరే", "ok", "okay", "correct",
  "right", "haan", "confirm", "cheyandi", "sure",
];
const NO_WORDS = [
  "no", "kaadu", "కాదు", "vaddu", "వద్దు", "nahi", "not", "wrong", "cancel",
  "incorrect", "change",
];

/**
 * Boundary-aware so "incorrect" is not read as "correct"→yes (which would
 * defeat the §6-rule-4 readback gate) and "cannot" is not read as "no". "no"
 * is checked first so a refusal that also contains a stray affirmative
 * ("no, that's not correct") resolves to false; genuinely ambiguous input
 * returns null and the caller is re-asked.
 */
export function parseYesNo(text: string): boolean | null {
  if (hasWordAny(text, NO_WORDS)) return false;
  if (hasWordAny(text, YES_WORDS)) return true;
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
  if (hasWordAny(text, ANY_DOCTOR_WORDS)) return { id: "any" };
  return null;
}

// Ordinals for slot/appointment choice. Checked most-specific first so an
// incidental "one" in "the second one" never wins over "second".
const ORDINALS: ReadonlyArray<{ index: number; words: readonly string[] }> = [
  { index: 2, words: ["third", "moodo", "మూడో", "moodavadi", "three", "3", "మూడు"] },
  { index: 1, words: ["second", "rendodi", "రెండో", "rendavadi", "two", "2", "rendu", "రెండు"] },
  { index: 0, words: ["first", "mondati", "మొదటి", "okati", "ఒకటి", "one", "1"] },
];

/**
 * Which of the offered options (≤3) did the caller pick? Distinctive label
 * fragments (e.g. "10:15") win first; otherwise ordinals, evaluated
 * third→second→first so "the second one" selects index 1, not 0.
 */
export function parseOptionChoice(text: string, optionLabels: readonly string[]): number | null {
  const t = text.toLowerCase();
  for (let i = 0; i < optionLabels.length; i++) {
    const label = optionLabels[i];
    if (!label) continue;
    // distinctive fragments only (times like "10:15"; skip shared weekday/month)
    const fragments = label
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((f) => f.length >= 3 && /[0-9:]/.test(f));
    if (fragments.some((f) => t.includes(f))) return i;
  }
  for (const { index, words } of ORDINALS) {
    if (index < optionLabels.length && hasWordAny(text, words)) return index;
  }
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
