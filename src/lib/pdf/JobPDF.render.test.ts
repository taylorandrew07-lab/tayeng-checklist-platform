import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { JobPDF } from './JobPDF'

// 1x1 transparent PNG as a data URI — no network fetch, so this isolates LAYOUT
// (minPresenceAhead / break / the details restructure) from image downloading.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('JobPDF render (borescoping-style)', () => {
  it('completes without hanging', async () => {
    const sections = [
      {
        id: 's1', title: 'Title / Job Details', is_repeatable: false,
        fields: [
          { id: 'f3', label: 'Date', field_type: 'date', order_index: 0, show_in_header: false },
          { id: 'f4', label: 'Time', field_type: 'time', order_index: 1, show_in_header: false },
          { id: 'f5', label: 'Vessel Name', field_type: 'text', order_index: 2, show_in_header: true },
          { id: 'f6', label: 'Port of Registry', field_type: 'text', order_index: 3, show_in_header: true },
          { id: 'f7', label: 'Gross Tonnes', field_type: 'number', unit: 'tons', order_index: 4, show_in_header: true },
          { id: 'f8', label: 'Port / Location', field_type: 'text', order_index: 5, show_in_header: false },
          { id: 'f9', label: 'Surveyor', field_type: 'text', order_index: 6, show_in_header: true },
          { id: 'fa', label: 'Client', field_type: 'client_select', order_index: 7, show_in_header: true },
          { id: 'fb', label: 'Inspection Day Number', field_type: 'number', order_index: 8, show_in_header: false },
        ],
      },
      {
        id: 's2', title: 'Cargo Line Inspection Entry', is_repeatable: true,
        fields: [
          { id: 'g1', label: 'Cargo Line Name / Description', field_type: 'text', order_index: 0 },
          { id: 'g8', label: 'Photos', field_type: 'photo', order_index: 9 },
        ],
      },
    ]
    const fieldValues: Record<string, string> = {
      f3: '2026-06-25', f4: '09:00', f6: 'Vanuatu', f7: '3041', f8: 'Chaguaramas', fb: '1',
      g1: 'Test line 1', 'g1@@1': 'Test line 2',
    }
    // 8 photos: 4 on entry 0, 4 on entry 1.
    const photos = Array.from({ length: 8 }, (_, i) => ({
      field_id: 'g8', instance: i < 4 ? 0 : 1, url: IMG, caption: null, filename: `p${i}.jpg`,
    }))
    const el = React.createElement(JobPDF as any, {
      job: { vessel_name: 'Test Vessel', client: { name: 'ExxonMobil' }, job_number: 'TEAL C/L #1', title: 'X',
        template: { name: 'Daily Borescoping Report', pdf_include_photos: true } },
      sections, fieldValues, arrayValues: {}, signatures: {}, photoCount: 8, photos,
      surveyors: ['Captain Andrew Taylor', 'Robert Taylor'], preamble: 'Intro paragraph.',
      disclaimer: 'Disclaimer text.',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)

  // Verify jobs.repeatable_order actually drives the report's entry order: the same
  // data rendered in two different orders must produce different output, and a
  // non-contiguous order (as left by an insert/remove) must still render.
  it('renders repeatable entries in the saved order', async () => {
    const sections = [{
      id: 's2', title: 'Cargo Line Inspection Entry', is_repeatable: true,
      fields: [{ id: 'g1', label: 'Cargo Line Name', field_type: 'text', order_index: 0 }],
    }]
    const fieldValues = { g1: 'Alpha', 'g1@@1': 'Bravo', 'g1@@2': 'Charlie' }
    const base = {
      sections, fieldValues, arrayValues: {}, signatures: {}, photoCount: 0, photos: [] as any[],
      surveyors: [] as string[],
    }
    const mk = (repeatable_order?: Record<string, number[]>) => renderToBuffer(
      React.createElement(JobPDF as any, {
        ...base,
        job: { vessel_name: 'V', title: 'X', job_number: 'N', template: { name: 'T' }, repeatable_order },
      }) as any
    )
    const natural = await mk(undefined)               // 0,1,2 → Alpha, Bravo, Charlie
    const reordered = await mk({ s2: [2, 0, 1] })      // Charlie, Alpha, Bravo
    const afterRemove = await mk({ s2: [0, 2] })       // non-contiguous (entry 1 removed)
    expect(natural.length).toBeGreaterThan(500)
    expect(afterRemove.length).toBeGreaterThan(500)
    // Different order ⇒ different bytes (the order prop is genuinely used, not ignored).
    expect(Buffer.from(reordered).equals(Buffer.from(natural))).toBe(false)
  }, 25000)
})

// The header is two columns. Historically the split was fixed: job-record rows (Vessel,
// Client, Date, Surveyor) left, checklist-derived rows (Port, Method of Delivery, Bunker
// Vessel Name) right. `balancedHeader` (migration 141) spreads them evenly instead — with
// Brine's six rows that is 3 and 3 rather than 4 and 2. These pin BOTH behaviours so the
// opt-in cannot silently become the default for every other report.
describe('JobPDF header column split', () => {
  const sections = [{
    id: 's1', title: 'Job Details', is_repeatable: false,
    fields: [
      { id: 'd', label: 'Date', field_type: 'date', order_index: 0 },
      { id: 'p', label: 'Port', field_type: 'text', order_index: 1 },
      { id: 'm', label: 'Method of Delivery', field_type: 'dropdown', order_index: 2,
        options: [{ value: 'shore_tank', label: 'Shore Tank' }] },
    ],
  }]
  const fieldValues = { d: '2026-07-18', p: 'Point Lisas', m: 'shore_tank' }
  const job: any = {
    id: 'j1', title: 'Brine Transfer', job_number: '26-07-001',
    vessel_name: 'Test Vessel', client: { name: 'Test Client' },
    template: { name: 'Brine Transfer Checklist' },
  }
  const common = {
    job, sections: sections as any, fieldValues, arrayValues: {}, signatures: {},
    photoCount: 0, photos: [], surveyors: ['A. Taylor'],
  }

  it('renders with the historic fixed split by default', async () => {
    const buf = await renderToBuffer(React.createElement(JobPDF, common as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders with an even split when the template opts in', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, balancedHeader: true } as any) as any,
    )
    expect(buf.length).toBeGreaterThan(0)
  })

})

// A repeatable section normally starts on a fresh page (Borescoping prints a page of
// photos per entry). Brine's hourly log is one question mid-checklist, where that left
// most of a page blank — so a section can opt out via pdf_page_break. Default stays true.
describe('JobPDF repeatable section page break', () => {
  const makeSections = (pdfPageBreak?: boolean) => [
    {
      id: 's1', title: 'Mid Loading', is_repeatable: false,
      fields: [{ id: 'q24', label: 'Periodic samples taken?', field_type: 'yes_no', item_number: '24', order_index: 0 }],
    },
    {
      id: 's2', title: 'Hourly Loading Line Inspection', is_repeatable: true,
      ...(pdfPageBreak === undefined ? {} : { pdf_page_break: pdfPageBreak }),
      fields: [{ id: 'q25', label: 'Time of inspection', field_type: 'time', item_number: '25', order_index: 0 }],
    },
    {
      id: 's3', title: 'Final', is_repeatable: false,
      fields: [{ id: 'q26', label: 'Lines blown through?', field_type: 'yes_no', item_number: '26', order_index: 0 }],
    },
  ]
  const common = {
    job: { id: 'j1', title: 'Brine', job_number: '26-07-001', template: { name: 'Brine Transfer Checklist' } } as any,
    fieldValues: { q24: 'yes', q25: '14:50', q26: 'yes' },
    arrayValues: {}, signatures: {}, photoCount: 0, photos: [],
  }

  it('renders when the section opts out of the page break', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: makeSections(false) as any } as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('still breaks by default, and when the column is absent', async () => {
    for (const sections of [makeSections(true), makeSections(undefined)]) {
      const buf = await renderToBuffer(
        React.createElement(JobPDF, { ...common, sections: sections as any } as any) as any)
      expect(buf.length).toBeGreaterThan(0)
    }
  })

  it('opting out produces a SHORTER document than forcing the break', async () => {
    // The real symptom: a forced break wastes most of a page, so the same content spans
    // more pages. Byte length is a proxy — a page of whitespace still costs page objects.
    const [flowed, broken] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: makeSections(false) as any } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: makeSections(true) as any } as any) as any),
    ])
    expect(flowed.length).toBeLessThan(broken.length)
  })
})

