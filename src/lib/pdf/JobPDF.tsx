import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Link,
} from '@react-pdf/renderer'
import { formatDiffPercentage, isSurveyedVesselNameField, withVesselPrefix } from '@/lib/utils'
import { instanceKey } from '@/lib/offline/instanceKeys'
import { presentInstances, resolveEntryOrderFromData } from '@/lib/checklist/entryOrder'
import { reviewChecklist } from '@/lib/checklist/review'
import { answerColor, answerBadgeText, isAnswerFamily } from '@/lib/checklist/answerOptions'
import { COMPANY } from '@/lib/company'

const YES_NO_BG: Record<string, string> = { green: '#dcfce7', red: '#fee2e2', gray: '#f1f5f9', amber: '#fef3c7' }
const YES_NO_FG: Record<string, string> = { green: '#166534', red: '#991b1b', gray: '#94a3b8', amber: '#92400e' }

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: '#1e293b',
    paddingTop: 28,
    paddingBottom: 44,
    paddingLeft: 30,
    paddingRight: 30,
  },
  // pdf_tight_page_bottom (migration 203). Six points of extra content height per
  // page — enough to keep a short closing disclaimer off a page of its own, while
  // still clearing the fixed footer (bottom 14 + 4 padding) by ~18pt. Applied as an
  // OVERRIDE on top of `page`, never by editing it: `page` is the geometry every
  // other template's report is pinned to in JobPDF.unchanged.test.ts.
  pageTightBottom: {
    paddingBottom: 38,
  },
  // Report title
  reportTitleBlock: {
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: '#1d4ed8',
  },
  reportTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
  },
  // Job details block — two balanced columns (left: vessel/date, right: port/method)
  jobDetailsBlock: {
    backgroundColor: '#f8fafc',
    borderRadius: 3,
    padding: '4 8',
    marginBottom: 6,
    flexDirection: 'row',
  },
  jobDetailCol: {
    width: '50%',
    flexDirection: 'column',
    paddingRight: 8,
  },
  jobDetailRow: {
    flexDirection: 'row',
    marginBottom: 2,
    alignItems: 'center',
  },
  jobDetailLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    marginRight: 3,
  },
  jobDetailValue: {
    fontSize: 7.5,
    color: '#1e293b',
  },
  // Section
  sectionContainer: {
    marginBottom: 6,
  },
  sectionHeader: {
    backgroundColor: '#1e3a8a',
    padding: '4 8',
    borderRadius: 2,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  sectionDescription: {
    fontSize: 7,
    color: '#bfdbfe',
    marginTop: 1,
  },
  // Fields
  fieldRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
    minHeight: 14,
  },
  fieldLabel: {
    width: '38%',
    paddingRight: 6,
  },
  // Wide label for short-answer rows (yes/no, pass/fail, numbers, dropdowns): give the
  // QUESTION most of the width so it fits on one line, leaving the value column just
  // enough for the answer badge + a short remark. Long-answer types (textarea, video,
  // multiple-choice) keep the narrow `fieldLabel` so their value has room to wrap.
  fieldLabelWide: {
    width: '64%',
    paddingRight: 6,
  },
  // ONE split for every row, so the value column starts at the same x the whole way
  // down the report. The per-type split above is right on a 12-field checklist and
  // wrong on a 164-question one: 110 yes/no rows at 64% interleaved with 21 long-answer
  // rows at 38% makes the table's own columns appear to move. 60/40 is measured against
  // the Pre-Hire content — 552pt of content width leaves 290pt of question text after
  // the item-number cell and the 6pt gutter (no question in that template needs a third
  // line) and 220.8pt of value (its widest one-line answer is 208pt).
  // Opt-in per template: checklist_templates.pdf_uniform_label_width, migration 202.
  fieldLabelUniform: {
    width: '60%',
    paddingRight: 6,
  },
  // pdf_remark_below (migration 202): when a long remark moves out from beside the
  // answer badge to full width beneath it, the ROW loses its bottom rule and the
  // remark block below carries it instead, so one rule still closes the question.
  fieldRowRemarkAbove: {
    flexDirection: 'row',
    paddingVertical: 3,
    minHeight: 14,
  },
  remarkBelowBlock: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 3,
  },
  remarkBelowText: {
    fontSize: 7.5,
    color: '#64748b',
    lineHeight: 1.35,
  },
  fieldLabelText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  // Item number sits in its own fixed-width cell so every question's wording starts at
  // the SAME x — the width is sized to the widest number in the report (see renderField),
  // so "1" and "19" leave their labels aligned.
  itemNumberText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
  },
  fieldRequired: {
    color: '#ef4444',
    fontSize: 7.5,
  },
  fieldValue: {
    flex: 1,
  },
  fieldValueText: {
    fontSize: 8,
    color: '#1e293b',
    lineHeight: 1.3,
  },
  fieldValueEmpty: {
    fontSize: 8,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  fieldUnit: {
    fontSize: 7,
    color: '#64748b',
    marginLeft: 2,
  },
  inlineHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    marginTop: 6,
    marginBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bfdbfe',
    paddingBottom: 2,
  },
  signatureImage: {
    height: 32,
    maxWidth: 120,
    objectFit: 'contain',
  },
  yesNoValue: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
  },
  textareaValue: {
    fontSize: 8,
    color: '#1e293b',
    lineHeight: 1.4,
  },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderTopColor: '#e2e8f0',
    paddingTop: 4,
  },
  footerText: {
    fontSize: 6.5,
    color: '#94a3b8',
  },
  photoNote: {
    marginTop: 8,
    padding: 5,
    backgroundColor: '#fef9c3',
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: '#fde68a',
  },
  photoNoteText: {
    fontSize: 7,
    color: '#854d0e',
  },
  dividerLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    marginVertical: 4,
  },
  videoLink: {
    fontSize: 8,
    color: '#1d4ed8',
    textDecoration: 'underline',
    marginBottom: 1,
  },
  // Photographs section (only rendered when the template opts in)
  photosSectionHeader: {
    backgroundColor: '#1e3a8a',
    padding: '4 8',
    borderRadius: 2,
    marginBottom: 4,
  },
  photoGroupHeading: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    marginTop: 6,
    marginBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bfdbfe',
    paddingBottom: 2,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photoItem: {
    width: '33.33%',
    padding: 3,
  },
  photoImage: {
    width: '100%',
    height: 110,
    objectFit: 'cover',
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
  },
  photoCaption: {
    fontSize: 6.5,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  // Summary of findings — the auto-built list of every answer that reads as a finding.
  findingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f1f5f9',
  },
  findingNum: {
    width: 30,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
  },
  findingText: {
    flex: 1,
    paddingRight: 6,
  },
  findingLabel: {
    fontSize: 8,
    color: '#1e293b',
  },
  findingRemark: {
    fontSize: 7.5,
    color: '#64748b',
    marginTop: 1,
  },
  findingNone: {
    fontSize: 8,
    color: '#64748b',
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  // Letterhead — mirrors the invoice for a consistent, clean header.
  logo: {
    width: 210,
    alignSelf: 'center',
    marginBottom: 4,
  },
  wordmark: {
    fontSize: 17,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  tagline: {
    fontSize: 7,
    color: '#64748b',
    textAlign: 'center',
    letterSpacing: 1.3,
    marginTop: 2,
  },
  headLine: {
    fontSize: 7.5,
    color: '#64748b',
    textAlign: 'center',
  },
  headRule: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#1d4ed8',
    marginTop: 7,
    marginBottom: 8,
  },
  reportTitleCentered: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    textAlign: 'center',
    marginBottom: 8,
  },
  // Per-entry photo pages: 2 columns × 3 rows = 6 per page, started on a fresh page.
  reportPhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  reportPhotoItem: {
    width: '50%',
    padding: 4,
  },
  reportPhotoImage: {
    width: '100%',
    height: 200,
    objectFit: 'contain', // show the WHOLE inspection photo (no cropping)
    backgroundColor: '#f1f5f9', // neutral mat behind letterboxed images
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
  },
  // Repeatable-section entry block — a light-blue heading bar (lighter than the solid
  // section header) clearly separates the entry label from its data rows.
  entryBlock: {
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
    borderRadius: 3,
    marginBottom: 5,
  },
  entryHeading: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a8a',
    backgroundColor: '#dbeafe',
    padding: '3 6',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginBottom: 3,
  },
  entryBody: {
    padding: '0 6 3 6',
  },
  preamble: {
    marginTop: 8,
    marginBottom: 2,
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.45,
  },
  disclaimer: {
    marginTop: 6,
    padding: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
    borderRadius: 2,
  },
  disclaimerText: {
    fontSize: 6,
    color: '#64748b',
    fontStyle: 'italic',
    lineHeight: 1.3,
  },
})

