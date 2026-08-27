// The regression net for "don't change any other checklist's report".
//
// The existing JobPDF.render.test.ts is a smoke suite: every assertion in it is
// `length > N` or `a.length !== b.length`. Not one of them proves an output is
// UNCHANGED, so it would stay green through a layout edit that moved every answer
// column in the BPTT fuel checklist (74 of the app's jobs, used weekly).
//
// This file pins the four flag combinations that actually flow through JobPDF in
// production, plus the Pre-Hire shape with its flags OFF, against golden digests.
// Migration 202 added ten per-template presentation flags; every one defaults to false,
// and these goldens are what proves that "false" really is today's report.
//
// DETERMINISM: @react-pdf stamps a random /ID and a second-resolution /CreationDate into
// every document — measured by diffing two renders of identical props: 60 differing
// bytes, all inside /ID. Those two are normalised away below; nothing else varies.
// `expect(a.equals(b))` without that normalisation fails for reasons that have nothing
// to do with the renderer, and whoever hits it concludes the guard is unusable.
//
// TO RE-CAPTURE (only when a change to another template's report is INTENDED and
// approved — never to make a red test go away):
//   UPDATE_JOBPDF_GOLDEN=1 npx vitest run src/lib/pdf/JobPDF.unchanged.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { JobPDF } from './JobPDF'

const normalise = (b: Buffer) =>
  b.toString('latin1')
    .replace(/\/ID\s*\[[^\]]*\]/g, '/ID[NORMALISED]')
    .replace(/\(D:\d{14}[^)]*\)/g, '(D:NORMALISED)')
const digest = (b: Buffer) => createHash('sha256').update(normalise(b)).digest('hex')

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const sections = [
  {
    id: 's1', title: 'Vessel Particulars', is_repeatable: false, fields: [
      { id: 'f1', label: 'Date', field_type: 'date', item_number: '1.1', order_index: 0 },
      { id: 'f2', label: 'Port', field_type: 'text', item_number: '1.2', order_index: 1 },
      // A short-answer row (wide label, 64%) immediately followed by a narrow-label row
      // (38%). That adjacency IS the alignment behaviour migration 202 changes, so every
      // combination below must contain it or the goldens prove nothing about the thing
      // actually at risk.
      {
        id: 'f3', label: 'Are all statutory certificates valid and on board?', field_type: 'yes_no_na',
        item_number: '1.3', order_index: 2,
        options: [{ value: 'yes', label: 'Yes', color: 'green' }, { value: 'no', label: 'No', color: 'red' }, { value: 'na', label: 'N/A', color: 'gray' }],
      },
      { id: 'f4', label: 'Observations', field_type: 'textarea', item_number: '1.4', order_index: 3 },
      {
        id: 'f5', label: 'Equipment fitted', field_type: 'multiple_choice', item_number: '1.5', order_index: 4,
        options: [{ value: 'a', label: 'EPIRB' }, { value: 'b', label: 'SART' }],
      },
      { id: 'f6', label: 'Photographs', field_type: 'photo', item_number: '1.6', order_index: 5 },
      // A lettered detail number stored AFTER a later plain one — what pdf_sort_by_item_number
      // reorders, and what must NOT be reordered with the flag off.
      { id: 'f7', label: 'Date of last drydocking', field_type: 'date', item_number: '1.10A', order_index: 6 },
    ],
  },
  // A repeatable section with NO data at all: the forced blank "Entry 1" that
  // pdf_hide_empty_repeatables suppresses, and that every other template still prints.
  {
    id: 's2', title: 'Findings — Observations & Deficiencies', is_repeatable: true, fields: [
      { id: 'g1', label: 'Area / location', field_type: 'text', item_number: '14.1', order_index: 0 },
    ],
  },
]

const fieldValues = {
  f1: '2026-08-24',
  f2: 'Chaguaramas',
  // A remark long enough to trigger pdf_remark_below, so the flag-off shape is pinned.
  f3: 'no|||two certificates expired, and the vessel could not produce the original of a third, which the master said was ashore with the agent for renewal',
  f4: 'Rust noted at frame 42.',
  f7: '2025-07-21',
}