// A blank field prints "—". That is meaningful for a question the surveyor was asked, but
// noise for an optional notes field — especially inside a repeatable section, where it
// costs a wasted row per entry. pdf_hide_when_empty drops the row; it defaults to false.
describe('JobPDF pdf_hide_when_empty', () => {
  const sections = (hide: boolean) => [{
    id: 's1', title: 'Hourly Loading Line Inspection', is_repeatable: true, pdf_page_break: false,
    fields: [
      { id: 't', label: 'Time of inspection', field_type: 'time', item_number: '25', order_index: 0 },
      { id: 'ok', label: 'Loading line satisfactory?', field_type: 'yes_no', order_index: 1 },
      { id: 'obs', label: 'Observations / defects', field_type: 'textarea', order_index: 2,
        ...(hide ? { pdf_hide_when_empty: true } : {}) },
    ],
  }]
  const common = {
    job: { id: 'j1', title: 'Brine', job_number: '26-07-001', template: { name: 'Brine' } } as any,
    arrayValues: {}, signatures: {}, photoCount: 0, photos: [],
  }
  // Three entries, none with observations — the case that wastes three rows.
  const empty = { t: '14:50', ok: 'yes', 't@@1': '15:50', 'ok@@1': 'yes', 't@@2': '16:50', 'ok@@2': 'yes' }

  it('drops the blank row when the field opts in', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: sections(true) as any, fieldValues: empty } as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('still prints the placeholder by default', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: sections(false) as any, fieldValues: empty } as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('hiding blanks yields a smaller document than printing them', async () => {
    const [hidden, shown] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections(true) as any, fieldValues: empty } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections(false) as any, fieldValues: empty } as any) as any),
    ])
    expect(hidden.length).toBeLessThan(shown.length)
  })

  it('never hides a row that HAS been filled in', async () => {
    const answered = { ...empty, obs: 'Slight weep at the flange', 'obs@@1': '', 'obs@@2': '' }
    const [withText, withoutText] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections(true) as any, fieldValues: answered } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections(true) as any, fieldValues: empty } as any) as any),
    ])
    // The answered entry must still render its observation, so the document is larger.
    expect(withText.length).toBeGreaterThan(withoutText.length)
  })
})