// ─── Pre-Hire report presentation helpers (migration 202) ────────────────────────
// Every one of these is inert unless its flag is on. They are pure functions kept at
// module scope so the flag-off path is a single ternary at each call site.

/** A hyphenation callback that never splits a word.
 *
 *  @react-pdf hyphenates by default, and its guesses are not real syllable breaks:
 *  "Safe Man-/ning Document", "individually sight-/ed", "emer-/gency". On a signed
 *  survey report those read as typos.
 *
 *  THE TRAP: the documented lever is `Font.registerHyphenationCallback`, which is
 *  PROCESS-GLOBAL. A serverless instance can render two reports at once, so a global
 *  set for the Pre-Hire render would be read by a concurrent Fuel Transfer render and
 *  silently change a report that must be byte-identical. @react-pdf also accepts
 *  `hyphenationCallback` as a prop on each Text (verified in @react-pdf/layout:
 *  `node.props.hyphenationCallback || fontStore?.getHyphenationCallback()`), which is
 *  scoped to the one element. Use the prop; never the global.
 *  (checklist_templates.pdf_no_hyphenation, migration 202.) */
const KEEP_WORDS_WHOLE = (word: string): string[] => [word]

type HyphenProps = { hyphenationCallback?: (word: string) => string[] }

/** Props to spread onto every Text that can wrap. `{}` when the flag is off, so NO
 *  prop is emitted and the element is identical to the one rendered today. */
function hyphenProps(noHyphenation: boolean): HyphenProps {
  return noHyphenation ? { hyphenationCallback: KEEP_WORDS_WHOLE } : {}
}

/** ISO date → DD.MM.YYYY, the convention the saved report filename already uses.
 *  ONLY an exact ISO date is touched, so a hand-typed "Wk 35 - Aug 2026" or
 *  "OVIQ2 - 14/05/2026" survives verbatim.
 *  (checklist_templates.pdf_format_dates, migration 202.) */
export function formatReportDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value
}

/** Split an item number into comparable runs: "13.15A" → [13, 15, 'A']. */
function itemNumberKey(n: string): Array<number | string> {
  return (n.match(/\d+|[A-Za-z]+/g) ?? []).map(t => (/^\d+$/.test(t) ? Number(t) : t.toUpperCase()))
}

/** Natural order for item numbers: a bare number sorts immediately BEFORE its lettered
 *  detail, and numbers sort before letters at the same position — 7.1 < 7.1A < 7.2,
 *  13.15A < 13.16. Total and consistent, so it is safe to hand to Array.sort. */
export function compareItemNumbers(a: string, b: string): number {
  const ka = itemNumberKey(a)
  const kb = itemNumberKey(b)
  const len = Math.max(ka.length, kb.length)
  for (let i = 0; i < len; i++) {
    const x = ka[i]
    const y = kb[i]
    if (x === undefined) return -1   // "7.1" before "7.1A"
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
      continue
    }
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Reorder a section's rows by item number.
 *
 *  A conditional detail field is stored AFTER the tick-list it follows, so the report
 *  prints 7.1, 7.2, 7.1A, 7.3 — which reads as a numbering error and separates a
 *  finding from its own explanation. This fixes the PRINT order only; no template row
 *  is touched.
 *
 *  Rows with no item number (headings, dividers) must not be shuffled into an order
 *  they have no key for, so only the NUMBERED rows are permuted, and each is placed
 *  back into a position that a numbered row already occupied. The index tiebreak keeps
 *  the sort stable for duplicate numbers.
 *  (checklist_templates.pdf_sort_by_item_number, migration 202.) */
function sortFieldsByItemNumber(fields: any[]): any[] {
  const numbered = fields
    .map((f, i) => ({ f, i }))
    .filter(x => String(x.f?.item_number ?? '').trim().length > 0)
  if (numbered.length < 2) return fields
  const sorted = [...numbered].sort((a, b) =>
    compareItemNumbers(String(a.f.item_number), String(b.f.item_number)) || a.i - b.i)
  const out = fields.slice()
  numbered.forEach((slot, k) => { out[slot.i] = sorted[k].f })
  return out
}

/** Does a repeatable section carry ANY data, on any entry?
 *
 *  resolveEntryOrder deliberately floors its result at [0] so the EDITOR always has a
 *  first blank entry to type into — that floor must stay. On the report it means an
 *  untouched repeatable section still prints a forced page break and one "Entry 1"
 *  whose every field is an em dash. This is the same presence test WITHOUT the floor.
 *  (checklist_templates.pdf_hide_empty_repeatables, migration 202.) */
function repeatableHasData(
  section: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  attachments: Array<{ field_id: string | null }>,
): boolean {
  const fieldIds = (section.fields ?? []).map((f: any) => f.id)
  if (presentInstances(fieldIds, [fieldValues, arrayValues, signatures]).size > 0) return true
  const ids = new Set<string>(fieldIds)
  return attachments.some(a => a.field_id && ids.has(a.field_id))
}

/** Options a template can switch on for the rows it prints. Every member defaults to
 *  off/absent, so `renderField(..., {})` is exactly today's row. */
type RowOptions = {
  /** One question/value split for every row (60/40) instead of a per-type one. */
  uniformLabelWidth?: boolean
  /** Long yes/no remarks print full width beneath the row, not beside the badge. */
  remarkBelow?: boolean
  /** Multiple-choice answers print in the template's option order. */
  sortChoices?: boolean
  /** ISO date values print as DD.MM.YYYY. */
  formatDates?: boolean
  /** Text props (the no-hyphenation callback) spread onto every wrapping Text. */
  hyph?: HyphenProps
}

/** A remark shorter than this still reads fine in the strip beside the badge, and
 *  moving it below would waste a line. Only genuinely long ones move. */
const REMARK_BELOW_MIN_CHARS = 60

// Resolve {uuid} tokens in labels to the selected option label (human-readable)
function resolvePdfLabel(label: string, fieldValues: Record<string, string>, allFields: any[]): string {
  return label.replace(/\{([0-9a-f-]{36})\}/gi, (_, fieldId) => {
    const raw = fieldValues[fieldId] ?? ''
    const val = raw.includes('|||') ? raw.split('|||')[0] : raw
    if (!val) return ''
    const src = allFields.find((f: any) => f.id === fieldId)
    if (src?.field_type === 'dropdown') {
      const opt = (src.options ?? []).find((o: any) => o.value === val)
      if (opt?.useFieldId) {
        const deferred = fieldValues[opt.useFieldId] ?? ''
        const text = deferred.includes('|||') ? deferred.split('|||')[0] : deferred
        return text || opt.label || val
      }
      return opt?.label ?? val
    }
    return val
  })
}

// Resolve a dropdown raw database value to its human-readable option label
function resolveDropdownValue(field: any, rawValue: string): string {
  if (!rawValue) return '—'
  const opt = (field?.options ?? []).find((o: any) => o.value === rawValue)
  return opt?.label ?? rawValue
}

function YesNoCell({ rawValue, options, hyph = {} }: { rawValue: string; options: any[] | null | undefined; hyph?: HyphenProps }) {
  const answerKey = rawValue.includes('|||') ? rawValue.split('|||')[0] : rawValue
  const remarks = rawValue.includes('|||') ? rawValue.split('|||')[1] : ''
  // Colour and badge text both come from the shared answer-option seam, so a template
  // that adds a choice ("ni" = Not inspected) prints it the same way the form shows it.
  const c = answerColor(answerKey, options)
  // Answer and its remark sit in TWO columns on ONE line (fixed-width answer badge,
  // remark beside it) so a comment never pushes the row onto a second line — keeps the
  // whole checklist compact / single-page. alignSelf keeps the coloured pill tight.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 40 }}>
        <Text style={[styles.yesNoValue, { alignSelf: 'flex-start', backgroundColor: YES_NO_BG[c] ?? '#f1f5f9', color: YES_NO_FG[c] ?? '#94a3b8' }]}>
          {answerBadgeText(answerKey, options)}
        </Text>
      </View>
      {remarks ? <Text {...hyph} style={{ flex: 1, fontSize: 7.5, color: '#64748b', marginLeft: 4 }}>{remarks}</Text> : null}
    </View>
  )
}

