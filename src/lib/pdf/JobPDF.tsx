import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
  Line,
  Svg,
} from '@react-pdf/renderer'
import { format, parseISO } from 'date-fns'

// Register fonts (using built-in Helvetica)
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#1e293b',
    paddingTop: 50,
    paddingBottom: 60,
    paddingLeft: 40,
    paddingRight: 40,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: '#1d4ed8',
  },
  headerLeft: {
    flex: 1,
  },
  companyName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    letterSpacing: 0.5,
  },
  companyTagline: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerRightText: {
    fontSize: 8,
    color: '#64748b',
    textAlign: 'right',
    lineHeight: 1.5,
  },
  // Job title
  jobTitleSection: {
    marginBottom: 16,
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#1d4ed8',
  },
  jobTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  jobMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 6,
  },
  jobMetaItem: {
    flexDirection: 'row',
    gap: 3,
  },
  jobMetaLabel: {
    fontSize: 8,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
  },
  jobMetaValue: {
    fontSize: 8,
    color: '#1e293b',
  },
  // Section
  sectionContainer: {
    marginBottom: 14,
  },
  sectionHeader: {
    backgroundColor: '#1e3a8a',
    padding: '6 10',
    borderRadius: 3,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  sectionDescription: {
    fontSize: 8,
    color: '#bfdbfe',
    marginTop: 2,
  },
  // Fields
  fieldRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 5,
    minHeight: 20,
  },
  fieldLabel: {
    width: '35%',
    paddingRight: 8,
  },
  fieldLabelText: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  fieldRequired: {
    color: '#ef4444',
    fontSize: 8,
  },
  fieldValue: {
    flex: 1,
  },
  fieldValueText: {
    fontSize: 8.5,
    color: '#1e293b',
    lineHeight: 1.4,
  },
  fieldValueEmpty: {
    fontSize: 8.5,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  fieldUnit: {
    fontSize: 7.5,
    color: '#64748b',
    marginLeft: 3,
  },
  // Heading field
  inlineHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    marginTop: 10,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bfdbfe',
    paddingBottom: 3,
  },
  // Signature
  signatureContainer: {
    marginTop: 3,
  },
  signatureImage: {
    height: 40,
    maxWidth: 150,
    objectFit: 'contain',
  },
  // Yes/No
  yesNoValue: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  // Remarks / textarea
  textareaValue: {
    fontSize: 8.5,
    color: '#1e293b',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: '#94a3b8',
  },
  // Photo note
  photoNote: {
    marginTop: 16,
    padding: 8,
    backgroundColor: '#fef9c3',
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: '#fde68a',
  },
  photoNoteText: {
    fontSize: 7.5,
    color: '#854d0e',
  },
  // Divider
  dividerLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginVertical: 8,
  },
})

function formatVal(v: string | null | undefined): string {
  if (!v) return ''
  try { return format(parseISO(v), 'dd MMM yyyy') } catch { return v }
}

interface PDFProps {
  job: any
  sections: any[]
  fieldValues: Record<string, string>
  arrayValues: Record<string, string[]>
  signatures: Record<string, string>
  photoCount: number
}

const YES_NO_BG: Record<string, string> = { green: '#dcfce7', red: '#fee2e2', gray: '#f1f5f9', amber: '#fef3c7' }
const YES_NO_FG: Record<string, string> = { green: '#166534', red: '#991b1b', gray: '#94a3b8', amber: '#92400e' }

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
      {remarks ? <Text style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>{remarks}</Text> : null}
    </View>
  )
}