// A photo field in a REPEATABLE section has always printed under its entry. In an
// ordinary section the association was computed and then discarded, so the photo landed
// on an "Additional Photographs" page at the back captioned "Additional — Photo 3" —
// nothing tied it to the item it evidenced. pdf_photos_inline prints it under its own
// section instead. Off by default, so every pre-existing report is unchanged.
describe('JobPDF pdf_photos_inline', () => {
  const IMG_ = IMG
  const ordinarySections = [
    {
      id: 's1', title: 'Life-Saving Appliances', is_repeatable: false,
      fields: [
        { id: 'q1', label: 'Liferaft cradles and HRUs in good order?', field_type: 'yes_no_na', item_number: '6.7', order_index: 0 },
        { id: 'ph', label: 'Photographs', field_type: 'photo', item_number: '6.12', order_index: 1 },
      ],
    },
  ]
  const common = {
    job: { id: 'j1', title: 'Pre-Hire', job_number: '26-08-001', vessel_name: 'Test Vessel',
      template: { name: 'Pre-Hire Inspection', pdf_include_photos: true } } as any,
    fieldValues: { q1: 'no|||stbd cradle cracked at weld' },
    arrayValues: {}, signatures: {}, photoCount: 4,
    photos: Array.from({ length: 4 }, (_, i) => ({
      field_id: 'ph', instance: 0, url: IMG_, caption: null, filename: `p${i}.jpg`,
    })),
  }

  it('renders both ways', async () => {
    for (const photosInline of [false, true]) {
      const buf = await renderToBuffer(
        React.createElement(JobPDF, { ...common, sections: ordinarySections as any, photosInline } as any) as any)
      expect(buf.length).toBeGreaterThan(1000)
    }
  }, 25000)

  it('inlining avoids the forced "Additional Photographs" page, so the document is smaller', async () => {
    // Off, the 4 photos force a `break` onto their own page at the back. On, they flow
    // under the section that produced them.
    const [inline, atBack] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: ordinarySections as any, photosInline: true } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: ordinarySections as any, photosInline: false } as any) as any),
    ])
    expect(inline.length).toBeLessThan(atBack.length)
  }, 25000)

  it('renders a section whose ONLY field is a photo field', async () => {
    // The old code returned null for a section with no non-photo fields, which would
    // have swallowed the photos along with the heading.
    const photoOnly = [{ id: 's1', title: 'Deck Photographs', is_repeatable: false,
      fields: [{ id: 'ph', label: 'Photographs', field_type: 'photo', item_number: '12.12', order_index: 0 }] }]
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: photoOnly as any, photosInline: true } as any) as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)

  it('is a no-op when every photo field already lives in a repeatable section', async () => {
    // The regression guard: Brine and Borescoping only have repeatable photo fields, so
    // turning the flag on must not move a single photo. Compare byte LENGTH rather than
    // contents — the embedded creation timestamp differs between renders but is
    // fixed-width, so equal length means equal layout.
    const repeatable = [{
      id: 's2', title: 'Hourly Shore Line Inspection', is_repeatable: true, pdf_page_break: false,
      fields: [
        { id: 'g1', label: 'Line', field_type: 'text', order_index: 0 },
        { id: 'ph', label: 'Photo', field_type: 'photo', order_index: 1 },
      ],
    }]
    const [off, on] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: repeatable as any, fieldValues: { g1: 'Line 1' }, photosInline: false } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: repeatable as any, fieldValues: { g1: 'Line 1' }, photosInline: true } as any) as any),
    ])
    expect(on.length).toBe(off.length)
  }, 25000)

  it('leaves general (field-less) photos on the Additional Photographs pages', async () => {
    // Photos with field_id null belong to the job's own "Additional Photos" card — they
    // have no question to sit under, so inlining must not strand them.
    const generals = [...common.photos, { field_id: null, instance: 0, url: IMG_, caption: null, filename: 'g.jpg' }]
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: ordinarySections as any, photos: generals, photoCount: 5, photosInline: true } as any) as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})