// Handles both percentage-display calculated fields (shows "<diff> <unit>: <pct>%") and plain
// numbers. `unit` comes from the template field and falls back to USG for legacy fuel templates.
function CalcDiffCell({ rawValue, validation, formula, fieldValues, instance = 0, unit }: {
  rawValue: string
  validation: any
  formula?: string
  fieldValues: Record<string, string>
  instance?: number
  unit?: string
}) {
  const num = parseFloat(rawValue)
  if (isNaN(num)) return <Text style={{ fontSize: 8, color: '#94a3b8' }}>—</Text>

  if (validation?.display_as === 'percentage') {
    const tokens = Array.from((formula ?? '').matchAll(/\{([^}]+)\}/g), m => m[1])
    const denominatorId = tokens[tokens.length - 1]
    // Resolve the denominator for THIS entry instance (falls back to the bare id).
    const denominator = denominatorId ? (fieldValues[instanceKey(denominatorId, instance)] ?? fieldValues[denominatorId]) : undefined
    const { display, pct } = formatDiffPercentage(num, denominator, unit || undefined)

    if (pct === null) {
      return <Text style={styles.fieldValueText}>{display}</Text>
    }
    const absVal = Math.abs(pct)
    const thresholds: any[] = validation?.thresholds ?? [
      { max: 1.0, color: 'green' },
      { max: 2.0, color: 'amber' },
      { color: 'red' },
    ]
    const c = (thresholds.find((t: any) => t.max === undefined || absVal < t.max)?.color ?? 'red') as string
    return (
      <Text style={[styles.yesNoValue, { backgroundColor: YES_NO_BG[c] ?? '#f1f5f9', color: YES_NO_FG[c] ?? '#94a3b8' }]}>
        {display}
      </Text>
    )
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={styles.fieldValueText}>{rawValue}</Text>
    </View>
  )
}

interface JobPhoto {
  field_id: string | null
  instance: number
  url: string
  caption: string | null
  filename: string | null
}

interface PDFProps {
  job: any
  sections: any[]
  fieldValues: Record<string, string>
  arrayValues: Record<string, string[]>
  signatures: Record<string, string>
  photoCount: number
  /** Signed photo URLs to embed — populated only when the template opts in
   *  (pdf_include_photos). Empty array keeps the legacy "stored internally" note. */
  photos?: JobPhoto[]
  /** Fixed legal boilerplate printed at the end (template.pdf_disclaimer). */
  disclaimer?: string | null
  /** Intro paragraph printed below the Job Details (template.pdf_preamble). */
  preamble?: string | null
  /** Company letterhead logo as a data URI (loaded server-side). */
  logoSrc?: string
  /** When true the template opted out of the logo — render no top graphic/wordmark
   *  at all (just the address line), rather than the company-name fallback. */
  hideLogo?: boolean
  /** Names of the surveyors assigned to the job, printed in the header. */
  surveyors?: string[]
  /** Template opted to drop the Client row from the header (client is in the title). */
  hideClient?: boolean
  /** Template opted to drop the Surveyor row from the header. */
  hideSurveyor?: boolean
  /** Split the header rows evenly across the two columns instead of the historic
   *  job-rows-left / checklist-rows-right split. Opt-in per template (migration 141). */
  balancedHeader?: boolean
  /** Print each photo field's photos under ITS OWN section, instead of collecting them
   *  onto "Additional Photographs" pages at the back. Opt-in per template
   *  (checklist_templates.pdf_photos_inline, migration 170).
   *
   *  Photos in a REPEATABLE section have always printed under their entry; this is the
   *  same treatment for an ordinary section, where the association was previously
   *  computed and then thrown away. Off by default, so every existing report is
   *  byte-identical — no template had a photo field outside a repeatable section. */
  photosInline?: boolean
  /** Print an auto-built "Summary of Findings" — every answer on the checklist that
   *  reads as a finding, gathered in one place so a reader does not have to hunt
   *  through 180 questions for the handful that matter.
   *  (checklist_templates.pdf_deficiency_summary, migration 182.) */
  deficiencySummary?: boolean
  /** Non-image attachments (a crew list or particulars sheet handed over as a PDF).
   *  They cannot be embedded IN THE RENDER — passing one to <Image> fails the whole
   *  render — so they are named under the question they belong to instead.
   *
   *  `number` is set ONLY when the template opted into pdf_embed_attachments and the
   *  file is being appended to the back of the report by the route (migration 202). It
   *  is what turns the in-body line into a cross-reference. Absent ⇒ the line is the
   *  character-identical "Attached: <filename>" every other template prints today, so
   *  this optional field IS the gate — no extra prop is needed. */
  documents?: Array<{ field_id: string | null; instance: number; filename: string; number?: number }>
  // --- Pre-Hire report presentation, migration 202 ------------------------------
  // Every one defaults to FALSE in the destructure below and every changed line sits
  // inside an `if (flag)` / ternary, so a template that does not opt in renders
  // byte-for-byte what it renders today. Set from checklist_templates columns of the
  // same name in src/app/api/pdf/[jobId]/route.ts.
  /** Print every field row with the SAME question/value split (60/40) instead of one
   *  chosen from the field type, so the value column never moves. */
  uniformLabelWidth?: boolean
  /** Print jobs.report_number — the client-facing 26-08-NNN series — in the header,
   *  the footer and the PDF title, in preference to jobs.job_number (the internal
   *  "TEAL C/L #" ledger reference). The route uses the same flag for the filename. */
  showReportNumber?: boolean
  /** Leave a repeatable section out entirely when no entry carries data, instead of
   *  printing a forced page break and one "Entry 1" of em dashes. */
  hideEmptyRepeatables?: boolean
  /** Never break a word across lines. */
  noHyphenation?: boolean
  /** Trim the page's bottom margin 44pt -> 38pt. Re-flows the WHOLE report, so every
   *  page break can move; it exists because the closing disclaimer was landing 14pt
   *  short of fitting under the sign-off and taking a page to itself. */
  tightPageBottom?: boolean
  /** Print a LONG yes/no remark full width beneath its row rather than in the narrow
   *  strip beside the answer badge. */
  remarkBelow?: boolean
  /** Print multiple-choice answers in the template's own option order. */
  sortChoices?: boolean
  /** Print ISO date values as DD.MM.YYYY. */
  formatDates?: boolean
  /** Order each section's rows by item number rather than by order_index. */
  sortByItemNumber?: boolean
  /** In the Summary of Findings, borrow a finding's conditional DETAIL field when the
   *  finding's own remark box is empty. Only reachable when `deficiencySummary` is on
   *  as well — it changes nothing but what that summary prints. */
  findingDetail?: boolean
}

export interface HeaderRow { label: string; value: string }

/** Rows that have always belonged to the header's right-hand column. */
const FIXED_RIGHT_LABELS = new Set(['Port', 'Method of Delivery', 'Bunker Vessel Name'])

/**
 * Split the report header's rows into its two columns.
 *
 * Default (`balanced` false) is the historic fixed split: job-record rows (Vessel, Client,
 * Date, Surveyor) on the left, checklist-derived rows (Port, Method of Delivery, Bunker
 * Vessel Name) on the right. That reads lopsided when a template has six rows — 4 and 2 —
 * so a template can opt into an even split (`pdf_balanced_header`, migration 141).
 *
 * Both modes slice the same ordered list, so the columns always partition it exactly:
 * no row is dropped and none is printed twice.
 */
