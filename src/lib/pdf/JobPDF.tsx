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
import { format, parseISO } from 'date-fns'
import { formatDiffPercentage, isSurveyedVesselNameField } from '@/lib/utils'
import { instanceKey, parseInstanceKey } from '@/lib/offline/instanceKeys'
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
    marginBottom: 8,
    paddingBottom: 5,
    borderBottomWidth: 2,
    borderBottomColor: '#1d4ed8',
  },
  reportTitle: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
  },
  // Job details block — two balanced columns (left: vessel/date, right: port/method)
  jobDetailsBlock: {
    backgroundColor: '#f8fafc',
    borderRadius: 3,
    padding: '5 8',
    marginBottom: 8,
    flexDirection: 'row',
  },
  jobDetailCol: {
    width: '50%',
    flexDirection: 'column',
    paddingRight: 8,
  },
  jobDetailRow: {
    flexDirection: 'row',
    marginBottom: 3,
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
  fieldLabelText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
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
    objectFit: 'cover',
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
  },
  // Repeatable-section entry block
  entryBlock: {
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    padding: '4 6',
    marginBottom: 4,
  },
  entryHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    marginBottom: 2,
  },
  disclaimer: {
    marginTop: 10,
    padding: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
    borderRadius: 2,
  },
  disclaimerText: {
    fontSize: 6.5,
    color: '#64748b',
    fontStyle: 'italic',
    lineHeight: 1.4,
  },
})

/**
 * Ensures a vessel name is displayed with exactly one "M.V. " prefix.
 * Strips any existing M.V./MV prefix (any casing, optional dots/spaces) before
 * adding a canonical one — prevents "M.V. M.V. ..." double-prefix.
 */
function withMvPrefix(name: string | null | undefined): string {
  if (!name) return ''
  const stripped = name.replace(/^(m\.?\s*v\.?\s*)+/i, '').trim()
  return stripped ? `M.V. ${stripped}` : ''
}

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
  return (
    <View>
      <Text style={[styles.yesNoValue, { backgroundColor: YES_NO_BG[c] ?? '#f1f5f9', color: YES_NO_FG[c] ?? '#94a3b8' }]}>
        {answerKey ? answerKey.toUpperCase() : '—'}
      </Text>
      {remarks ? <Text style={{ fontSize: 7.5, color: '#64748b', marginTop: 2 }}>{remarks}</Text> : null}
    </View>
  )
}

// Handles both percentage-display calculated fields (shows "<diff> USG: <pct>%") and plain numbers
function CalcDiffCell({ rawValue, validation, formula, fieldValues }: {
  rawValue: string
  validation: any
  formula?: string
  fieldValues: Record<string, string>
}) {
  const num = parseFloat(rawValue)
  if (isNaN(num)) return <Text style={{ fontSize: 8, color: '#94a3b8' }}>—</Text>

  if (validation?.display_as === 'percentage') {
    const tokens = Array.from((formula ?? '').matchAll(/\{([^}]+)\}/g), m => m[1])
    const denominatorId = tokens[tokens.length - 1]
    const { display, pct } = formatDiffPercentage(num, denominatorId ? fieldValues[denominatorId] : undefined)

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
  /** Company letterhead logo as a data URI (loaded server-side). */
  logoSrc?: string
  /** Names of the surveyors assigned to the job, printed in the header. */
  surveyors?: string[]
}