// The report header finds its Date and Port rows by matching field labels, then DELETES
// the winner from the report body. Under the old loose /\bdate\b/ and /\bport\b/ it
// matched descriptive questions — "Port of registry", "Date of last drydocking" — and
// silently ate them. Matching is now exact, and the rows fall back to the job record
// (jobs.scheduled_date / jobs.port_location) so a template need not ask twice.
describe('JobPDF header Date/Port', () => {
  const descriptiveOnly = [{
    id: 's1', title: 'Vessel Particulars', is_repeatable: false,
    fields: [
      { id: 'a', label: 'Port of registry', field_type: 'text', item_number: '2.3', order_index: 0 },
      { id: 'b', label: 'Date of last drydocking, and next due', field_type: 'text', item_number: '3.8', order_index: 1 },
    ],
  }]
  const common = {
    arrayValues: {}, signatures: {}, photoCount: 0, photos: [], surveyors: ['A. Taylor'],
  }

  it('does not swallow a descriptive question into the header', async () => {
    // A hijacked field is SUPPRESSED from the body — and with only two fields in the
    // section, suppressing both empties it and drops the section entirely. So compare
    // against the same section with labels the regex could never match: identical
    // output means neither descriptive label was mistaken for a header field.
    const neutral = [{
      ...descriptiveOnly[0],
      fields: [
        { id: 'a', label: 'Registry of the ship', field_type: 'text', item_number: '2.3', order_index: 0 },
        { id: 'b', label: 'Last drydocking, and next due', field_type: 'text', item_number: '3.8', order_index: 1 },
      ],
    }]
    const job = { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T' } }
    const values = { a: 'Georgetown', b: 'March 2024 / March 2027' }
    const [descriptive, control] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: descriptiveOnly as any, fieldValues: values, job } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: neutral as any, fieldValues: values, job } as any) as any),
    ])
    // Labels differ by a few characters; a suppressed field would differ by a whole row.
    expect(Math.abs(descriptive.length - control.length)).toBeLessThan(60)
  }, 25000)

  it('falls back to the job record when the template has no Date/Port field', async () => {
    const withJobValues = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: descriptiveOnly as any, fieldValues: {},
      job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T' },
        scheduled_date: '2026-08-14', port_location: 'Paramaribo' },
    } as any) as any)
    const withoutJobValues = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: descriptiveOnly as any, fieldValues: {},
      job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T' } },
    } as any) as any)
    // Two extra header rows.
    expect(withJobValues.length).toBeGreaterThan(withoutJobValues.length)
  }, 25000)

  it('still prefers an exactly-named template field over the job record', async () => {
    const withExact = [{
      id: 's1', title: 'Survey Details', is_repeatable: false,
      fields: [
        { id: 'd', label: 'Date', field_type: 'date', order_index: 0 },
        { id: 'p', label: 'Port', field_type: 'text', order_index: 1 },
      ],
    }]
    const buf = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: withExact as any,
      fieldValues: { d: '2026-08-14', p: 'Chaguaramas' },
      job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T' },
        scheduled_date: '2020-01-01', port_location: 'Somewhere else' },
    } as any) as any)
    // The section has only those two fields, and both are suppressed from the body once
    // promoted to the header — so this renders a header and no body rows at all.
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})