export function JobPDF({ job, sections, fieldValues, arrayValues, signatures, photoCount }: PDFProps) {
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME ?? 'Taylor Engineering'
  const companyEmail = process.env.NEXT_PUBLIC_COMPANY_EMAIL ?? ''
  const companyPhone = process.env.NEXT_PUBLIC_COMPANY_PHONE ?? ''
  const companyAddress = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? ''
  const generatedAt = format(new Date(), 'dd MMM yyyy HH:mm')

  return (
    <Document
      title={`${job.title} — ${job.job_number ?? 'Draft'}`}
      author={companyName}
      subject="Survey Checklist Report"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>{companyName}</Text>
            <Text style={styles.companyTagline}>Survey & Inspection Services</Text>
          </View>
          <View style={styles.headerRight}>
            {companyAddress && <Text style={styles.headerRightText}>{companyAddress}</Text>}
            {companyPhone && <Text style={styles.headerRightText}>{companyPhone}</Text>}
            {companyEmail && <Text style={styles.headerRightText}>{companyEmail}</Text>}
          </View>
        </View>

        {/* Job Title & Meta */}
        <View style={styles.jobTitleSection}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <View style={styles.jobMeta}>
            {job.job_number && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Job No:</Text>
                <Text style={styles.jobMetaValue}>{job.job_number}</Text>
              </View>
            )}
            {job.template?.name && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Template:</Text>
                <Text style={styles.jobMetaValue}>{job.template.name}</Text>
              </View>
            )}
            {job.client?.name && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Client:</Text>
                <Text style={styles.jobMetaValue}>{job.client.name}</Text>
              </View>
            )}
            {job.scheduled_date && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Date:</Text>
                <Text style={styles.jobMetaValue}>{formatVal(job.scheduled_date)}</Text>
              </View>
            )}
            {job.assignee?.full_name && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Surveyor:</Text>
                <Text style={styles.jobMetaValue}>{job.assignee.full_name}</Text>
              </View>
            )}
            {job.submitted_at && (
              <View style={styles.jobMetaItem}>
                <Text style={styles.jobMetaLabel}>Submitted:</Text>
                <Text style={styles.jobMetaValue}>{format(parseISO(job.submitted_at), 'dd MMM yyyy HH:mm')}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Sections */}
        {sections.map(section => (
          <View key={section.id} style={styles.sectionContainer} wrap={false}>
            {/* Section header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.description && (
                <Text style={styles.sectionDescription}>{section.description}</Text>
              )}
            </View>

            {/* Fields */}
            {section.fields.map((field: any) => {
              if (field.field_type === 'photo') return null // exclude photos

              if (field.field_type === 'divider') {
                return <View key={field.id} style={styles.dividerLine} />
              }

              if (field.field_type === 'heading') {
                return (
                  <Text key={field.id} style={styles.inlineHeading}>{field.label}</Text>
                )
              }

              const rawValue = field.field_type === 'multiple_choice'
                ? (arrayValues[field.id] ?? []).join(', ')
                : fieldValues[field.id] ?? ''

              const hasValue = !!rawValue

              return (
                <View key={field.id} style={styles.fieldRow}>
                  <View style={styles.fieldLabel}>
                    <Text style={styles.fieldLabelText}>
                      {field.label}
                      {field.is_required && <Text style={styles.fieldRequired}> *</Text>}
                    </Text>
                    {field.help_text && (
                      <Text style={{ fontSize: 7, color: '#94a3b8', marginTop: 1 }}>{field.help_text}</Text>
                    )}
                  </View>

                  <View style={styles.fieldValue}>
                    {field.field_type === 'signature' ? (
                      signatures[field.id] ? (
                        <View style={styles.signatureContainer}>
                          {/* eslint-disable-next-line jsx-a11y/alt-text */}
                        <Image src={signatures[field.id]} style={styles.signatureImage} />
                        </View>
                      ) : (
                        <Text style={styles.fieldValueEmpty}>No signature</Text>
                      )
                    ) : (field.field_type === 'yes_no' || field.field_type === 'yes_no_na') ? (
                      <YesNoCell rawValue={rawValue} options={field.options} />
                    ) : field.field_type === 'textarea' ? (
                      <Text style={styles.textareaValue}>{rawValue || '—'}</Text>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={hasValue ? styles.fieldValueText : styles.fieldValueEmpty}>
                          {hasValue ? rawValue : '—'}
                        </Text>
                        {field.unit && <Text style={styles.fieldUnit}>{field.unit}</Text>}
                      </View>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        ))}

        {/* Photo note */}
        {photoCount > 0 && (
          <View style={styles.photoNote}>
            <Text style={styles.photoNoteText}>
              Note: {photoCount} photo{photoCount !== 1 ? 's' : ''} uploaded to this job record are stored internally and not included in this PDF by default.
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {companyName} — Confidential Survey Report — {job.job_number ?? 'Draft'}
          </Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text style={styles.footerText}>Generated: {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}