export function JobPDF({ job, sections, fieldValues, arrayValues, signatures, photoCount, photos = [], disclaimer = null, logoSrc, surveyors = [] }: PDFProps) {
  const allFieldsFlat = sections.flatMap((s: any) => s.fields ?? [])

  // Photo fields inside a repeatable section render INLINE per entry (above), so keep
  // them out of the end-of-report grid to avoid showing them twice.
  const repeatablePhotoFieldIds = new Set<string>()
  for (const s of sections as any[]) {
    if (s.is_repeatable) for (const f of (s.fields ?? [])) if (f.field_type === 'photo') repeatablePhotoFieldIds.add(f.id)
  }
  const endPhotos = photos.filter(p => !(p.field_id && repeatablePhotoFieldIds.has(p.field_id)))

  // Locate key Job Detail fields by label pattern
  const bunkerVesselField = allFieldsFlat.find((f: any) =>
    /bunker/i.test(f.label) && /vessel/i.test(f.label)
  ) ?? null
  // The surveyed vessel's NAME field only — excludes descriptor fields
  // ("Vessel IMO Number", "Vessel Type", …) and the bunker vessel.
  const vesselField = allFieldsFlat.find((f: any) =>
    isSurveyedVesselNameField(f.label) && f.id !== bunkerVesselField?.id
  ) ?? null
  const dateField = allFieldsFlat.find((f: any) => /\bdate\b/i.test(f.label)) ?? null
  const portField = allFieldsFlat.find((f: any) => /\bport\b/i.test(f.label)) ?? null
  const methodField = allFieldsFlat.find((f: any) => /method.*delivery|delivery.*method/i.test(f.label)) ?? null

  // These are shown in the Job Details block — suppress them from the section body
  const suppressedIds = new Set<string>(
    [vesselField?.id, dateField?.id, portField?.id, methodField?.id, bunkerVesselField?.id]
      .filter((id): id is string => !!id)
  )

  const methodRaw = methodField ? (fieldValues[methodField.id] ?? '') : ''
  const methodDisplay = methodField ? resolveDropdownValue(methodField, methodRaw) : ''
  const showBunkerVessel = methodRaw === 'bunker_vessel' && !!bunkerVesselField

  const reportTitle = job.template?.name ?? job.title

  return (
    <Document
      title={`${job.title} — ${job.job_number ?? 'Draft'}`}
      author={COMPANY.name}
      subject="Survey Checklist Report"
    >
      <Page size="LETTER" style={styles.page}>

        {/* Letterhead — matches the invoice. First page only (not fixed). */}
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

        {/* Report title */}
        <Text style={styles.reportTitleCentered}>{reportTitle}</Text>

        {/* Job Details — two balanced columns: vessel/date left, port/method right */}
        <View style={styles.jobDetailsBlock}>
          <View style={styles.jobDetailCol}>
            {job.vessel_name && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Vessel:</Text>
                <Text style={styles.jobDetailValue}>{withMvPrefix(job.vessel_name)}</Text>
              </View>
            )}
            {job.client?.name && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Client:</Text>
                <Text style={styles.jobDetailValue}>{job.client.name}</Text>
              </View>
            )}
            {dateField && fieldValues[dateField.id] && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Date:</Text>
                <Text style={styles.jobDetailValue}>{fieldValues[dateField.id]}</Text>
              </View>
            )}
            {surveyors.length > 0 && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Surveyor{surveyors.length > 1 ? 's' : ''}:</Text>
                <Text style={styles.jobDetailValue}>{surveyors.join(', ')}</Text>
              </View>
            )}
          </View>
          <View style={styles.jobDetailCol}>
            {portField && fieldValues[portField.id] && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Port:</Text>
                <Text style={styles.jobDetailValue}>{fieldValues[portField.id]}</Text>
              </View>
            )}
            {methodDisplay && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Method of Delivery:</Text>
                <Text style={styles.jobDetailValue}>{methodDisplay}</Text>
              </View>
            )}
            {showBunkerVessel && fieldValues[bunkerVesselField!.id] && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Bunker Vessel Name:</Text>
                <Text style={styles.jobDetailValue}>{fieldValues[bunkerVesselField!.id]}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Checklist sections. Section descriptions are builder guidance, NOT printed. */}
        {sections.map(section => {
          const visibleFields = (section.fields as any[]).filter((f: any) => !suppressedIds.has(f.id) && f.field_type !== 'photo')
          const photoFields = (section.fields as any[]).filter((f: any) => f.field_type === 'photo')

          // Repeatable section: each entry is its own block; that entry's photos follow
          // on a fresh page (6 per page, 2×3), labelled by line — never an anonymous dump.
          if (section.is_repeatable) {
            const count = instanceCountFor(section, fieldValues, arrayValues, signatures, photos)
            return (
              <View key={section.id} style={styles.sectionContainer}>
                <View wrap={false}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                </View>
                {Array.from({ length: count }).map((_, inst) => {
                  const lineName = entryName(section, inst, fieldValues)
                  const entryPhotos = photoFields.flatMap((pf: any) => photos.filter(p => p.field_id === pf.id && p.instance === inst))
                  const chunks: JobPhoto[][] = []
                  for (let i = 0; i < entryPhotos.length; i += 6) chunks.push(entryPhotos.slice(i, i + 6))
                  return (
                    <React.Fragment key={inst}>
                      <View style={styles.entryBlock} wrap={false}>
                        <Text style={styles.entryHeading}>Entry {inst + 1}{lineName ? ` — ${lineName}` : ''}</Text>
                        {visibleFields.map((field: any) => renderField(field, fieldValues, arrayValues, signatures, allFieldsFlat, inst))}
                      </View>
                      {chunks.map((chunk, ci) => (
                        <View key={ci} break>
                          <View style={styles.photosSectionHeader}>
                            <Text style={styles.sectionTitle}>{lineName || `Entry ${inst + 1}`} — Photographs{chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}</Text>
                          </View>
                          <View style={styles.reportPhotoGrid}>
                            {chunk.map((p, i) => (
                              <View key={i} style={styles.reportPhotoItem} wrap={false}>
                                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                <Image src={p.url} style={styles.reportPhotoImage} />
                                <Text style={styles.photoCaption}>{p.caption || `${lineName || `Entry ${inst + 1}`} — Photo ${ci * 6 + i + 1}`}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ))}
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
          <Text style={[styles.footerText, { flex: 1, textAlign: 'left' }]}>{COMPANY.name} — Confidential</Text>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'center' }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={[styles.footerText, { flex: 1, textAlign: 'right' }]}>{job.job_number ?? 'Draft'}</Text>
        </View>
      </Page>
    </Document>
  )
}

// How many entries a repeatable section has = 1 + the highest instance seen across
// any of its fields' values / signatures / photos.
function instanceCountFor(
  section: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  photos: JobPhoto[]
): number {
  const fieldIds = new Set((section.fields ?? []).map((f: any) => f.id))
  let max = 0
  for (const map of [fieldValues, arrayValues, signatures]) {
    for (const k of Object.keys(map)) {
      const { fieldId, instance } = parseInstanceKey(k)
      if (fieldIds.has(fieldId) && instance > max) max = instance
    }
  }
  for (const p of photos) if (p.field_id && fieldIds.has(p.field_id) && p.instance > max) max = p.instance
  return max + 1
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

  return (
    <View key={key} style={styles.fieldRow}>
      <View style={styles.fieldLabel}>
        <Text style={styles.fieldLabelText}>
          {field.item_number ? <Text style={{ color: '#1d4ed8' }}>{field.item_number}{'  '}</Text> : null}
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
              {hasValue ? rawValue : '—'}
            </Text>
            {field.unit && hasValue && <Text style={styles.fieldUnit}>{field.unit}</Text>}
          </View>
        )}
      </View>
    </View>
  )
}
