// What a fee or cost IS, on a case — and whether it is the kind of thing you spend TIME on.
//
// This was a four-option dropdown (correspondency / third party / disbursement / other).
// A club's matters do not fit four boxes: a launch hire, a courier, a police report fee and
// a diver's invoice are all different things and only one of them is a "disbursement".
// So the field is free text now, with suggestions — exactly like the case type above it.
//
// The four old keys are still in the database on rows written before this, so
// chargeKindLabel() maps them and leaves anything else exactly as it was typed.
//
// isTimeKind() is the interesting one. A phone call is not a cost, it is TIME, and time
// on a case belongs in Attendances where it can be priced and claimed by the hour. Type
// "Phone call" here and the form stops asking for an amount and asks how long and when —
// then files it as an attendance, in your name, the same as the quick buttons do.

/** Offered in the datalist. Costs first, then the things that are really time. */
export const CHARGE_KIND_SUGGESTIONS = [
  'Correspondency fee',
  'Third party / contractor',
  'Disbursement',
  'Launch hire',
  'Travel',
  'Courier',
  'Phone call',
  'Email',
  'Meeting',
  'Site attendance',
]

/** Written before the field was free text (migrations 208–218). */
const LEGACY: Record<string, string> = {
  correspondency: 'Correspondency fee',
  third_party: 'Third party / contractor',
  disbursement: 'Disbursement',
  other: 'Other',
}

/** What to show for a stored kind. Legacy keys get their old label; free text is its
 *  own label and is never reinterpreted. */
export function chargeKindLabel(kind: string | null | undefined): string {
  const raw = (kind ?? '').trim()
  if (raw === '') return 'Other'
  return LEGACY[raw.toLowerCase()] ?? raw
}

// Matched WHOLE WORD, so "Call-out" counts and "Recalled documents" does not. The list is
// deliberately short: every word on it has to mean time and nothing else, because getting
// it wrong files a cost on the wrong card.
const TIME_WORDS = new Set([
  'phone', 'call', 'calls', 'email', 'emails', 'mail', 'meeting', 'meetings',
  'attendance', 'attending', 'conference', 'zoom', 'teams', 'whatsapp',
  'discussion', 'visit', 'interview', 'hearing',
])

/** Does this describe time spent rather than money paid out? */
export function isTimeKind(kind: string | null | undefined): boolean {
  // Split on anything that is not a letter, so "e-mail" gives "mail" and "call-out" gives
  // "call". "mail" is on the list for that reason; postage is typed "Postage" or "Courier".
  return (kind ?? '').toLowerCase().split(/[^a-z]+/).some(w => TIME_WORDS.has(w))
}
