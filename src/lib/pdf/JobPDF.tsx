import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'
import { format, parseISO } from 'date-fns'
import { formatDiffPercentage, isSurveyedVesselNameField } from '@/lib/utils'
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

interface PDFProps {
  job: any
  sections: any[]
  fieldValues: Record<string, string>
  arrayValues: Record<string, string[]>
  signatures: Record<string, string>
  photoCount: number
}

export function JobPDF({ job, sections, fieldValues, arrayValues, signatures, photoCount }: PDFProps) {
  const allFieldsFlat = sections.flatMap((s: any) => s.fields ?? [])

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
      <Page size="A4" style={styles.page}>

        {/* Report title only — no company block */}
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle}>{reportTitle}</Text>
        </View>

        {/* Job Details — two balanced columns: vessel/date left, port/method right */}
        <View style={styles.jobDetailsBlock}>
          <View style={styles.jobDetailCol}>
            {job.vessel_name && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Vessel:</Text>
                <Text style={styles.jobDetailValue}>{withMvPrefix(job.vessel_name)}</Text>
              </View>
            )}
            {dateField && fieldValues[dateField.id] && (
              <View style={styles.jobDetailRow}>
                <Text style={styles.jobDetailLabel}>Date:</Text>
                <Text style={styles.jobDetailValue}>{fieldValues[dateField.id]}</Text>
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

        {/* Checklist sections */}
        {sections.map(section => {
          const visibleFields = (section.fields as any[]).filter((f: any) => !suppressedIds.has(f.id) && f.field_type !== 'photo')
          if (visibleFields.length === 0) return null

          return (
            <View key={section.id} style={styles.sectionContainer}>
              {/* Section header + first field locked together to prevent orphan headers */}
              <View wrap={false}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.description && (
                    <Text style={styles.sectionDescription}>{section.description}</Text>
                  )}
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

        {/* Photo note */}
        {photoCount > 0 && (
          <View style={styles.photoNote}>
            <Text style={styles.photoNoteText}>
              Note: {photoCount} photo{photoCount !== 1 ? 's' : ''} attached to this job are stored internally and not included in this PDF.
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{COMPANY.name} — Confidential</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={styles.footerText}>{job.job_number ?? 'Draft'}</Text>
        </View>
      </Page>
    </Document>
  )
}

function renderField(
  field: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  allFieldsFlat: any[]
): React.ReactElement | null {
  if (!field) return null

  if (field.field_type === 'divider') {
    return <View key={field.id} style={styles.dividerLine} />
  }

  if (field.field_type === 'heading') {
    return <Text key={field.id} style={styles.inlineHeading}>{field.label}</Text>
  }

  const rawValue = field.field_type === 'multiple_choice'
    ? (arrayValues[field.id] ?? []).join(', ')
    : fieldValues[field.id] ?? ''

  const hasValue = !!rawValue

  return (
    <View key={field.id} style={styles.fieldRow}>
      <View style={styles.fieldLabel}>
        <Text style={styles.fieldLabelText}>
          {field.item_number ? <Text style={{ color: '#1d4ed8' }}>{field.item_number}{'  '}</Text> : null}
          {resolvePdfLabel(field.label, fieldValues, allFieldsFlat)}
          {field.is_required && <Text style={styles.fieldRequired}> *</Text>}
        </Text>
        {/* help_text is on-screen surveyor guidance only — intentionally omitted
            from the PDF so the report shows just the question + answer. */}
      </View>

      <View style={styles.fieldValue}>
        {field.field_type === 'signature' ? (
          signatures[field.id] ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={signatures[field.id]} style={styles.signatureImage} />
          ) : (
            <Text style={styles.fieldValueEmpty}>No signature</Text>
          )
        ) : field.field_type === 'yes_no' || field.field_type === 'yes_no_na' ? (
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