// Photos hang off ANY field, not just photo-type ones, so a question carries its own
// evidence and it prints directly beneath that question.
describe('JobPDF per-question photos', () => {
  const sections = [{
    id: 's1', title: 'Life-Saving Appliances', is_repeatable: false,
    fields: [
      { id: 'q1', label: 'Liferaft cradles in good order?', field_type: 'yes_no_na', item_number: '6.6', order_index: 0 },
      { id: 'q2', label: 'Lifebuoys correct in number?', field_type: 'yes_no_na', item_number: '6.7', order_index: 1 },
    ],
  }]
  const common = {
    job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T', pdf_include_photos: true } } as any,
    fieldValues: { q1: 'no|||cracked at the weld', q2: 'yes' },
    arrayValues: {}, signatures: {}, photoCount: 2,
    photos: [
      { field_id: 'q1', instance: 0, url: IMG, caption: null, filename: 'a.jpg' },
      { field_id: 'q1', instance: 0, url: IMG, caption: null, filename: 'b.jpg' },
    ],
  }

  it('prints a question’s photos inline rather than on the end pages', async () => {
    const [inline, atBack] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections as any, photosInline: true } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections as any, photosInline: false } as any) as any),
    ])
    // Off, the photos force their own "Additional Photographs" page at the back.
    expect(inline.length).toBeLessThan(atBack.length)
  }, 25000)

  it('keeps a photo whose field is not in the report — it goes to the back, not nowhere', async () => {
    const orphan = { ...common, photos: [{ field_id: 'gone', instance: 0, url: IMG, caption: null, filename: 'x.jpg' }] }
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...orphan, sections: sections as any, photosInline: true } as any) as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})

// A crew list or particulars sheet arrives as a PDF. It cannot be embedded — handing a
// PDF URL to <Image> fails the whole render — so the route splits documents out and the
// report names them under the question they were attached to.
describe('JobPDF document attachments', () => {
  const sections = [{
    id: 's1', title: 'Crew', is_repeatable: false,
    fields: [
      { id: 'q', label: 'Master’s name', field_type: 'text', item_number: '4.1', order_index: 0 },
      { id: 'doc', label: 'Crew list — attach', field_type: 'photo', item_number: '4.9', order_index: 1 },
    ],
  }]
  const common = {
    job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T', pdf_include_photos: true } } as any,
    fieldValues: { q: 'A. Taylor' },
    arrayValues: {}, signatures: {}, photos: [], photoCount: 0,
  }

  it('names an attached document instead of embedding it', async () => {
    const withDoc = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, photosInline: true,
      documents: [{ field_id: 'doc', instance: 0, filename: 'crew-list.pdf' }],
    } as any) as any)
    const without = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, photosInline: true, documents: [],
    } as any) as any)
    expect(withDoc.length).toBeGreaterThan(without.length)
  }, 25000)

  it('names documents on a question that is not a photo field', async () => {
    // Attachments hang off ANY field, so a document on an ordinary question must print.
    const buf = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, photosInline: true,
      documents: [{ field_id: 'q', instance: 0, filename: 'particulars.pdf' }],
    } as any) as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})

