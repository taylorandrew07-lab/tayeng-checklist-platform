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
import { isSurveyedVesselNameField, withVesselPrefix } from '@/lib/utils'
import { instanceKey } from '@/lib/offline/instanceKeys'
import { resolveEntryOrderFromData } from '@/lib/checklist/entryOrder'
import { COMPANY } from '@/lib/company'

// ============================================================================
// STANDALONE Daily Borescoping Report renderer.
//
// This report is a signature deliverable and is deliberately ISOLATED: it has its
// own styles and its own layout code, and it is selected by template id in the PDF
// route (see BORESCOPING_TEMPLATE_ID). Nothing in the generic JobPDF renderer can
// change how this report looks, and edits here change nothing else. If you promote
// another template to standalone later, give it its OWN file the same way rather than
// generalising this one — the whole point is that these don't share layout code.
//
// It is still DATA-DRIVEN over the template's own sections/fields (so builder edits to
// THIS template — field order, labels, options — are honoured); it just never borrows
// another template's rendering. The Title/Job Details block uses a single consistent
// label column so every value lines up (the misalignment that motivated the split).
// ============================================================================

/** Fixed id of the "Daily Borescoping Report" template (seeded in migration 093). */
export const BORESCOPING_TEMPLATE_ID = 'b0235c09-0000-4000-8000-000000000001'

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
  photos?: JobPhoto[]
  disclaimer?: string | null
  preamble?: string | null
  logoSrc?: string
  hideLogo?: boolean
  surveyors?: string[]
  hideClient?: boolean
  hideSurveyor?: boolean
}

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
  // Letterhead
  logo: { width: 210, alignSelf: 'center', marginBottom: 4 },
  wordmark: {
    fontSize: 17, fontFamily: 'Helvetica-Bold', color: '#1d4ed8',
    textAlign: 'center', letterSpacing: 0.3,
  },
  tagline: { fontSize: 7, color: '#64748b', textAlign: 'center', letterSpacing: 1.3, marginTop: 2 },
  headLine: { fontSize: 7.5, color: '#64748b', textAlign: 'center' },
  headRule: { borderBottomWidth: 1.5, borderBottomColor: '#1d4ed8', marginTop: 7, marginBottom: 8 },
  reportTitleCentered: {
    fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1d4ed8',
    textAlign: 'center', marginBottom: 8,
  },
  // Logo-off fallback: left title with underline
  reportTitleBlock: { marginBottom: 6, paddingBottom: 4, borderBottomWidth: 2, borderBottomColor: '#1d4ed8' },
  reportTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#1d4ed8' },
  // Section
  sectionContainer: { marginBottom: 6 },
  sectionHeader: { backgroundColor: '#1e3a8a', padding: '4 8', borderRadius: 2, marginBottom: 2 },
  sectionTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.2 },
  // Job Details rows — ONE fixed label column so all values start at the same x.
  // (LABEL_COL below is the single source of that alignment for both primary rows
  // like Vessel/Client/Surveyors and the indented spec/detail rows.)
  detailRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
    minHeight: 14,
    alignItems: 'flex-start',
  },
  detailLabelText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#374151' },
  detailValue: { flex: 1 },
  detailValueText: { fontSize: 8, color: '#1e293b', lineHeight: 1.3 },
  detailValueEmpty: { fontSize: 8, color: '#94a3b8' },
  detailUnit: { fontSize: 7, color: '#64748b', marginLeft: 2 },
  // Preamble intro paragraph
  preamble: { marginTop: 8, marginBottom: 2, fontSize: 8.5, color: '#374151', lineHeight: 1.45 },
  // Repeatable entry block
  entryBlock: { borderWidth: 0.5, borderColor: '#cbd5e1', borderRadius: 3, marginBottom: 5 },
  entryHeading: {
    fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#1e3a8a', backgroundColor: '#dbeafe',
    padding: '3 6', borderTopLeftRadius: 3, borderTopRightRadius: 3, marginBottom: 3,
  },
  entryBody: { padding: '0 6 3 6' },
  entryRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 3,
    minHeight: 14,
    alignItems: 'flex-start',
  },
  itemNumberText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#1d4ed8' },
  entryLabelText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#374151' },
  videoLink: { fontSize: 8, color: '#1d4ed8', textDecoration: 'underline', marginBottom: 1 },
  inlineHeading: {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1d4ed8', marginTop: 6, marginBottom: 2,
    borderBottomWidth: 0.5, borderBottomColor: '#bfdbfe', paddingBottom: 2,
  },
  dividerLine: { borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', marginVertical: 4 },
  // Per-entry photo pages: 2 columns × 3 rows.
  photoGroupHeading: {
    fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#1d4ed8', marginTop: 6, marginBottom: 3,
    borderBottomWidth: 0.5, borderBottomColor: '#bfdbfe', paddingBottom: 2,
  },
  photosSectionHeader: { backgroundColor: '#1e3a8a', padding: '4 8', borderRadius: 2, marginBottom: 4 },
  reportPhotoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  reportPhotoItem: { width: '50%', padding: 4 },
  reportPhotoImage: {
    width: '100%', height: 200, objectFit: 'contain', backgroundColor: '#f1f5f9',
    borderRadius: 2, borderWidth: 0.5, borderColor: '#e2e8f0',
  },
  photoCaption: { fontSize: 6.5, color: '#64748b', marginTop: 2, textAlign: 'center' },
  photoNote: {
    marginTop: 8, padding: 5, backgroundColor: '#fef9c3', borderRadius: 2,
    borderWidth: 0.5, borderColor: '#fde68a',
  },
  photoNoteText: { fontSize: 7, color: '#854d0e' },
  // Disclaimer
  disclaimer: { marginTop: 6, padding: 4, backgroundColor: '#f8fafc', borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 2 },
  disclaimerText: { fontSize: 6, color: '#64748b', fontStyle: 'italic', lineHeight: 1.3 },
  // Footer
  footer: {
    position: 'absolute', bottom: 14, left: 30, right: 30, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 0.5, borderTopColor: '#e2e8f0', paddingTop: 4,
  },
  footerText: { fontSize: 6.5, color: '#94a3b8' },
})

