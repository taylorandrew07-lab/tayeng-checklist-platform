# Brand assets

Archived original artwork for the app — client logos, marks, etc. — kept in the
repo so we always have the source file, independent of what's uploaded to
Supabase storage (the `client-logos` bucket, referenced by `clients.logo_path`).

## Company artwork (`company/`)

The official 2026 Taylor Engineering Agencies Limited logo pack, copied verbatim
from the website's `logo-source/app-export` folder. **Read `company/README.md`
first** — the "T" in the mark is negative space and must never be filled white,
and the lockup is 4.3:1 so it is always sized by width.

Everything the app actually serves is *generated* from these masters:

```
node brand-assets/generate.mjs     # → public/brand/*  +  public/favicon.ico
```

| Served file | Made from | Used by |
|---|---|---|
| `public/brand/lockup-white.png` | `lockup-white-transparent.png` | sidebar, sign-in / sign-up / password pages, template preview band (all navy) |
| `public/brand/lockup-dark.png` | `lockup-dark-transparent.png` | every printed letterhead — checklist / invoice / borescoping / cargo / DRI PDFs, the DRI .docx, the cargo data annex — and the DRI on-screen preview |
| `public/brand/favicon-16.png`, `favicon-32.png`, `public/favicon.ico` | `mark-transparent.png` | browser tab — the mark alone, no navy box (a filled square reads as a dark outlined block at 16px) |
| `public/brand/apple-touch-icon.png` (180) | `app-icon-1024-navy.png` | iOS home screen |
| `public/brand/icon-192.png`, `icon-512.png` | `app-icon-1024-navy.png` | web manifest (`purpose: any`) |
| `public/brand/icon-maskable-192.png`, `icon-maskable-512.png` | `app-icon-1024-navy-maskable.png` | web manifest (`purpose: maskable`, Android adaptive) |

`lockup-dark-on-white.jpg` (flattened) is kept for e-mail signatures and Word
documents made outside the app; the app itself uses the transparent PNG because
the cargo annex letterhead sits on a grey page, where a flattened file would show
a white box. On white paper the two are identical.

Never hand-edit `public/brand/`; replace the master and re-run the script.

**Then bump `VERSION` in `public/sw.js`.** The service worker caches every file
here by name, and these names never change, so regenerating one leaves each staff
device holding the old bytes. It now refreshes them in the background, which heals
a device on its *next* load by itself — but the version bump is what drops the old
artwork immediately instead of one load later. Skipping it once already left the
navy favicon on screen after it had been replaced, with the correct file live on
the server the whole time.

These files are **not** wired into the app automatically. To put a logo on a
client, use **Clients → Edit → Upload logo**, which uploads to the
`client-logos` bucket. This folder is just the source-of-truth archive.

## Naming

`<short-client-slug>.<ext>` — e.g. `london-pi.png`, `asco.png`.

## Logos on file

| Client | File | Notes |
|---|---|---|
| The London Steam-Ship Owners' Mutual Insurance Association Limited (**London P&I Club**) | `london-pi.png` | Drop the PNG here; same file uploaded to the client via Edit Client. |
