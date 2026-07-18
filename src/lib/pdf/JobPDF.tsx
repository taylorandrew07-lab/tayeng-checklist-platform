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
import { resolveEntryOrderFromData } from '@/lib/checklist/entryOrder'
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

function YesNoCell({ rawValue, options }: { rawValue: string; options: any[] | null | undefined }) {
  const answerKey = rawValue.includes('|||') ? rawValue.split('|||')[0] : rawValue
  const remarks = rawValue.includes('|||') ? rawValue.split('|||')[1] : ''
  const optColor = (options ?? []).find((o: any) => o.value === answerKey)?.color as string | undefined
  const fallback = answerKey === 'yes' ? 'green' : answerKey === 'no' ? 'red' : 'gray'
  const c = optColor ?? fallback
  // Answer and its remark sit in TWO columns on ONE line (fixed-width answer badge,
  // remark beside it) so a comment never pushes the row onto a second line — keeps the
  // whole checklist compact / single-page. alignSelf keeps the coloured pill tight.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 40 }}>
        <Text style={[styles.yesNoValue, { alignSelf: 'flex-start', backgroundColor: YES_NO_BG[c] ?? '#f1f5f9', color: YES_NO_FG[c] ?? '#94a3b8' }]}>
          {answerKey ? answerKey.toUpperCase() : '—'}
        </Text>
      </View>
      {remarks ? <Text style={{ flex: 1, fontSize: 7.5, color: '#64748b', marginLeft: 4 }}>{remarks}</Text> : null}
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

function DetailRow({ label, value, labelWidth }: { label: string; value: string; labelWidth?: number }) {
  return (
    <View style={styles.jobDetailRow}>
      {/* Fixed-width, right-aligned label so every colon in the column lines up and the
          values all start at the same x (e.g. "Vessel:" / "Date:" colons align). */}
      <Text style={[styles.jobDetailLabel, labelWidth ? { width: labelWidth, textAlign: 'right' as const } : {}]}>{label}:</Text>
      <Text style={[styles.jobDetailValue, { flex: 1 }]}>{value}</Text>
    </View>
  )
}

// A field-row-styled row for injected job-record values (Vessel/Client/Surveyors), so
// they sit consistently among the real fields in a details section.
function renderInfoRow(key: string, label: string, value: string): React.ReactElement {
  return (
    <View key={key} style={styles.fieldRow}>
      <View style={styles.fieldLabel}><Text style={styles.fieldLabelText}>{label}</Text></View>
      <View style={styles.fieldValue}><Text style={styles.fieldValueText}>{value}</Text></View>
    </View>
  )
}

export function JobPDF({ job, sections, fieldValues, arrayValues, signatures, photoCount, photos = [], disclaimer = null, preamble = null, logoSrc, hideLogo = false, surveyors = [], hideClient = false, hideSurveyor = false, balancedHeader = false }: PDFProps) {
  const allFieldsFlat = sections.flatMap((s: any) => s.fields ?? [])
  const preambleNode = preamble ? <Text style={styles.preamble}>{preamble}</Text> : null

  // Photo fields inside a repeatable section render INLINE per entry (above), so keep
  // them out of the end-of-report grid to avoid showing them twice.
  const repeatablePhotoFieldIds = new Set<string>()
  for (const s of sections as any[]) {
    if (s.is_repeatable) for (const f of (s.fields ?? [])) if (f.field_type === 'photo') repeatablePhotoFieldIds.add(f.id)
  }
  const endPhotos = photos.filter(p => !(p.field_id && repeatablePhotoFieldIds.has(p.field_id)))

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
  const dateField = headerCandidates.find((f: any) => /\bdate\b/i.test(f.label)) ?? null
  const portField = headerCandidates.find((f: any) => /\bport\b/i.test(f.label)) ?? null
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

  // The header rows that actually have a value, in print order.
  const headerRows: Array<{ label: string; value: string }> = [
    job.vessel_name ? { label: 'Vessel', value: withVesselPrefix(job.vessel_name) } : null,
    job.client?.name && !hideClient ? { label: 'Client', value: job.client.name } : null,
    dateField && fieldValues[dateField.id] ? { label: 'Date', value: fieldValues[dateField.id] } : null,
    surveyors.length > 0 && !hideSurveyor
      ? { label: `Surveyor${surveyors.length > 1 ? 's' : ''}`, value: surveyors.join(', ') } : null,
    portField && fieldValues[portField.id] ? { label: 'Port', value: fieldValues[portField.id] } : null,
    methodDisplay ? { label: 'Method of Delivery', value: methodDisplay } : null,
    showBunkerVessel && bunkerVesselField && fieldValues[bunkerVesselField.id]
      ? { label: 'Bunker Vessel Name', value: fieldValues[bunkerVesselField.id] } : null,
  ].filter((r): r is { label: string; value: string } => !!r)

  const [leftRows, rightRows] = splitHeaderRows(headerRows, balancedHeader)

  const leftLabelW = labelColWidth(leftRows.map(r => r.label))
  const rightLabelW = labelColWidth(rightRows.map(r => r.label))

  const reportTitle = job.template?.name ?? job.title

  return (
    <Document
      title={`${job.title} — ${job.job_number ?? 'Draft'}`}
      author={COMPANY.name}
      subject="Survey Checklist Report"
    >
      <Page size="LETTER" style={styles.page}>

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
              {leftRows.map(r => <DetailRow key={r.label} label={r.label} value={r.value} labelWidth={leftLabelW} />)}
            </View>
            <View style={styles.jobDetailCol}>
              {rightRows.map(r => <DetailRow key={r.label} label={r.label} value={r.value} labelWidth={rightLabelW} />)}
            </View>
          </View>
        )}
        {!useFlagHeader && preambleNode}

        {/* Checklist sections. Section descriptions are builder guidance, NOT printed. */}
        {sections.map(section => {
          const visibleFields = (section.fields as any[]).filter((f: any) => !suppressedIds.has(f.id) && f.field_type !== 'photo')
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
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                  {job.vessel_name ? renderInfoRow('vessel', 'Vessel', withVesselPrefix(job.vessel_name)) : null}
                </View>
                {specFields.map((f: any) => renderField(f, fieldValues, arrayValues, signatures, allFieldsFlat))}
                {job.client?.name && !hideClient ? renderInfoRow('client', 'Client', job.client.name) : null}
                {surveyors.length > 0 && !hideSurveyor ? renderInfoRow('surveyors', `Surveyor${surveyors.length > 1 ? 's' : ''}`, surveyors.join(', ')) : null}
                {restFields.map((f: any) => renderField(f, fieldValues, arrayValues, signatures, allFieldsFlat))}
                {preambleNode}
              </View>
            )
          }

          // Repeatable section: each entry is its own block; that entry's photos follow
          // on a fresh page (6 per page, 2×3), labelled by line — never an anonymous dump.
          if (section.is_repeatable) {
            const ids = orderedInstancesFor(section, job, fieldValues, arrayValues, signatures, photos)
            return (
              // Inspections start on a fresh page (after Job Details + preamble).
              <View key={section.id} style={styles.sectionContainer} break>
                <View wrap={false}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                </View>
                {ids.map((inst, pos) => {
                  const lineName = entryName(section, inst, fieldValues)
                  const entryPhotos = photoFields.flatMap((pf: any) => photos.filter(p => p.field_id === pf.id && p.instance === inst))
                  return (
                    <React.Fragment key={inst}>
                      <View style={styles.entryBlock} wrap={false}>
                        <Text style={styles.entryHeading}>Entry {pos + 1}{lineName ? ` — ${lineName}` : ''}</Text>
                        <View style={styles.entryBody}>
                          {visibleFields.map((field: any) => renderField(field, fieldValues, arrayValues, signatures, allFieldsFlat, inst))}
                        </View>
                      </View>
                      {/* Photos flow right after the line (no forced page break) — they fill the
                          page, up to 6 per page (2×3), then continue. */}
                      {entryPhotos.length > 0 && (
                        <>
                          {/* minPresenceAhead keeps the heading with at least the first
                              photo row, so it never sits alone at the bottom of a page. */}
                          <Text style={styles.photoGroupHeading} minPresenceAhead={230}>{lineName || `Entry ${pos + 1}`} — Photographs</Text>
                          <View style={styles.reportPhotoGrid}>
                            {entryPhotos.map((p, i) => (
                              <View key={i} style={styles.reportPhotoItem} wrap={false}>
                                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                <Image src={p.url} style={styles.reportPhotoImage} />
                                <Text style={styles.photoCaption}>{p.caption || `${lineName || `Entry ${pos + 1}`} — Photo ${i + 1}`}</Text>
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

          if (visibleFields.length === 0) return null

          return (
            <View key={section.id} style={styles.sectionContainer}>
              {/* Section header + first field locked together to prevent orphan headers */}
              <View wrap={false}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                </View>
                {renderField(visibleFields[0], fieldValues, arrayValues, signatures, allFieldsFlat)}
              </View>

              {/* Remaining fields wrap freely */}
              {visibleFields.slice(1).map((field: any) =>
                renderField(field, fieldValues, arrayValues, signatures, allFieldsFlat)
              )}
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
                <Text style={styles.sectionTitle}>Additional Photographs{chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}</Text>
              </View>
              <View style={styles.reportPhotoGrid}>
                {chunk.map((p, i) => (
                  <View key={i} style={styles.reportPhotoItem} wrap={false}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <Image src={p.url} style={styles.reportPhotoImage} />
                    <Text style={styles.photoCaption}>{p.caption || `Additional — Photo ${ci * 6 + i + 1}`}</Text>
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
            <Text style={styles.disclaimerText}>{disclaimer}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'left' }]}>{COMPANY.name} — {COMPANY.confidential}</Text>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'center' }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={[styles.footerText, { flex: 1, textAlign: 'right' }]}>{job.job_number ?? 'Draft'}</Text>
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
  inst = 0
): React.ReactElement | null {
  if (!field) return null

  // Repeatable-section instance: read this entry's value (instance 0 = bare id).
  const key = instanceKey(field.id, inst)

  if (field.field_type === 'divider') {
    return <View key={key} style={styles.dividerLine} />
  }

  if (field.field_type === 'heading') {
    return <Text key={key} style={styles.inlineHeading}>{field.label}</Text>
  }

  // multiple_choice prints ONLY the chosen answers, as their labels (custom "Other"
  // entries don't match an option, so they print as their own text).
  const rawValue = field.field_type === 'multiple_choice'
    ? (arrayValues[key] ?? []).map((v: string) => (field.options ?? []).find((o: any) => o.value === v)?.label ?? v).join(', ')
    : fieldValues[key] ?? ''

  const hasValue = !!rawValue

  // Short-answer rows get a WIDE question column (so the question fits on one line and
  // the value column keeps just enough for the answer + a short remark). Long-answer
  // types keep the narrow label so their value has room to wrap onto multiple lines.
  const NARROW_LABEL_TYPES = new Set(['textarea', 'video_link', 'multiple_choice'])
  const labelStyle = NARROW_LABEL_TYPES.has(field.field_type) ? styles.fieldLabel : styles.fieldLabelWide

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
  const rowWrap = NARROW_LABEL_TYPES.has(field.field_type)

  return (
    <View key={key} style={styles.fieldRow} wrap={rowWrap}>
      <View style={[labelStyle, { flexDirection: 'row' }]}>
        {numColWidth > 0 ? (
          <Text style={[styles.itemNumberText, { width: numColWidth }]}>{field.item_number ?? ''}</Text>
        ) : null}
        <Text style={[styles.fieldLabelText, { flex: 1 }]}>
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
            <Text style={styles.fieldValueEmpty}>No signature</Text>
          )
        ) : field.field_type === 'yes_no' || field.field_type === 'yes_no_na' || field.field_type === 'pass_fail' ? (
          <YesNoCell rawValue={rawValue} options={field.options} />
        ) : field.field_type === 'textarea' ? (
          <Text style={styles.textareaValue}>{rawValue || '—'}</Text>
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
          <Text style={hasValue ? styles.fieldValueText : styles.fieldValueEmpty}>
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
            <Text style={hasValue ? styles.fieldValueText : styles.fieldValueEmpty}>
              {hasValue ? (field.field_type === 'number' && !isNaN(Number(rawValue)) ? Number(rawValue).toLocaleString('en-US') : rawValue) : '—'}
            </Text>
            {field.unit && hasValue && <Text style={styles.fieldUnit}>{field.unit}</Text>}
          </View>
        )}
      </View>
    </View>
  )
}