// The single label-column width shared by every Job Details row: every label starts at
// the same left edge (one clean column) and every value starts at the same x (LABEL_COL
// from the margin). Wider column ⇒ the value column sits further right, spreading the
// block across the page instead of bunching it on the left.
const LABEL_COL = 210

// A field is "job-backed" when its value comes from the job record (vessel name,
// client, surveyor) rather than a typed answer — those render as injected rows.
const isJobBackedField = (f: any) =>
  isSurveyedVesselNameField(f.label) || f.field_type === 'client_select' || /surveyor/i.test(f.label)

function resolveDropdownValue(field: any, rawValue: string): string {
  if (!rawValue) return '—'
  const opt = (field?.options ?? []).find((o: any) => o.value === rawValue)
  return opt?.label ?? rawValue
}

// One Job Details row: fixed label column + value column. Every label shares the same
// left edge, so the whole left side reads as one aligned column.
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.detailRow}>
      <View style={{ width: LABEL_COL, paddingRight: 6 }}>
        <Text style={styles.detailLabelText}>{label}</Text>
      </View>
      <View style={styles.detailValue}>
        {typeof value === 'string'
          ? <Text style={value ? styles.detailValueText : styles.detailValueEmpty}>{value || '—'}</Text>
          : value}
      </View>
    </View>
  )
}

// Render a single Job Details field's VALUE (already grouped as a spec/detail row).
function detailFieldValue(field: any, fieldValues: Record<string, string>, arrayValues: Record<string, string[]>): React.ReactNode {
  const raw = field.field_type === 'multiple_choice'
    ? (arrayValues[field.id] ?? []).map((v: string) => (field.options ?? []).find((o: any) => o.value === v)?.label ?? v).join(', ')
    : fieldValues[field.id] ?? ''

  if (field.field_type === 'dropdown') return resolveDropdownValue(field, raw)
  if (field.field_type === 'number' && raw && !isNaN(Number(raw))) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={styles.detailValueText}>{Number(raw).toLocaleString('en-US')}</Text>
        {field.unit ? <Text style={styles.detailUnit}>{field.unit}</Text> : null}
      </View>
    )
  }
  return raw
}

