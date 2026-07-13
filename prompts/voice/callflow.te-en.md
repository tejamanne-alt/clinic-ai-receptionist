version: 1.0-draft
status: PENDING TEJA REVIEW — human gate per §6; do not treat as final tone
class: VOICE (I3 — never blended with ANALYSIS or EXTRACTION)

# Vaani call-flow script · Telugu / English

Every line the receptionist can speak, keyed to the state machine
(`src/lib/callflow/machine.ts`). `{placeholders}` are filled ONLY from tool
results or the caller's own words (I1). Language selection mirrors the caller
from turn 1: `te` lines for Telugu/Tenglish callers (code-mix is the norm —
these lines deliberately keep everyday English words), `en` for English
callers. `tests/script.test.ts` fails if any engine key is missing here.

## greeting
- te: నమస్తే, {clinicName}! నేను వాణి, క్లినిక్ receptionist. Appointment బుక్ చేయాలా, లేక వేరే ఏదైనా సహాయం కావాలా?
- en: Hello, welcome to {clinicName}! This is Vaani, the clinic receptionist. Would you like to book an appointment, or is there something else I can help with?

## ask_intent_menu
- te: క్షమించండి, నాకు సరిగ్గా అర్థం కాలేదు. మీరు ఇలా చెప్పవచ్చు: ఒకటి — కొత్త appointment బుక్ చేయడం. రెండు — ఉన్న appointment cancel లేదా change చేయడం. మూడు — clinic timings, fees వివరాలు. ఏది కావాలి?
- en: Sorry, I didn't quite catch that. You can say: one — book a new appointment. Two — cancel or change an existing appointment. Three — clinic timings and fees. Which would you like?

## ask_doctor
- te: ఏ డాక్టర్ గారి దగ్గర appointment కావాలి? మా దగ్గర {doctors} ఉన్నారు. ఎవరైనా doctor అయినా పర్వాలేదు అంటే అలా చెప్పండి.
- en: Which doctor would you like to see? We have {doctors}. If any doctor is fine, just say so.

## ask_datetime
- te: ఏ రోజు, ఏ time convenient గా ఉంటుంది? ఉదాహరణకి — రేపు morning, లేదా Saturday evening.
- en: What day and time works for you? For example — tomorrow morning, or Saturday evening.

## offer_slots
- te: ఈ slots available గా ఉన్నాయి: {options}. ఏది తీసుకుంటారు?
- en: These slots are available: {options}. Which one would you like?

## offer_alternatives
- te: Sorry అండి, ఆ time కి slot లేదు. దగ్గరలో ఇవి ఉన్నాయి: {options}. ఏది convenient?
- en: Sorry, that slot just got taken. The nearest available options are: {options}. Which works for you?

## no_slots_offer_callback
- te: క్షమించండి, ఆ time దగ్గరలో slots ఏమీ కనబడటం లేదు. మా staff మీకు call back చేసి slot fix చేస్తారు, సరేనా?
- en: I'm sorry, I don't see any open slots around that time. Our staff will call you back to fix a slot, alright?

## ask_name
- te: Patient పేరు ఏమిటి?
- en: May I have the patient's name, please?

## ask_phone
- te: మీ phone number చెప్పండి, digit by digit.
- en: Please tell me your phone number, digit by digit.

## phone_reask
- te: ఆ number సరిగ్గా రాలేదు అనిపిస్తోంది. మరోసారి, నెమ్మదిగా digit by digit చెప్పగలరా?
- en: I didn't get that number correctly. Could you repeat it slowly, digit by digit?

## confirm_readback
- te: Confirm చేస్తున్నాను: {patientName} గారికి, {doctorName} గారితో, {label} కి appointment. మీ number {phonePairs}. అంతా correct ఏనా?
- en: Let me confirm: an appointment for {patientName}, with {doctorName}, on {label}. Your number is {phonePairs}. Is everything correct?

## confirm_readback_reschedule
- te: Confirm చేస్తున్నాను: {doctorName} గారితో, {label} కి appointment మార్చుతున్నాను. Correct ఏనా?
- en: Let me confirm: moving your appointment with {doctorName} to {label}. Is that correct?

## ask_consent
- te: Booking confirmation ని WhatsApp లో పంపమంటారా? మీ అనుమతి ఉంటేనే పంపుతాము.
- en: Would you like the booking confirmation on WhatsApp? We'll only send it with your permission.