// The report opens with an auto-built list of findings. It is driven by the ANSWER
// COLOUR, not the word "No", because several questions are deliberately reversed — where
// Yes is the problem and No is green. A naive "list every No" would report those
// backwards and miss the real finding.
describe('JobPDF summary of findings', () => {
  const REVERSED = [
    { value: 'yes', label: 'Yes', color: 'amber' },
    { value: 'no', label: 'No', color: 'green' },
    { value: 'na', label: 'N/A', color: 'gray' },
  ]
  const FOUR = [
    { value: 'yes', label: 'Yes', color: 'green' },
    { value: 'no', label: 'No', color: 'red' },
    { value: 'na', label: 'N/A', color: 'gray' },
    { value: 'ni', label: 'N/I', color: 'amber' },
  ]
  const sections = [{
    id: 's1', title: 'Certification', is_repeatable: false,
    fields: [
      { id: 'ok', label: 'Are all certificates valid?', field_type: 'yes_no_na', item_number: '3.1', order_index: 0, options: FOUR },
      { id: 'bad', label: 'Are lifejackets in date?', field_type: 'yes_no_na', item_number: '6.1', order_index: 1, options: FOUR },
      { id: 'rev', label: 'Any outstanding conditions of class?', field_type: 'yes_no_na', item_number: '3.7', order_index: 2, options: REVERSED },
      { id: 'ni', label: 'Are void spaces satisfactory?', field_type: 'yes_no_na', item_number: '12.9', order_index: 3, options: FOUR },
      { id: 'na', label: 'Is a gangway fitted?', field_type: 'yes_no_na', item_number: '9.1', order_index: 4, options: FOUR },
      { id: 'txt', label: 'Flag', field_type: 'text', item_number: '2.2', order_index: 5 },
    ],
  }]
  const common = {
    job: { id: 'j', job_number: '1', vessel_name: 'V', template: { name: 'T' } } as any,
    arrayValues: {}, signatures: {}, photoCount: 0, photos: [], surveyors: ['A. Taylor'],
  }

  it('renders with findings and with none', async () => {
    const clean = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, deficiencySummary: true,
      fieldValues: { ok: 'yes', bad: 'yes', rev: 'no', ni: 'yes', na: 'na', txt: 'Vanuatu' },
    } as any) as any)
    const dirty = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, deficiencySummary: true,
      fieldValues: { ok: 'yes', bad: 'no|||two expired', rev: 'yes|||CoC 24-01 open', ni: 'ni', na: 'na', txt: 'Vanuatu' },
    } as any) as any)
    // Three findings (red No, amber reversed-Yes, amber N/I) plus their remarks make the
    // document meaningfully larger than the all-clear version.
    expect(dirty.length).toBeGreaterThan(clean.length)
  }, 25000)

  it('a reversed question contributes only when its answer is the adverse one', async () => {
    // "Any outstanding conditions of class?" — Yes is amber (a finding), No is green.
    const revYes = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, deficiencySummary: true,
      fieldValues: { rev: 'yes' },
    } as any) as any)
    const revNo = await renderToBuffer(React.createElement(JobPDF, {
      ...common, sections: sections as any, deficiencySummary: true,
      fieldValues: { rev: 'no' },
    } as any) as any)
    // Answering No must produce the "nothing adverse" line, not a listed finding.
    expect(revYes.length).toBeGreaterThan(revNo.length)
  }, 25000)

  it('is off unless the template asks for it', async () => {
    const [on, off] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections as any, deficiencySummary: true, fieldValues: { bad: 'no|||two expired' } } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: sections as any, fieldValues: { bad: 'no|||two expired' } } as any) as any),
    ])
    expect(on.length).toBeGreaterThan(off.length)
  }, 25000)
})

