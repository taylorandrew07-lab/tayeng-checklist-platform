import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/company'
import type { Voyage, ReadingType } from '../types'
import { PERIOD_LABELS, CAMERA_LABELS, readingTypeAppliesToHold, type Period, type Camera } from '../types'
import { monitoringDates, formatVoyageDate, holdNumbers, holdsToPages } from '../periods'
import { PERIODS } from '../types'
import { buildChartModel } from '../charts'
import { CargoChart } from './CargoChart'

/** A photo already compressed to a data URL, ready to embed. */
export interface PreparedPhoto {
  dataUrl: string
  dateISO: string
  period: Period
  holdNumber: number
  camera: Camera
  actualTime: string | null
}

export interface CargoReportData {
  voyage: Voyage
  logoDataUrl: string | null
  photos: PreparedPhoto[]
}

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#1e293b', paddingTop: 28, paddingBottom: 44, paddingLeft: 30, paddingRight: 30 },

  // Cover
  coverWrap: { flex: 1 },
  coverLogo: { width: 220, alignSelf: 'center', objectFit: 'contain', marginTop: 40, marginBottom: 8 },
  coverCompany: { textAlign: 'center', fontSize: 8, color: '#64748b', marginBottom: 2 },
  coverTagline: { textAlign: 'center', fontSize: 7.5, color: '#94a3b8', letterSpacing: 0.5, marginBottom: 28 },
  coverTitle: { textAlign: 'center', fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#1d4ed8', marginBottom: 4 },
  coverSubtitle: { textAlign: 'center', fontSize: 11, color: '#475569', marginBottom: 30 },
  coverBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 4, padding: 16, marginHorizontal: 30 },
  coverRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 5 },
  coverLabel: { width: '40%', fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#64748b' },
  coverValue: { width: '60%', fontSize: 9, color: '#1e293b' },

  // Section headers
  sectionHeader: { backgroundColor: '#1e3a8a', padding: '5 8', borderRadius: 2, marginBottom: 6, marginTop: 4 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.2 },
  periodHeading: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#1d4ed8', marginTop: 8, marginBottom: 4 },
  dateHeading: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginTop: 10, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: '#1d4ed8', paddingBottom: 2 },

  // Readings table
  table: { marginBottom: 6 },
  trHead: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  thHold: { width: 52, padding: 3, fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#334155' },
  th: { flex: 1, padding: 3, fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#334155', textAlign: 'center' },
  tdHold: { width: 52, padding: 3, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#1e293b' },
  td: { flex: 1, padding: 3, fontSize: 8, color: '#1e293b', textAlign: 'center' },
  metaLine: { fontSize: 7.5, color: '#64748b', marginBottom: 3 },

  // Photo pages
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  photoCell: { width: '48.5%', marginBottom: 8 },
  photoImg: { width: '100%', height: 150, objectFit: 'contain', backgroundColor: '#f8fafc', borderWidth: 0.5, borderColor: '#e2e8f0' },
  photoLabel: { fontSize: 7.5, color: '#334155', marginTop: 2, textAlign: 'center' },
  photoMissing: { width: '100%', height: 150, backgroundColor: '#f8fafc', borderWidth: 0.5, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  photoMissingText: { fontSize: 8, color: '#94a3b8' },

  smallHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingBottom: 3 },
  smallHeaderText: { fontSize: 8, color: '#64748b' },
  smallHeaderTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#1e293b' },

  observations: { fontSize: 9, color: '#1e293b', lineHeight: 1.4 },

  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: '#e2e8f0', paddingTop: 4 },
  footerText: { fontSize: 6.5, color: '#94a3b8' },
})

function withMvPrefix(name: string | null | undefined): string {
  if (!name) return ''
  const stripped = name.replace(/^(m\.?\s*v\.?\s*)+/i, '').trim()
  return stripped ? `M.V. ${stripped}` : ''
}

function Footer({ voyage }: { voyage: Voyage }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{COMPANY.name} — Confidential</Text>
      <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      <Text style={styles.footerText}>{voyage.voyageNumber || 'Voyage'}</Text>
    </View>
  )
}

