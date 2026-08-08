# Fix Task — PDF download & share on mobile (checklist reports + cargo reports)

You are working in the Tayeng App codebase (Next.js 16 App Router + React 19 + TS + Tailwind + Supabase). Follow HANDOFF.md conventions. Production build is `next build --webpack`.

## The bug
On phones, "Download PDF" doesn't save or offer to share — it just opens the PDF inline in the browser. Causes:
- Checklist report buttons call `window.open('/api/pdf/${jobId}', '_blank')` (and one `<a href target="_blank">`). Mobile browsers ignore the server's `Content-Disposition: attachment` and render inline with no save/share option.
- The cargo report uses the `<a download>` blob trick (`src/lib/cargo/pdf/render.ts` -> `downloadCargoReport`), and iOS Safari ignores the `download` attribute on blob URLs, also opening inline.

## The fix (high level)
Route the PDF Blob through the Web Share API when available (gives the native iOS/Android share sheet: Save to Files, AirDrop, WhatsApp, Mail, etc.), and fall back to a real file download on desktop / unsupported browsers. Do NOT change the server render route's auth/logic.

## Step 1 — Shared helper: `src/lib/pdf/deliver.ts` (new)
Implement `deliverPdf(blob, filename, opts?)` and `deliverJobPdf(jobId)`:
- `deliverPdf`: build a `File([blob], filename, { type: 'application/pdf' })`. If `navigator.canShare?.({ files: [file] })`, `await navigator.share({ files: [file], title })`; catch `AbortError` (user cancelled) and return; on any other error fall through. Fallback: classic objectURL + `a.download` click + revoke. Guard `navigator` for SSR.
- `deliverJobPdf`: `fetch('/api/pdf/'+jobId, { credentials: 'include' })`; on !ok throw a friendly message (403/401/other); read filename from the `Content-Disposition` header (fallback `report-<jobId>.pdf`); `res.blob()` -> `deliverPdf`.

## Step 2 — Update checklist PDF call sites
Replace every `window.open('/api/pdf/...', '_blank')` and the client `<a href target="_blank">` with a button calling `deliverJobPdf(jobId)`, with a loading/disabled state and visible error. Files (verify via `grep -rn "api/pdf"`):
- `src/components/job/JobChecklistEditor.tsx` — two buttons (~lines 893, 1138).
- `src/app/(dashboard)/admin/jobs/[id]/page.tsx` — two buttons (~lines 160, 297).
- `src/app/(dashboard)/client/jobs/[id]/page.tsx` — convert `<a href>` (~line 107) to a `<button>` calling `deliverJobPdf(id)`.
- Final `grep -rn "api/pdf"` to catch any other spot (office is intentionally excluded).
Each: add a busy state (spinner + disabled while fetching, render can take seconds), try/catch surfacing `err.message`.

## Step 3 — Cargo report through the helper
In `src/lib/cargo/pdf/render.ts`, `downloadCargoReport()` (~lines 71–83): keep building blob + filename, replace the manual anchor block with `await deliverPdf(blob, filename, { title: filename })`. Ensure callers (e.g. `src/components/cargo/ReportBuilder.tsx`) still await + handle errors. Works offline on supported devices; download fallback also works offline.

## Gotchas
- `AbortError` from `navigator.share` = user cancelled = success (no error shown).
- Call only from direct click handlers (gesture requirement); HTTPS only (prod is fine).
- Do not alter `/api/pdf/[jobId]/route.ts`.

## Verify
- Real-device test (the whole point): iPhone Safari + Android Chrome — share sheet shows "Save to Files" + messaging/email, for a finished checklist report AND a cargo report. Desktop still downloads.
- Gates: `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test`, `npm run build`. Update HANDOFF.md. No PR unless asked.