const base = {
  job: {
    id: 'j1', title: 'T', job_number: 'TEAL C/L #1280', report_number: '26-08-263',
    vessel_name: 'Navigator', vessel_type: 'MV', client: { name: 'Test Client' },
    scheduled_date: '2026-08-24', template: { name: 'Tpl' },
  },
  sections,
  fieldValues,
  // Stored in the order the surveyor TAPPED them, i.e. not the template's option order —
  // what pdf_sort_choices reorders.
  arrayValues: { f5: ['b', 'a'] },
  signatures: {},
  photoCount: 1,
  photos: [{ field_id: 'f6', instance: 0, url: IMG, caption: null, filename: 'a.jpg' }],
  surveyors: ['Captain Andrew Taylor'],
  // A non-image attachment: the in-body line pdf_embed_attachments turns into a
  // cross-reference. With no `number` it must stay the bare "Attached: …".
  documents: [{ field_id: 'f6', instance: 0, filename: 'Crew List.pdf' }],
  disclaimer: 'Disclaimer text goes here and is reasonably long so it wraps across more than a single line of six point italic text.',
  preamble: 'Intro paragraph.',
}

// The flag combinations that reach JobPDF in production, as of 2026-08-26. NONE of them
// sets a migration-202 flag — that is the point: these are the reports Andrew said must
// not change. (Daily Borescoping is absent because it renders through its own file.)
const COMBOS: Record<string, any> = {
  // BPTT LLC + Fuel Transfer Checklist — 74 jobs, both used this week.
  fuel: { ...base, hideLogo: true, hideClient: true, hideSurveyor: true },
  // Ultrasonic Hatch Testing + OVID Survey — 5 jobs.
  plain: { ...base, hideLogo: true },
  // Brine Transfer Checklist — 1 job.
  brine: { ...base, hideLogo: true, balancedHeader: true },
  // The Pre-Hire feature set with the new flags still OFF, so a regression in the
  // flag-off path of the busiest code (findings walk, inline photos) is caught too.
  prehireFlagsOff: { ...base, photosInline: true, deficiencySummary: true, balancedHeader: true },
  // 75 jobs carry NO template at all: the embed is null, every flag is undefined and the
  // whole report is the letterhead plus the header block. The single largest group, and
  // the one nobody counts.
  notpl: { ...base, sections: [], photos: [], documents: [], photoCount: 0 },
}

const GOLDEN = path.join(__dirname, '__fixtures__', 'jobpdf-golden.json')

describe('JobPDF: templates other than Pre-Hire render unchanged', () => {
  const actual: Record<string, string> = {}

  beforeAll(async () => {
    for (const [name, props] of Object.entries(COMBOS)) {
      actual[name] = digest(Buffer.from(await renderToBuffer(React.createElement(JobPDF as any, props) as any)))
    }
    if (process.env.UPDATE_JOBPDF_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
      fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n')
    }
  }, 120000)

  for (const name of Object.keys(COMBOS)) {
    it(`${name} is byte-identical to the golden`, () => {
      const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
      expect(actual[name]).toBe(golden[name])
    })
  }

  // Independent of the goldens: a false flag must be indistinguishable from an absent
  // one. This is what protects the 75 template-less jobs, where the props arrive
  // undefined rather than false.
  it('an explicitly-false flag renders identically to an absent one', async () => {
    const [absent, explicit] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF as any, COMBOS.fuel) as any),
      renderToBuffer(React.createElement(JobPDF as any, {
        ...COMBOS.fuel,
        uniformLabelWidth: false, showReportNumber: false, hideEmptyRepeatables: false,
        noHyphenation: false, remarkBelow: false, sortChoices: false, formatDates: false,
        sortByItemNumber: false, findingDetail: false,
      }) as any),
    ])
    expect(digest(Buffer.from(absent))).toBe(digest(Buffer.from(explicit)))
  }, 40000)

  // …and the flags must actually DO something, or every assertion above is passing for
  // the wrong reason: a no-op change would satisfy the whole file.
  it('the Pre-Hire flags change the output when on', async () => {
    const [off, on] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF as any, COMBOS.prehireFlagsOff) as any),
      renderToBuffer(React.createElement(JobPDF as any, {
        ...COMBOS.prehireFlagsOff,
        uniformLabelWidth: true, showReportNumber: true, hideEmptyRepeatables: true,
        noHyphenation: true, remarkBelow: true, sortChoices: true, formatDates: true,
        sortByItemNumber: true, findingDetail: true,
      }) as any),
    ])
    expect(digest(Buffer.from(off))).not.toBe(digest(Buffer.from(on)))
  }, 40000)
})