// Render one field row inside a repeatable Cargo Line entry.
function renderEntryField(
  field: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  inst: number,
  numColWidth: number,
): React.ReactElement | null {
  if (!field) return null
  const key = instanceKey(field.id, inst)

  if (field.field_type === 'divider') return <View key={key} style={styles.dividerLine} />
  if (field.field_type === 'heading') return <Text key={key} style={styles.inlineHeading}>{field.label}</Text>

  const rawValue = field.field_type === 'multiple_choice'
    ? (arrayValues[key] ?? []).map((v: string) => (field.options ?? []).find((o: any) => o.value === v)?.label ?? v).join(', ')
    : fieldValues[key] ?? ''
  const hasValue = !!rawValue

  let valueNode: React.ReactNode
  if (field.field_type === 'video_link') {
    const links = (arrayValues[key] ?? []).filter(Boolean)
    valueNode = links.length === 0
      ? <Text style={styles.detailValueEmpty}>—</Text>
      : (
        <View>
          {links.map((url, i) => (
            <Link key={i} src={url} style={styles.videoLink}>{links.length > 1 ? `Video ${i + 1}: ` : ''}{url}</Link>
          ))}
        </View>
      )
  } else if (field.field_type === 'dropdown') {
    valueNode = <Text style={hasValue ? styles.detailValueText : styles.detailValueEmpty}>{hasValue ? resolveDropdownValue(field, rawValue) : '—'}</Text>
  } else if (field.field_type === 'number') {
    valueNode = (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={hasValue ? styles.detailValueText : styles.detailValueEmpty}>
          {hasValue ? (!isNaN(Number(rawValue)) ? Number(rawValue).toLocaleString('en-US') : rawValue) : '—'}
        </Text>
        {field.unit && hasValue ? <Text style={styles.detailUnit}>{field.unit}</Text> : null}
      </View>
    )
  } else {
    valueNode = <Text style={hasValue ? styles.detailValueText : styles.detailValueEmpty}>{hasValue ? rawValue : '—'}</Text>
  }

  return (
    <View key={key} style={styles.entryRow}>
      <View style={{ flexDirection: 'row', width: '40%', paddingRight: 6 }}>
        {numColWidth > 0 ? <Text style={[styles.itemNumberText, { width: numColWidth }]}>{field.item_number ?? ''}</Text> : null}
        <Text style={[styles.entryLabelText, { flex: 1 }]}>{field.label}</Text>
      </View>
      <View style={styles.detailValue}>{valueNode}</View>
    </View>
  )
}

// Display order of a repeatable section's entry instances (honours the saved
// jobs.repeatable_order; falls back to natural ascending order for legacy reports).
function orderedInstancesFor(
  section: any,
  job: any,
  fieldValues: Record<string, string>,
  arrayValues: Record<string, string[]>,
  signatures: Record<string, string>,
  photos: JobPhoto[],
): number[] {
  const fieldIds = (section.fields ?? []).map((f: any) => f.id)
  const stored = (job?.repeatable_order ?? {})[section.id] as number[] | undefined
  return resolveEntryOrderFromData(fieldIds, [fieldValues, arrayValues, signatures], photos, stored)
}

// Short label for an entry — the first text field's value (the Cargo Line Name).
function entryName(section: any, inst: number, fieldValues: Record<string, string>): string {
  const f = (section.fields ?? []).find((x: any) => x.field_type === 'text')
  if (!f) return ''
  return (fieldValues[instanceKey(f.id, inst)] ?? '').trim()
}