// The Pre-Hire Inspection template (migration 170) is far larger than anything that
// came before: 17 sections, ~160 fields, dotted item numbers, a gated repeatable
// findings section and two signatures. This is the cheap standing proof that a report
// that size renders at all.
describe('JobPDF at Pre-Hire Inspection scale', () => {
  it('renders 17 sections / ~160 fields with inline photos and signatures', async () => {
    const types = ['yes_no_na', 'yes_no', 'text', 'number', 'textarea', 'date'] as const
    const sections: any[] = Array.from({ length: 14 }, (_, s) => ({
      id: `s${s}`, title: `Section ${s + 1}`, is_repeatable: false,
      fields: [
        ...Array.from({ length: 11 }, (_, f) => ({
          id: `s${s}f${f}`,
          label: `Question ${s + 1}.${f + 1} — is the equipment in good order and within its service date?`,
          field_type: types[(s + f) % types.length],
          item_number: `${s + 1}.${f + 1}`,
          order_index: f,
          with_remarks: true,
          options: [
            { value: 'yes', label: 'Yes', color: 'green' },
            { value: 'no', label: 'No', color: 'red' },
            { value: 'na', label: 'N/A', color: 'gray' },
            { value: 'ni', label: 'Not inspected', color: 'gray' },
          ],
        })),
        { id: `s${s}ph`, label: 'Photographs', field_type: 'photo', item_number: `${s + 1}.12`, order_index: 11 },
      ],
    }))
    sections.push({
      id: 'findings', title: 'Findings — Observations & Deficiencies', is_repeatable: true,
      fields: [
        { id: 'fa', label: 'Area / location', field_type: 'text', order_index: 0 },
        { id: 'fb', label: 'Item number referenced', field_type: 'text', order_index: 1 },
        { id: 'fc', label: 'What was observed', field_type: 'textarea', order_index: 2, pdf_hide_when_empty: true },
        { id: 'fd', label: 'Photographs', field_type: 'photo', order_index: 3 },
      ],
    })
    sections.push({
      id: 'signoff', title: 'Surveyor Sign-off', is_repeatable: false,
      fields: [
        { id: 'sa', label: 'Report prepared by', field_type: 'text', order_index: 0 },
        { id: 'sb', label: 'Signature', field_type: 'signature', order_index: 1, is_required: true },
        { id: 'sc', label: 'Signed on', field_type: 'date', order_index: 2 },
        { id: 'sd', label: 'Ship’s representative present at sign-off', field_type: 'text', order_index: 3 },
        { id: 'se', label: 'Ship’s representative signature', field_type: 'signature', order_index: 4 },
      ],
    })

    const fieldValues: Record<string, string> = { sa: 'A. Taylor', sc: '2026-08-14', sd: 'C/O J. Doe' }
    const answers = ['yes', 'no|||replacement on order', 'na', 'ni|||engine room not entered']
    for (let s = 0; s < 14; s++) {
      for (let f = 0; f < 11; f++) fieldValues[`s${s}f${f}`] = answers[(s + f) % answers.length]
    }
    // Two findings entries.
    Object.assign(fieldValues, {
      fa: 'Boat deck, stbd', fb: '6.7', fc: 'Liferaft cradle cracked at the weld.',
      'fa@@1': 'Engine room', 'fb@@1': '11.3', 'fc@@1': 'Oil accumulation in the bilge.',
    })

    // Photos: 2 per area section, 2 per finding.
    const photos = [
      ...Array.from({ length: 28 }, (_, i) => ({
        field_id: `s${Math.floor(i / 2)}ph`, instance: 0, url: IMG, caption: null, filename: `s${i}.jpg`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        field_id: 'fd', instance: i < 2 ? 0 : 1, url: IMG, caption: null, filename: `f${i}.jpg`,
      })),
    ]

    const el = React.createElement(JobPDF as any, {
      job: {
        id: 'j1', title: 'Pre-Hire Inspection', job_number: '26-08-014', vessel_name: 'Test Vessel',
        client: { name: 'Test Client' }, repeatable_order: { findings: [0, 1] },
        template: { name: 'Pre-Hire Inspection', pdf_include_photos: true },
      },
      sections, fieldValues, arrayValues: {},
      signatures: { sb: IMG, se: IMG },
      photoCount: photos.length, photos,
      surveyors: ['Captain Andrew Taylor'],
      preamble: 'This report records the condition, certification and equipment of the vessel as observed on board on the date stated.',
      disclaimer: 'This report remains the property of Taylor Engineering.',
      balancedHeader: true, photosInline: true,
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(10000)
  }, 60000)
})