function SmallHeader({ voyage, dateISO, period, holdRange }: { voyage: Voyage; dateISO: string; period: Period; holdRange?: string }) {
  return (
    <View style={styles.smallHeader}>
      <Text style={styles.smallHeaderTitle}>{withMvPrefix(voyage.vesselName)}</Text>
      <Text style={styles.smallHeaderText}>
        {formatVoyageDate(dateISO)} · {PERIOD_LABELS[period]}{holdRange ? ` · ${holdRange}` : ''}
      </Text>
    </View>
  )
}

function CoverPage({ voyage, logoDataUrl }: { voyage: Voyage; logoDataUrl: string | null }) {
  const rows: Array<[string, string]> = [
    ['Vessel', withMvPrefix(voyage.vesselName)],
    ['Voyage Number', voyage.voyageNumber],
    ['Cargo', voyage.cargoType],
    ['Loading Port', voyage.loadingPort],
    ['Discharge Port', voyage.dischargePort],
    ['Monitoring Commenced', formatVoyageDate(voyage.startDate)],
    ['Monitoring Completed', formatVoyageDate(voyage.endDate)],
    ['Number of Holds', String(voyage.holdCount)],
    ['Surveyor', voyage.surveyorName],
  ]
  if (voyage.clientName) rows.push(['Client', voyage.clientName])

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.coverWrap}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {logoDataUrl ? <Image src={logoDataUrl} style={styles.coverLogo} /> : null}
        <Text style={styles.coverCompany}>{COMPANY.name}</Text>
        <Text style={styles.coverTagline}>{COMPANY.tagline}</Text>

        <Text style={styles.coverTitle}>Cargo Hold Monitoring Report</Text>
        <Text style={styles.coverSubtitle}>{withMvPrefix(voyage.vesselName)}{voyage.voyageNumber ? ` — Voyage ${voyage.voyageNumber}` : ''}</Text>

        <View style={styles.coverBox}>
          {rows.filter(([, v]) => !!v).map(([label, value]) => (
            <View key={label} style={styles.coverRow}>
              <Text style={styles.coverLabel}>{label}</Text>
              <Text style={styles.coverValue}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
      <Footer voyage={voyage} />
    </Page>
  )
}

function ReadingsTable({ voyage, dateISO, period, pdfTypes }: { voyage: Voyage; dateISO: string; period: Period; pdfTypes: ReadingType[] }) {
  const holds = holdNumbers(voyage.holdCount)
  const meta = voyage.periodMeta?.[dateISO]?.[period]
  const cellAt = (hold: number, rtId: string) =>
    voyage.readings?.[dateISO]?.[period]?.[String(hold)]?.[rtId] ?? ''

  return (
    <View style={styles.table} wrap={false}>
      <Text style={styles.periodHeading}>{PERIOD_LABELS[period]}{meta?.actualTime ? `  (actual ${meta.actualTime} hrs)` : ''}</Text>
      {meta?.remarks ? <Text style={styles.metaLine}>Remarks: {meta.remarks}</Text> : null}
      <View style={styles.trHead}>
        <Text style={styles.thHold}>Hold</Text>
        {pdfTypes.map(rt => (
          <Text key={rt.id} style={styles.th}>{rt.name}{rt.unit ? ` (${rt.unit})` : ''}</Text>
        ))}
      </View>
      {holds.map(h => (
        <View key={h} style={styles.tr}>
          <Text style={styles.tdHold}>Hold {h}</Text>
          {pdfTypes.map(rt => (
            <Text key={rt.id} style={styles.td}>
              {readingTypeAppliesToHold(rt, h) ? (cellAt(h, rt.id) || '—') : '·'}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

function PhotoCell({ photo, holdNumber, camera }: { photo: PreparedPhoto | undefined; holdNumber: number; camera: Camera }) {
  const label = `Hold ${holdNumber} – ${CAMERA_LABELS[camera]}${photo?.actualTime ? ` – Actual Time ${photo.actualTime} hrs` : ''}`
  return (
    <View style={styles.photoCell} wrap={false}>
      {photo ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={photo.dataUrl} style={styles.photoImg} />
      ) : (
        <View style={styles.photoMissing}><Text style={styles.photoMissingText}>No photo</Text></View>
      )}
      <Text style={styles.photoLabel}>{label}</Text>
    </View>
  )
}

export function CargoReportDocument({ voyage, logoDataUrl, photos }: CargoReportData) {
  const dates = monitoringDates(voyage.startDate, voyage.endDate)
  const pdfTypes = (voyage.readingTypes ?? []).filter(rt => rt.includeInPdf)
  const pages = holdsToPages(voyage.holdCount)

  const photoAt = (dateISO: string, period: Period, hold: number, camera: Camera) =>
    photos.find(p => p.dateISO === dateISO && p.period === period && p.holdNumber === hold && p.camera === camera)

  const hasReadings = pdfTypes.length > 0
  const hasPhotos = photos.length > 0

  // Trend charts: one per reading type marked "include in charts" that has data.
  const chartModels = (voyage.readingTypes ?? [])
    .filter(rt => rt.includeInCharts)
    .map(rt => buildChartModel(voyage, rt))
    .filter(m => m.hasData)

  return (
    <Document title={`Cargo Hold Monitoring Report — ${voyage.vesselName}`} author={COMPANY.name} subject="Cargo Hold Monitoring Report">
      <CoverPage voyage={voyage} logoDataUrl={logoDataUrl} />

      {/* Readings tables */}
      {hasReadings && (
        <Page size="A4" style={styles.page}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Monitoring Readings</Text></View>
          {dates.map(dateISO => (
            <View key={dateISO}>
              <Text style={styles.dateHeading}>{formatVoyageDate(dateISO)}</Text>
              {PERIODS.map(period => (
                <ReadingsTable key={period} voyage={voyage} dateISO={dateISO} period={period} pdfTypes={pdfTypes} />
              ))}
            </View>
          ))}
          <Footer voyage={voyage} />
        </Page>
      )}

      {/* Trend charts */}
      {chartModels.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Trend Charts</Text></View>
          {chartModels.map(m => (
            <View key={m.readingType.id} wrap={false} style={{ marginBottom: 12 }}>
              <Text style={styles.periodHeading}>{m.readingType.name}{m.readingType.unit ? ` (${m.readingType.unit})` : ''}</Text>
              <CargoChart model={m} />
            </View>
          ))}
          <Footer voyage={voyage} />
        </Page>
      )}

      {/* Photo pages: one page per date+period (1–6 holds) or split for 7–10 holds */}
      {hasPhotos && dates.flatMap(dateISO =>
        PERIODS.flatMap(period =>
          pages.map((holdsOnPage, pageIdx) => {
            const range = pages.length > 1 ? `Holds ${holdsOnPage[0]}–${holdsOnPage[holdsOnPage.length - 1]}` : undefined
            return (
              <Page key={`${dateISO}-${period}-${pageIdx}`} size="A4" style={styles.page}>
                <SmallHeader voyage={voyage} dateISO={dateISO} period={period} holdRange={range} />
                <View style={styles.photoGrid}>
                  {holdsOnPage.flatMap(hold => ([
                    <PhotoCell key={`${hold}-fwd`} photo={photoAt(dateISO, period, hold, 'fwd')} holdNumber={hold} camera="fwd" />,
                    <PhotoCell key={`${hold}-aft`} photo={photoAt(dateISO, period, hold, 'aft')} holdNumber={hold} camera="aft" />,
                  ]))}
                </View>
                <Footer voyage={voyage} />
              </Page>
            )
          })
        )
      )}

      {/* Observations / Remarks */}
      {(voyage.observations || voyage.remarks) && (
        <Page size="A4" style={styles.page}>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Observations &amp; Remarks</Text></View>
          {voyage.observations ? (
            <>
              <Text style={styles.periodHeading}>Voyage Observations</Text>
              <Text style={styles.observations}>{voyage.observations}</Text>
            </>
          ) : null}
          {voyage.remarks ? (
            <>
              <Text style={styles.periodHeading}>Remarks</Text>
              <Text style={styles.observations}>{voyage.remarks}</Text>
            </>
          ) : null}
          <Footer voyage={voyage} />
        </Page>
      )}
    </Document>
  )
}