export function BorescopingReportPDF({
  job, sections, fieldValues, arrayValues, signatures, photoCount, photos = [],
  disclaimer = null, preamble = null, logoSrc, hideLogo = false,
  surveyors = [], hideClient = false, hideSurveyor = false,
}: PDFProps) {
  const preambleNode = preamble ? <Text style={styles.preamble}>{preamble}</Text> : null
  const reportTitle = job.template?.name ?? job.title

  // Photo fields inside a repeatable section print inline per entry, so keep them out
  // of any end-of-report grid to avoid printing them twice.
  const repeatablePhotoFieldIds = new Set<string>()
  for (const s of sections as any[]) {
    if (s.is_repeatable) for (const f of (s.fields ?? [])) if (f.field_type === 'photo') repeatablePhotoFieldIds.add(f.id)
  }
  const endPhotos = photos.filter(p => !(p.field_id && repeatablePhotoFieldIds.has(p.field_id)))

  return (
    <Document
      title={`${job.title} — ${job.job_number ?? 'Draft'}`}
      author={COMPANY.name}
      subject="Daily Borescoping Report"
    >
      <Page size="LETTER" style={styles.page}>

        {hideLogo ? (
          <View style={styles.reportTitleBlock}>
            <Text style={styles.reportTitle}>{reportTitle}</Text>
          </View>
        ) : (
          <>
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

        {sections.map((section: any) => {
          const fields = (section.fields as any[]) ?? []

          // ---- Title / Job Details section (non-repeatable, holds the header fields) ----
          if (!section.is_repeatable) {
            // Vessel, then the vessel-spec fields (Port of Registry, Gross Tonnes),
            // then Client + Surveyors, then the remaining detail fields (Date, Time,
            // Port/Location, Inspection Day Number) — all in one aligned label column.
            const specFields = fields.filter(f => f.show_in_header && !isJobBackedField(f))
            const restFields = fields.filter(f => !f.show_in_header && !['heading', 'divider', 'photo'].includes(f.field_type))
            return (
              <View key={section.id} style={styles.sectionContainer}>
                <View wrap={false}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                  {job.vessel_name ? <DetailRow label="Vessel" value={withVesselPrefix(job.vessel_name)} /> : null}
                </View>
                {specFields.map(f => <DetailRow key={f.id} label={f.label} value={detailFieldValue(f, fieldValues, arrayValues)} />)}
                {job.client?.name && !hideClient ? <DetailRow label="Client" value={job.client.name} /> : null}
                {surveyors.length > 0 && !hideSurveyor ? <DetailRow label={`Surveyor${surveyors.length > 1 ? 's' : ''}`} value={surveyors.join(', ')} /> : null}
                {restFields.map(f => <DetailRow key={f.id} label={f.label} value={detailFieldValue(f, fieldValues, arrayValues)} />)}
                {preambleNode}
              </View>
            )
          }

          // ---- Cargo Line Inspection Entry (repeatable) ----
          const visibleFields = fields.filter(f => f.field_type !== 'photo')
          const photoFields = fields.filter(f => f.field_type === 'photo')
          const numColWidth = (() => {
            const maxLen = Math.max(0, ...fields.map(f => (f.item_number ?? '').length))
            return maxLen > 0 ? maxLen * 5.2 + 4 : 0
          })()
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
                        {visibleFields.map((field: any) => renderEntryField(field, fieldValues, arrayValues, inst, numColWidth))}
                      </View>
                    </View>
                    {entryPhotos.length > 0 && (
                      <>
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
        })}

        {/* Field-less photos only (line photos already print with their entry). */}
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

        {/* Legacy note — photos exist but the template didn't embed them. */}
        {photoCount > 0 && photos.length === 0 && (
          <View style={styles.photoNote}>
            <Text style={styles.photoNoteText}>
              Note: {photoCount} photo{photoCount !== 1 ? 's' : ''} attached to this job are stored internally and not included in this PDF.
            </Text>
          </View>
        )}

        {disclaimer && (
          <View style={styles.disclaimer} wrap={false}>
            <Text style={styles.disclaimerText}>{disclaimer}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'left' }]}>{COMPANY.name} — {COMPANY.confidential}</Text>
          <Text style={[styles.footerText, { flex: 1, textAlign: 'center' }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={[styles.footerText, { flex: 1, textAlign: 'right' }]}>{job.job_number ?? 'Draft'}</Text>
        </View>
      </Page>
    </Document>
  )
}