## booked_confirm
- te: మీ appointment confirm అయ్యింది — {label}, {doctorName} గారితో. ధన్యవాదాలు!
- en: Your appointment is confirmed — {label} with {doctorName}. Thank you!

## whatsapp_will_send
- te: Confirmation మీకు WhatsApp లో వస్తుంది.
- en: You'll receive the confirmation on WhatsApp.

## ask_correction
- te: సరే, ఏం మార్చాలో చెప్పండి — వేరే రోజు లేదా time చెప్పినా చాలు.
- en: No problem — tell me what to change. You can just say a different day or time.

## info_summary
- te: {infoLine}
- en: {infoLine}

## anything_else
- te: ఇంకా ఏమైనా సహాయం కావాలా?
- en: Is there anything else I can help you with?

## ask_phone_for_cancel
- te: సరే, cancel చేయడానికి — booking చేసిన phone number చెప్పండి.
- en: Sure, to cancel — please tell me the phone number the booking was made with.

## ask_phone_for_reschedule
- te: సరే, time మార్చడానికి — booking చేసిన phone number చెప్పండి.
- en: Sure, to reschedule — please tell me the phone number the booking was made with.

## ask_which_appointment
- te: మీ number మీద ఇవి ఉన్నాయి: {options}. ఏది అనుకుంటున్నారు?
- en: I found these on your number: {options}. Which one do you mean?

## cancel_confirmed
- te: మీ appointment cancel అయ్యింది — {label}, {doctorName} గారితో ఉన్నది. Slot వేరే వాళ్ళకి ఇవ్వబడుతుంది.
- en: Your appointment has been cancelled — the one on {label} with {doctorName}.

## no_appointment_found
- te: ఆ number మీద రాబోయే appointment ఏదీ కనబడలేదు. Number మరోసారి check చేసి చెప్పగలరా?
- en: I couldn't find any upcoming appointment on that number. Could you double-check the number?

## medical_deflect
- te: అది డాక్టర్ గారు consultation లో చెప్తారు — నేను appointment book చేయగలను.
- en: The doctor will advise on that during the consultation — what I can do is book you an appointment.

## clarify
- te: క్షమించండి, మరోసారి చెప్పగలరా?
- en: Sorry, could you say that again?

## escalate_promise
- te: క్షమించండి, నేను సరిగ్గా అర్థం చేసుకోలేకపోతున్నాను. మా staff లో ఒకరు మీకు త్వరలో call చేస్తారు — ఇది ఖచ్చితంగా జరుగుతుంది.
- en: I'm sorry, I'm not understanding you well. One of our staff will call you back shortly — I've noted it down.

## silence_reprompt
- te: వినబడుతున్నారా? నేను వింటున్నాను, చెప్పండి.
- en: Are you there? I'm listening, please go ahead.

## silence_callback
- te: Line లో సమస్య ఉన్నట్టు ఉంది. మా staff మీకు call back చేస్తారు. కాల్ చేసినందుకు ధన్యవాదాలు!
- en: It seems the line is having trouble. Our staff will call you back. Thank you for calling!

## tool_error_apology
- te: క్షమించండి, system లో చిన్న సమస్య వచ్చింది.
- en: I'm sorry, there was a small technical problem on our side.

## goodbye
- te: మంచి రోజు అవ్వాలి, నమస్తే!
- en: Have a great day, goodbye!

---

# Flow notes (for reviewers, not spoken)

- §6 rule 2 slot-fill order: doctor → date/time → name → phone; one question per turn.
- `confirm_readback` MUST get an explicit yes before `create_booking` fires (rule 4). "సరే" / "అవును" / "yes" count; anything unclear re-asks.
- `ask_consent` runs before booking so the consent boolean is stored on the booking and message (rule 5, I7).
- `medical_deflect` is the ONLY response to medical content, in any state (I4); the flow then repeats the pending question (rule 8).
- Silence: `silence_reprompt` once around 4s; `silence_callback` + callback_request + warm close around 8s (rule 6).
- Two failed parses → `ask_intent_menu`; a third → `escalate_promise` + callback_request (rule 7).
- `{options}`, `{label}`, fees and timings placeholders may only carry tool-result values (I1). The voice model must never speak an availability, price, or timing that is not in the current tool payload.