export function splitHeaderRows(rows: HeaderRow[], balanced: boolean): [HeaderRow[], HeaderRow[]] {
  const firstRight = rows.findIndex(r => FIXED_RIGHT_LABELS.has(r.label))
  const cut = balanced
    ? Math.ceil(rows.length / 2)
    : (firstRight < 0 ? rows.length : firstRight)
  return [rows.slice(0, cut), rows.slice(cut)]
}

function DetailRow({ label, value, labelWidth, hyph = {} }: { label: string; value: string; labelWidth?: number; hyph?: HyphenProps }) {
  return (
    <View style={styles.jobDetailRow}>
      {/* Fixed-width, right-aligned label so every colon in the column lines up and the
          values all start at the same x (e.g. "Vessel:" / "Date:" colons align). */}
      <Text style={[styles.jobDetailLabel, labelWidth ? { width: labelWidth, textAlign: 'right' as const } : {}]}>{label}:</Text>
      <Text {...hyph} style={[styles.jobDetailValue, { flex: 1 }]}>{value}</Text>
    </View>
  )
}

// A field-row-styled row for injected job-record values (Vessel/Client/Surveyors), so
// they sit consistently among the real fields in a details section.
//
// The label style is a PARAMETER, not the hard-coded 38%, because this is the one place
// a uniform-column template could silently misalign: these rows would keep the narrow
// label while every real question moved to 60%. It defaults to styles.fieldLabel, so a
// caller that passes nothing renders byte-for-byte what it renders today.
// (checklist_templates.pdf_uniform_label_width, migration 202.)
function renderInfoRow(
  key: string,
  label: string,
  value: string,
  labelStyle: any = styles.fieldLabel,
  hyph: HyphenProps = {},
): React.ReactElement {
  return (
    <View key={key} style={styles.fieldRow}>
      <View style={labelStyle}><Text {...hyph} style={styles.fieldLabelText}>{label}</Text></View>
      <View style={styles.fieldValue}><Text {...hyph} style={styles.fieldValueText}>{value}</Text></View>
    </View>
  )
}

export function JobPDF({ job, sections, fieldValues, arrayValues, signatures, photoCount, photos = [], disclaimer = null, preamble = null, logoSrc, hideLogo = false, surveyors = [], hideClient = false, hideSurveyor = false, balancedHeader = false, photosInline = false, deficiencySummary = false, documents = [], uniformLabelWidth = false, showReportNumber = false, hideEmptyRepeatables = false, noHyphenation = false, tightPageBottom = false, remarkBelow = false, sortChoices = false, formatDates = false, sortByItemNumber = false, findingDetail = false }: PDFProps) {
  const allFieldsFlat = sections.flatMap((s: any) => s.fields ?? [])

  // Migration 202 presentation options, resolved ONCE. `hyph` is `{}` unless the
  // template opted out of hyphenation, so spreading it emits no prop at all and every
  // other template's Text elements are identical to today's.
  const hyph = hyphenProps(noHyphenation)
  const rowOptions: RowOptions = { uniformLabelWidth, remarkBelow, sortChoices, formatDates, hyph }
  const uniformLabelStyle = uniformLabelWidth ? styles.fieldLabelUniform : styles.fieldLabel
  /** One call site for the row renderer, so the eight flag-bearing options are threaded
   *  in exactly one place rather than at five separate calls. */
  const renderRow = (field: any, inst = 0) =>
    renderField(field, fieldValues, arrayValues, signatures, allFieldsFlat, inst, rowOptions)

  const preambleNode = preamble ? <Text {...hyph} style={styles.preamble}>{preamble}</Text> : null

  // Photos that render INLINE are kept out of the end-of-report grid so they never
  // appear twice. Two ways a photo goes inline:
  //   * it hangs off a photo field in a REPEATABLE section — always, printed per entry;
  //   * the template sets photosInline, in which case a photo hanging off ANY field
  //     prints under that field. job_photos.field_id has never required a photo-type
  //     field, so every question can carry its own evidence.
  const inlinePhotoFieldIds = new Set<string>()
  for (const s of sections as any[]) {
    for (const f of (s.fields ?? [])) {
      if (photosInline || (s.is_repeatable && f.field_type === 'photo')) inlinePhotoFieldIds.add(f.id)
    }
  }
  // Photos with no field_id (the job's general "Additional Photos") end up here, and so
  // do any whose field is absent from the report — a conditionally hidden section, say.
  // Better at the back than dropped.
  const endPhotos = photos.filter(p => !(p.field_id && inlinePhotoFieldIds.has(p.field_id)))

  // Every answer that reads as a finding, in checklist order.
  //
  // The walk lives in lib/checklist/review — the surveyor now sees this same list on
  // screen before leaving the vessel, and the report and the screen must never disagree
  // about what counts as a defect. The rule it applies (colour, not the word "No") is
  // documented there.
  /** The explanation a finding's own remark box does not hold.
   *
   *  The CMID pattern is a yes/no question (7.1) followed by a conditional DETAIL field
   *  (7.1A, "Which item(s) of navigational equipment, and what was found?") that only
   *  appears when the answer is adverse. reviewChecklist walks answer-family types only,
   *  so that textarea can never become a finding's remark — and the summary printed
   *  "7.1 … [NO]" with nothing beside it while the very next finding carried a full
   *  explanation. The reader concludes the surveyor did not look. The information was
   *  there all along, printed three pages later under a different item number.
   *
   *  So: find the field whose conditional logic is keyed on THIS question and borrow its
   *  answer. That is exactly the relationship the template already encodes — no template
   *  edit, no new question. A finding whose detail field is ALSO blank stays bare, which
   *  is right: nothing was written anywhere.
   *
   *  Gated by its OWN default-false flag, `findingDetail`
   *  (checklist_templates.pdf_finding_detail, migration 202) — NOT by `deficiencySummary`.
   *  That distinction is the whole point. pdf_deficiency_summary is a migration-182 flag
   *  that today only Pre-Hire has on, so riding it would LOOK safe; but then the property
   *  "every migration-202 flag off ⇒ this template renders byte-for-byte what it renders
   *  today" would be guaranteed by a value in the database rather than by the code, and
   *  the day another template turned the summary on it would inherit this borrowing too
   *  — a second change to its report that nobody chose. */
  const conditionalDetailFor = (fieldId: string, instance: number): string => {
    for (const f of allFieldsFlat as any[]) {
      const conds = f?.conditional_logic?.conditions
      if (!Array.isArray(conds) || !conds.some((c: any) => c?.field_id === fieldId)) continue
      const raw = fieldValues[instanceKey(f.id, instance)] ?? ''
      // A detail field is normally a textarea, but read the answer|||remark shape too.
      const text = (raw.includes('|||') ? raw.split('|||')[1] ?? '' : raw).trim()
      if (text) return text
    }
    return ''
  }

  const findings = deficiencySummary
    ? reviewChecklist({
        sections: sections as any,
        values: fieldValues,
        arrayValues,
        signatures,
        instancesFor: (section: any) =>
          orderedInstancesFor(section, job, fieldValues, arrayValues, signatures, photos),
        hasPhoto: (fieldId, instance) =>
          photos.some(p => p.field_id === fieldId && (p.instance ?? 0) === instance),
        resolveLabel: (label) => resolvePdfLabel(label, fieldValues, allFieldsFlat),
      }).findings.map(f => ({
        num: f.itemNumber || '',
        label: f.label,
        answer: f.answer ?? '',
        remark: (f.remark ?? '') || (findingDetail ? conditionalDetailFor(f.fieldId, f.instance) : ''),
        amber: f.severity === 'amber',
      }))
    : []

  /** Documents attached to a question, named beneath it.
   *
   *  Without pdf_embed_attachments the file itself lives only in the job record and the
   *  report states that it was taken and what it was called. With it (migration 202) the
   *  document is appended IN FULL at the back by the route, and `d.number` is set — so
   *  the line becomes a cross-reference to that attachment. Keep the line either way:
   *  once the file is forty pages away it is the only thing tying it to the question it
   *  answers, and it is the audit trail that the surveyor attached something.
   *
   *  `number` absent ⇒ the identical string every other template prints today. */
  const inlineDocsFor = (field: any, inst: number): React.ReactElement | null => {
    const mine = documents.filter(d => d.field_id === field.id && d.instance === inst)
    if (mine.length === 0) return null
    return (
      <View key={`doc-${field.id}-${inst}`} style={{ paddingLeft: 34, paddingBottom: 2 }}>
        {/* Two whole elements rather than one with a conditional string: the flag-off
            branch is then LITERALLY the line that ships today, visibly unchanged. */}
        {mine.map((d, i) => (d.number ? (
          <Text key={i} {...hyph} style={styles.findingRemark}>Attached: {d.filename} — see Attachment {d.number} at the end of this report.</Text>
        ) : (
          <Text key={i} {...hyph} style={styles.findingRemark}>Attached: {d.filename}</Text>
        )))}
      </View>
    )
  }

  /** This field/entry's photos, as a captioned grid printed directly beneath its row. */
  const inlinePhotosFor = (field: any, inst: number): React.ReactElement | null => {
    if (!photosInline) return null
    const mine = photos.filter(p => p.field_id === field.id && p.instance === inst)
    if (mine.length === 0) return null
    const caption = [field.item_number, field.label].filter(Boolean).join(' ')
    return (
      <View style={styles.reportPhotoGrid} key={`ph-${field.id}-${inst}`}>
        {mine.map((p, i) => (
          <View key={i} style={styles.reportPhotoItem} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={p.url} style={styles.reportPhotoImage} />
            <Text {...hyph} style={styles.photoCaption}>{p.caption || `${caption} — Photo ${i + 1}`}</Text>
          </View>
        ))}
      </View>
    )
  }

  // Locate key Job Detail fields by label pattern. CRITICAL: only ever consider
  // IDENTITY-style field types (text/date/dropdown/number/time) as header candidates.
  // Header fields (Vessel, Date, Port, Method of Delivery, Bunker Vessel Name) are never
  // answer/question types — so this guard stops a real checklist question from being
  // mistaken for a header field and silently dropped from the body. (This exact bug:
  // "COQ provided by bunker suppliers to vessel" — a yes/no question — matched the loose
  // bunker+vessel pattern once the conditional "Bunker Vessel Name" field was hidden.)
  const HEADER_FIELD_TYPES = new Set(['text', 'date', 'dropdown', 'number', 'time'])
  const headerCandidates = allFieldsFlat.filter((f: any) => HEADER_FIELD_TYPES.has(f.field_type))
  // Require the words "bunker" and "vessel" to be adjacent so only the identity field
  // ("Bunker Vessel Name") matches — never a sentence that merely mentions both.
  const bunkerVesselField = headerCandidates.find((f: any) =>
    /bunker\s+vessel/i.test(f.label)
  ) ?? null
  // The surveyed vessel's NAME field only — excludes descriptor fields
  // ("Vessel IMO Number", "Vessel Type", …) and the bunker vessel.
  const vesselField = headerCandidates.find((f: any) =>
    isSurveyedVesselNameField(f.label) && f.id !== bunkerVesselField?.id
  ) ?? null
  // EXACT labels, not "contains the word". The loose /\bdate\b/ and /\bport\b/ patterns
  // matched descriptive questions — "Date of last drydocking", "Port of registry" — and
  // the winner is then SUPPRESSED from the report body, so a real question silently
  // vanished. (The same class of bug as the bunker-vessel one described above; it cost a
  // question out of a signed report once already.) A template that wants to drive these
  // header rows names the field exactly `Date` / `Port`, which is what every template
  // that relies on this already does.
  const exactly = (name: string) => (f: any) => String(f.label ?? '').trim().toLowerCase() === name
  const dateField = headerCandidates.find(exactly('date')) ?? null
  const portField = headerCandidates.find(exactly('port')) ?? null
  const methodField = headerCandidates.find((f: any) => /method.*delivery|delivery.*method/i.test(f.label)) ?? null

  // Generic header mechanism (cross-template-safe): fields flagged show_in_header are
  // promoted to the top info block and suppressed from the body. Templates with none
  // flagged fall through the legacy regex header below, byte-for-byte unchanged.
  const flaggedHeaderIds = allFieldsFlat.filter((f: any) => f.show_in_header).map((f: any) => f.id)
  const useFlagHeader = flaggedHeaderIds.length > 0
  // A flagged field whose value comes from the JOB record (vessel name / client /
  // surveyor) is shown via an injected job row, not its own field row.
  const isJobBackedField = (f: any) => isSurveyedVesselNameField(f.label) || f.field_type === 'client_select' || /surveyor/i.test(f.label)

  // These are shown in the Job Details block — suppress them from the section body
  const suppressedIds = new Set<string>(
    (useFlagHeader
      ? flaggedHeaderIds
      : [vesselField?.id, dateField?.id, portField?.id, methodField?.id, bunkerVesselField?.id])
      .filter((id): id is string => !!id)
  )

  const methodRaw = methodField ? (fieldValues[methodField.id] ?? '') : ''
  const methodDisplay = methodField ? resolveDropdownValue(methodField, methodRaw) : ''
  const showBunkerVessel = methodRaw === 'bunker_vessel' && !!bunkerVesselField

  // Per-column label widths for the Job Details block: size each column's label cell to
  // its own widest label so the labels can be right-aligned (colons line up, values start
  // at the same x). Estimated width — generous factor so the longest label never wraps;
  // over-estimating is harmless (right-aligned colons still line up, just a touch of gap).
  const labelColWidth = (labels: string[]) =>
    labels.length ? Math.max(...labels.map(l => (l.length + 1) * 4.6)) : undefined

  // Date and Port: prefer a template field, but fall back to the JOB RECORD, which
  // already holds both (jobs.scheduled_date, and jobs.port_location from migration 153).
  // Without the fallback a template had to re-ask for data the job already carried, and
  // the surveyor typed it twice — the checklist audit has always flagged that as
  // DOUBLE-ENTRY. Templates with their own Date/Port field are unaffected: the field
  // still wins, and is still suppressed from the body.
  const headerDateRaw = (dateField && fieldValues[dateField.id]) || job.scheduled_date || ''
  // pdf_format_dates (migration 202): the header Date is the fourth line a client reads
  // and printing it as raw ISO is the one thing on the letterhead that looks
  // machine-generated. Only an exact ISO date is reformatted.
  const headerDate = formatDates ? formatReportDate(headerDateRaw) : headerDateRaw
  const headerPort = (portField && fieldValues[portField.id]) || job.port_location || ''

  // The header rows that actually have a value, in print order.
  const headerRows: Array<{ label: string; value: string }> = [
    job.vessel_name ? { label: 'Vessel', value: withVesselPrefix(job.vessel_name, job.vessel_type) } : null,
    // pdf_show_report_number (migration 202). jobs.job_number is Taylor Engineering's
    // internal client-ledger reference ("TEAL C/L #1280"); jobs.report_number is the
    // 26-08-NNN the client will quote, that the invoice carries and that identifies the
    // survey. Until this flag existed the ledger reference was stamped on every page and
    // in the filename while the report number appeared NOWHERE on the document — a
    // survey report without its report number on it is not issuable.
    showReportNumber && job.report_number ? { label: 'Report No.', value: job.report_number } : null,
    // The voyage used to reach this page for free, because surveyors typed it INTO the
    // vessel name and it printed as "M.V. Chaconia (V086)". Migration 186 moved it to
    // its own column, so without this row the delivered report would silently LOSE
    // information it has always carried. Its own row rather than glued to the vessel:
    // the header is a label/value grid, and the client reads down the labels.
    job.voyage_number ? { label: 'Voyage', value: job.voyage_number } : null,
    job.client?.name && !hideClient ? { label: 'Client', value: job.client.name } : null,
    headerDate ? { label: 'Date', value: headerDate } : null,
    surveyors.length > 0 && !hideSurveyor
      ? { label: `Surveyor${surveyors.length > 1 ? 's' : ''}`, value: surveyors.join(', ') } : null,
    headerPort ? { label: 'Port', value: headerPort } : null,
    methodDisplay ? { label: 'Method of Delivery', value: methodDisplay } : null,
    showBunkerVessel && bunkerVesselField && fieldValues[bunkerVesselField.id]
      ? { label: 'Bunker Vessel Name', value: fieldValues[bunkerVesselField.id] } : null,
  ].filter((r): r is { label: string; value: string } => !!r)

  const [leftRows, rightRows] = splitHeaderRows(headerRows, balancedHeader)

  const leftLabelW = labelColWidth(leftRows.map(r => r.label))
  const rightLabelW = labelColWidth(rightRows.map(r => r.label))

  const reportTitle = job.template?.name ?? job.title

  // The reference stamped on every page, in the PDF metadata title and (via the same
  // flag in the route) on the saved filename. Flag off ⇒ `(null) ?? job.job_number ??
  // 'Draft'` — character-for-character what every other report prints today.
  const pageReference = (showReportNumber ? job.report_number : null) ?? job.job_number ?? 'Draft'

  return (
    <Document
      title={`${job.title} — ${pageReference}`}
      author={COMPANY.name}
      subject="Survey Checklist Report"
    >
      <Page size="LETTER" style={tightPageBottom ? [styles.page, styles.pageTightBottom] : styles.page}>

        {hideLogo ? (
          /* Logo toggled off → NO letterhead at all (no logo, no company name, no
             address block). Restores the original clean look: just the left-aligned
             report title with its underline, then the Job Details. */
          <View style={styles.reportTitleBlock}>
            <Text style={styles.reportTitle}>{reportTitle}</Text>
          </View>
        ) : (
          <>
            {/* Letterhead — matches the invoice. First page only (not fixed).
                logoSrc present → the graphic logo (unchanged original);
                absent (logo failed to load) → company-name text as a safety net. */}
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={styles.logo} />
            ) : (
              <>
                <Text style={styles.wordmark}>{COMPANY.name}</Text>
                <Text style={styles.tagline}>{COMPANY.tagline}</Text>
              </>
            )}
            <Text style={styles.headLine}>{COMPANY.address}</Text>
            <Text style={styles.headLine}>T {COMPANY.phone}, {COMPANY.phoneAlt}   F {COMPANY.fax}   E {COMPANY.email}</Text>
            <View style={styles.headRule} />
            <Text style={styles.reportTitleCentered}>{reportTitle}</Text>
          </>
        )}

        {/* Job Details — legacy top block for templates WITHOUT show_in_header fields
            (OVID, bunker, UHT…). Flagged templates (e.g. Borescoping) render all of this
            inside their Title/Job Details section instead — see the section loop. */}
        {!useFlagHeader && (
          <View style={styles.jobDetailsBlock}>
            <View style={styles.jobDetailCol}>
              {leftRows.map(r => <DetailRow key={r.label} label={r.label} value={r.value} labelWidth={leftLabelW} hyph={hyph} />)}
            </View>
            <View style={styles.jobDetailCol}>
              {rightRows.map(r => <DetailRow key={r.label} label={r.label} value={r.value} labelWidth={rightLabelW} hyph={hyph} />)}
            </View>
          </View>
        )}
        {!useFlagHeader && preambleNode}

        {/* Summary of findings, up front — a reader should not have to walk 180
            questions to find the handful that matter. Each row still carries its item
            number, so the detail (and any photographs) can be found in place below. */}
        {deficiencySummary && (
          <View style={styles.sectionContainer}>
            <View wrap={false}>
              <View style={styles.sectionHeader}>
                <Text {...hyph} style={styles.sectionTitle}>Summary of Findings</Text>
              </View>
              {findings.length === 0 && (
                <Text {...hyph} style={styles.findingNone}>
                  No item on this checklist was answered adversely.
                </Text>
              )}
            </View>
            {findings.map((f, i) => (
              <View key={i} style={styles.findingRow} wrap={false}>
                <Text style={styles.findingNum}>{f.num}</Text>
                <View style={styles.findingText}>
                  <Text {...hyph} style={styles.findingLabel}>{f.label}</Text>
                  {f.remark ? <Text {...hyph} style={styles.findingRemark}>{f.remark}</Text> : null}
                </View>
                <View style={{ width: 40 }}>
                  <Text style={[styles.yesNoValue, {
                    alignSelf: 'flex-start',
                    backgroundColor: YES_NO_BG[f.amber ? 'amber' : 'red'],
                    color: YES_NO_FG[f.amber ? 'amber' : 'red'],
                  }]}>{f.answer}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Checklist sections. Section descriptions are builder guidance, NOT printed. */}
        {sections.map(section => {
          const bodyFields = (section.fields as any[]).filter((f: any) => !suppressedIds.has(f.id) && f.field_type !== 'photo')
          // pdf_sort_by_item_number (migration 202): print order follows the ITEM NUMBER,
          // not the builder's order_index. A conditional detail field is stored after the
          // tick-list it follows, so the report ran 7.1, 7.2, 7.1A, 7.3 — a numbering error
          // to anyone auditing it, and it separated a finding from its own explanation.
          // Off ⇒ the identical array, by identity.
          const visibleFields = sortByItemNumber ? sortFieldsByItemNumber(bodyFields) : bodyFields
          const photoFields = (section.fields as any[]).filter((f: any) => f.field_type === 'photo')

          // Details section (flagged template): render the whole job/vessel block here —
          // Vessel, then spec fields, then Client + Surveyors, then the remaining fields
          // (Date, Time, Port/Location, Inspection Day Number) in their field order.
          if (useFlagHeader && (section.fields as any[]).some((f: any) => f.show_in_header)) {
            const specFields = (section.fields as any[]).filter((f: any) => f.show_in_header && !isJobBackedField(f))
            const restFields = (section.fields as any[]).filter((f: any) => !f.show_in_header && !['heading', 'divider', 'photo'].includes(f.field_type))
            return (
              <View key={section.id} style={styles.sectionContainer}>
                <View wrap={false}>
                  <View style={styles.sectionHeader}>
                    <Text {...hyph} style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                  {/* The injected job rows take the SAME label width as the real question
                      rows — otherwise a uniform-column template would keep these three at
                      38% while everything else moved to 60%, which is the one silent
                      misalignment this change could introduce. Pre-Hire has no
                      show_in_header field so this branch never runs for it today; it is
                      threaded so whatever opts in next is not broken by an invisible 38%. */}
                  {job.vessel_name ? renderInfoRow('vessel', 'Vessel', withVesselPrefix(job.vessel_name, job.vessel_type), uniformLabelStyle, hyph) : null}
                </View>
                {specFields.map((f: any) => renderRow(f))}
                {job.client?.name && !hideClient ? renderInfoRow('client', 'Client', job.client.name, uniformLabelStyle, hyph) : null}
                {surveyors.length > 0 && !hideSurveyor ? renderInfoRow('surveyors', `Surveyor${surveyors.length > 1 ? 's' : ''}`, surveyors.join(', '), uniformLabelStyle, hyph) : null}
                {restFields.map((f: any) => renderRow(f))}
                {preambleNode}
              </View>
            )
          }

          // Repeatable section: each entry is its own block; that entry's photos follow
          // on a fresh page (6 per page, 2×3), labelled by line — never an anonymous dump.
          if (section.is_repeatable) {
            // pdf_hide_empty_repeatables (migration 202). resolveEntryOrder floors its
            // result at [0] so the EDITOR always has a first blank entry to type into —
            // that floor is load-bearing and stays. On the REPORT it printed a forced page
            // break and one "Entry 1" whose every field was an em dash, on a section
            // titled "Findings" while the Summary of Findings at the front listed nine.
            // It read as broken software and cost a whole page. Ask whether any entry
            // actually carries data; if none does, print nothing at all (which also drops
            // the forced break).
            if (hideEmptyRepeatables
                && !repeatableHasData(section, fieldValues, arrayValues, signatures, [...photos, ...documents])) {
              return null
            }
            const ids = orderedInstancesFor(section, job, fieldValues, arrayValues, signatures, photos)
            return (
              // Inspections normally start on a fresh page (Borescoping prints a page of
              // photos per entry, so a mid-page start reads badly). A section can opt out —
              // Brine's hourly log is a single question in the middle of the checklist, and
              // forcing a break there left most of a page blank between items 24B and 25.
              <View key={section.id} style={styles.sectionContainer} break={(section as any).pdf_page_break !== false}>
                <View wrap={false}>
                  <View style={styles.sectionHeader}>
                    <Text {...hyph} style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                </View>
                {ids.map((inst, pos) => {
                  const lineName = entryName(section, inst, fieldValues)
                  const entryPhotos = photoFields.flatMap((pf: any) => photos.filter(p => p.field_id === pf.id && p.instance === inst))
                  return (
                    <React.Fragment key={inst}>
                      <View style={styles.entryBlock} wrap={false}>
                        <Text {...hyph} style={styles.entryHeading}>Entry {pos + 1}{lineName ? ` — ${lineName}` : ''}</Text>
                        <View style={styles.entryBody}>
                          {visibleFields.map((field: any) => (
                            <React.Fragment key={field.id}>
                              {renderRow(field, inst)}
                              {/* A question inside an entry can carry its own photos too. */}
                              {inlineDocsFor(field, inst)}
                              {inlinePhotosFor(field, inst)}
                            </React.Fragment>
                          ))}
                        </View>
                      </View>
                      {/* Photos flow right after the line (no forced page break) — they fill the
                          page, up to 6 per page (2×3), then continue. */}
                      {entryPhotos.length > 0 && (
                        <>
                          {/* minPresenceAhead keeps the heading with at least the first
                              photo row, so it never sits alone at the bottom of a page. */}
                          <Text {...hyph} style={styles.photoGroupHeading} minPresenceAhead={230}>{lineName || `Entry ${pos + 1}`} — Photographs</Text>
                          <View style={styles.reportPhotoGrid}>
                            {entryPhotos.map((p, i) => (
                              <View key={i} style={styles.reportPhotoItem} wrap={false}>
                                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                <Image src={p.url} style={styles.reportPhotoImage} />
                                <Text {...hyph} style={styles.photoCaption}>{p.caption || `${lineName || `Entry ${pos + 1}`} — Photo ${i + 1}`}</Text>
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                    </React.Fragment>
                  )
                })}
              </View>
            )
          }

          // Ordinary section. With photosInline, a question's photos print immediately
          // beneath that question — the evidence sits with the item it evidences,
          // instead of being pooled onto "Additional Photographs" pages at the back
          // where nothing connects the two. Non-repeatable sections are instance 0.
          // A dedicated photo FIELD keeps its own row out of the body (it has no
          // answer), but its photos still print in its position.
          // A photo field carries no answer row of its own, so it only appears here when
          // it actually holds something. Photos need the template to have opted into
          // inline printing; DOCUMENTS are named regardless, because there is nowhere
          // else for them to appear — they cannot be embedded in the photo grid.
          const sectionPhotoFields = photoFields.filter((pf: any) =>
            (photosInline && photos.some(p => p.field_id === pf.id)) ||
            documents.some(d => d.field_id === pf.id))

          if (visibleFields.length === 0 && sectionPhotoFields.length === 0) return null

          return (
            <View key={section.id} style={styles.sectionContainer}>
              {/* Section header + first field locked together to prevent orphan headers */}
              <View wrap={false}>
                <View style={styles.sectionHeader}>
                  <Text {...hyph} style={styles.sectionTitle}>{section.title}</Text>
                </View>
                {visibleFields.length > 0 && renderRow(visibleFields[0])}
              </View>
              {visibleFields.length > 0 && inlineDocsFor(visibleFields[0], 0)}
              {visibleFields.length > 0 && inlinePhotosFor(visibleFields[0], 0)}

              {visibleFields.slice(1).map((field: any) => (
                <React.Fragment key={field.id}>
                  {renderRow(field)}
                  {inlineDocsFor(field, 0)}
                  {inlinePhotosFor(field, 0)}
                </React.Fragment>
              ))}

              {/* Photo-type fields last: they carry no answer row of their own, so this
                  is the section's "anything else" bucket. */}
              {sectionPhotoFields.map((pf: any) => (
                <React.Fragment key={pf.id}>
                  {/* minPresenceAhead keeps the heading with at least the first photo
                      row, so it never sits alone at the bottom of a page. */}
                  <Text {...hyph} style={styles.photoGroupHeading} minPresenceAhead={230}>
                    {[pf.item_number, pf.label].filter(Boolean).join(' ')}
                  </Text>
                  {inlineDocsFor(pf, 0)}
                  {inlinePhotosFor(pf, 0)}
                </React.Fragment>
              ))}
            </View>
          )
        })}

        {/* Additional (field-less) photos only — line photos already print with their
            entry above. New page, 6 per page (2×3). No anonymous filename dump. */}
        {endPhotos.length > 0 && (() => {
          const chunks: JobPhoto[][] = []
          for (let i = 0; i < endPhotos.length; i += 6) chunks.push(endPhotos.slice(i, i + 6))
          return chunks.map((chunk, ci) => (
            <View key={ci} break>
              <View style={styles.photosSectionHeader}>
                <Text {...hyph} style={styles.sectionTitle}>Additional Photographs{chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}</Text>
              </View>
              <View style={styles.reportPhotoGrid}>
                {chunk.map((p, i) => (
                  <View key={i} style={styles.reportPhotoItem} wrap={false}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <Image src={p.url} style={styles.reportPhotoImage} />
                    <Text {...hyph} style={styles.photoCaption}>{p.caption || `Additional — Photo ${ci * 6 + i + 1}`}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))
        })()}

        {/* Legacy photo note — only when photos exist but are NOT embedded in the PDF */}
        {photoCount > 0 && photos.length === 0 && (
          <View style={styles.photoNote}>
            <Text style={styles.photoNoteText}>
              Note: {photoCount} photo{photoCount !== 1 ? 's' : ''} attached to this job are stored internally and not included in this PDF.
            </Text>
          </View>
        )}

        {/* Fixed disclaimer boilerplate (template.pdf_disclaimer) */}
        {disclaimer && (
          <View style={styles.disclaimer} wrap={false}>
            <Text {...hyph} style={styles.disclaimerText}>{disclaimer}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'left' }]}>{COMPANY.name} — {COMPANY.confidential}</Text>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'center' }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={[styles.footerText, { flex: 1, textAlign: 'right' }]}>{pageReference}</Text>
        </View>
      </Page>
    </Document>
  )
}

// How many entries a repeatable section has = 1 + the highest instance seen across
// any of its fields' values / signatures / photos.
// The display order of a repeatable section's entry instance ids: the saved order
// (job.repeatable_order, migration 106) reconciled with the instances that actually
// have data; absent ⇒ natural ascending order (legacy reports unchanged).
function orderedInstancesFor(
  section: any,
  job: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  photos: JobPhoto[]
): number[] {
  const fieldIds = (section.fields ?? []).map((f: any) => f.id)
  const stored = (job?.repeatable_order ?? {})[section.id] as number[] | undefined
  return resolveEntryOrderFromData(fieldIds, [fieldValues, arrayValues, signatures], photos, stored)
}

// A short human label for a repeatable entry — the first text field's value (e.g. the
// Cargo Line Name), so photos/headers read "Entry 2 — No.3 Cargo Line".
function entryName(section: any, inst: number, fieldValues: Record<string, string>): string {
  const f = (section.fields ?? []).find((x: any) => x.field_type === 'text')
  if (!f) return ''
  return (fieldValues[instanceKey(f.id, inst)] ?? '').trim()
}

function renderField(
  field: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  allFieldsFlat: any[],
  inst = 0,
  // Per-template presentation options (migration 202). Defaults to `{}` so a caller
  // that passes nothing renders exactly the row that ships today.
  opts: RowOptions = {}
): React.ReactElement | null {
  if (!field) return null

  const hyph = opts.hyph ?? {}

  // Repeatable-section instance: read this entry's value (instance 0 = bare id).
  const key = instanceKey(field.id, inst)

  if (field.field_type === 'divider') {
    return <View key={key} style={styles.dividerLine} />
  }

  if (field.field_type === 'heading') {
    return <Text key={key} {...hyph} style={styles.inlineHeading}>{field.label}</Text>
  }

  // multiple_choice prints ONLY the chosen answers, as their labels (custom "Other"
  // entries don't match an option, so they print as their own text).
  // pdf_sort_choices (migration 202): a tick-list is stored in the order the surveyor
  // TAPPED it, so a statutory certificate list printed in a scrambled order and a client
  // cross-checking it had to hunt each entry. Off => the stored order, untouched.
  // A free-text "Other" entry matches no option (index -1) and is pushed to the END in
  // its own stored order, rather than sorted to the front.
  const chosenValues: string[] = arrayValues[key] ?? []
  const orderedChoices: string[] = opts.sortChoices
    ? chosenValues
        .map((v: string, i: number) => {
          const idx = (field.options ?? []).findIndex((o: any) => o.value === v)
          return { v, rank: idx < 0 ? Number.MAX_SAFE_INTEGER : idx, i }
        })
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(x => x.v)
    : chosenValues

  const rawValue = field.field_type === 'multiple_choice'
    ? orderedChoices.map((v: string) => (field.options ?? []).find((o: any) => o.value === v)?.label ?? v).join(', ')
    : fieldValues[key] ?? ''

  const hasValue = !!rawValue

  // Opt-in per field: leave the row out entirely when it was not filled in, rather than
  // printing a "—" placeholder. Meant for free-text notes ("Observations / defects") that
  // are usually blank, especially inside a repeatable entry where one empty row per entry
  // adds up. Deliberately NOT the default: for a question the surveyor was asked, a "—"
  // is meaningful — it shows the question existed and went unanswered, which silently
  // omitting it would hide from whoever reads the signed report.
  if (field.pdf_hide_when_empty && !hasValue
      && !(signatures[key] || (arrayValues[key] ?? []).length)) {
    return null
  }

  // Short-answer rows get a WIDE question column (so the question fits on one line and
  // the value column keeps just enough for the answer + a short remark). Long-answer
  // types keep the narrow label so their value has room to wrap onto multiple lines.
  const NARROW_LABEL_TYPES = new Set(['textarea', 'video_link', 'multiple_choice'])
  // A template can opt out of the per-type split entirely: ONE width for every row, so
  // the value column never moves down the page. See styles.fieldLabelUniform and
  // checklist_templates.pdf_uniform_label_width, migration 202.
  const labelStyle = opts.uniformLabelWidth
    ? styles.fieldLabelUniform
    : (NARROW_LABEL_TYPES.has(field.field_type) ? styles.fieldLabel : styles.fieldLabelWide)

  // Fixed-width number cell sized to the WIDEST item number in the report, so every
  // question's wording starts at the same x regardless of 1- vs 2-digit numbers. 0 when
  // the report has no item numbers at all (then no cell is reserved).
  const maxItemNumLen = Math.max(0, ...allFieldsFlat.map((f: any) => (f.item_number ?? '').length))
  const numColWidth = maxItemNumLen > 0 ? maxItemNumLen * 5.2 + 4 : 0

  // Keep a short-answer row intact across page breaks: if it doesn't fit at the bottom of
  // a page the WHOLE row (number + question + answer + remark) moves to the next page
  // together, instead of stranding the number/answer on the previous page while the
  // wrapped question jumps down. Long-value types (textarea/multiple-choice/video) can
  // legitimately be taller than the remaining space, so they keep default wrapping.
  //
  // This and the label width above used to be the SAME predicate. They are two unrelated
  // concerns — "how wide is the question column" and "may this row split across a page
  // break" — and uniformLabelWidth takes the first one away. The membership below is a
  // DELIBERATE copy of the historic set, not an accident of the refactor: page breaks are
  // therefore unchanged in BOTH modes. Keep them as literal duplicates so they are free
  // to diverge later.
  const ROW_MAY_SPLIT_TYPES = new Set(['textarea', 'video_link', 'multiple_choice'])
  const rowWrap = ROW_MAY_SPLIT_TYPES.has(field.field_type)

  // pdf_remark_below (migration 202). The answer badge and its remark sit side by side so
  // a short comment never pushes the row onto a second line — right at five words, wrong
  // at three hundred characters, where it becomes a tall ragged ribbon in a ~155pt strip
  // beside a question column that is mostly white space. Only genuinely long remarks
  // move; the resulting block is allowed to split across a page, because it can
  // legitimately be tall, while the row itself still stays intact.
  const isAnswerRow = field.field_type === 'yes_no' || field.field_type === 'yes_no_na' || field.field_type === 'pass_fail'
  const rowRemark = isAnswerRow && rawValue.includes('|||') ? rawValue.split('|||')[1] ?? '' : ''
  const moveRemarkBelow = opts.remarkBelow === true && rowRemark.trim().length > REMARK_BELOW_MIN_CHARS
  // With the remark moved out, the value cell renders the answer badge alone.
  const cellValue = moveRemarkBelow ? rawValue.split('|||')[0] : rawValue

  const row = (
    <View key={key} style={moveRemarkBelow ? styles.fieldRowRemarkAbove : styles.fieldRow} wrap={moveRemarkBelow ? false : rowWrap}>
      <View style={[labelStyle, { flexDirection: 'row' }]}>
        {numColWidth > 0 ? (
          <Text style={[styles.itemNumberText, { width: numColWidth }]}>{field.item_number ?? ''}</Text>
        ) : null}
        <Text {...hyph} style={[styles.fieldLabelText, { flex: 1 }]}>
          {resolvePdfLabel(field.label, fieldValues, allFieldsFlat)}
          {/* No required-asterisk in the report — that marker is only for the survey form. */}
        </Text>
        {/* help_text is on-screen surveyor guidance only — intentionally omitted
            from the PDF so the report shows just the question + answer. */}
      </View>

      <View style={styles.fieldValue}>
        {field.field_type === 'signature' ? (
          signatures[key] ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={signatures[key]} style={styles.signatureImage} />
          ) : (
            <Text {...hyph} style={styles.fieldValueEmpty}>No signature</Text>
          )
        ) : isAnswerRow ? (
          <YesNoCell rawValue={cellValue} options={field.options} hyph={hyph} />
        ) : field.field_type === 'textarea' ? (
          <Text {...hyph} style={styles.textareaValue}>{rawValue || '—'}</Text>
        ) : field.field_type === 'calculated' ? (
          <CalcDiffCell
            rawValue={rawValue}
            validation={field.validation}
            formula={field.calculation_formula}
            fieldValues={fieldValues}
            instance={inst}
            unit={field.unit}
          />
        ) : field.field_type === 'dropdown' ? (
          <Text {...hyph} style={hasValue ? styles.fieldValueText : styles.fieldValueEmpty}>
            {hasValue ? resolveDropdownValue(field, rawValue) : '—'}
          </Text>
        ) : field.field_type === 'video_link' ? (
          (() => {
            const links = (arrayValues[key] ?? []).filter(Boolean)
            if (links.length === 0) return <Text style={styles.fieldValueEmpty}>—</Text>
            return (
              <View>
                {links.map((url, i) => (
                  <Link key={i} src={url} style={styles.videoLink}>
                    {links.length > 1 ? `Video ${i + 1}: ` : ''}{url}
                  </Link>
                ))}
              </View>
            )
          })()
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text {...hyph} style={hasValue ? styles.fieldValueText : styles.fieldValueEmpty}>
              {hasValue ? (field.field_type === 'number' && !isNaN(Number(rawValue)) ? Number(rawValue).toLocaleString('en-US') : plainDisplayValue(field, rawValue, opts)) : '—'}
            </Text>
            {field.unit && hasValue && <Text style={styles.fieldUnit}>{field.unit}</Text>}
          </View>
        )}
      </View>
    </View>
  )

  if (!moveRemarkBelow) return row

  // The row proper carries no bottom rule in this mode — the remark block beneath it
  // does, so one rule still closes the question. Indented to the question's own text
  // column so it reads as a continuation of the row above, not as a new item.
  return (
    <View key={key} wrap>
      {row}
      <View style={styles.remarkBelowBlock}>
        <Text {...hyph} style={[styles.remarkBelowText, { paddingLeft: numColWidth }]}>{rowRemark}</Text>
      </View>
    </View>
  )
}

/** The plain-value branch's text. Only pdf_format_dates changes it, and only for a date
 *  field holding an exact ISO date — a hand-typed "Wk 35 - Aug 2026" is left alone.
 *  (Migration 202.) */
function plainDisplayValue(field: any, rawValue: string, opts: RowOptions): string {
  if (opts.formatDates && field.field_type === 'date') return formatReportDate(rawValue)
  return rawValue
}
