# Brand assets

Archived original artwork for the app — client logos, marks, etc. — kept in the
repo so we always have the source file, independent of what's uploaded to
Supabase storage (the `client-logos` bucket, referenced by `clients.logo_path`).

These files are **not** wired into the app automatically. To put a logo on a
client, use **Clients → Edit → Upload logo**, which uploads to the
`client-logos` bucket. This folder is just the source-of-truth archive.

## Naming

`<short-client-slug>.<ext>` — e.g. `london-pi.png`, `asco.png`.

## Logos on file

| Client | File | Notes |
|---|---|---|
| The London Steam-Ship Owners' Mutual Insurance Association Limited (**London P&I Club**) | `london-pi.png` | Drop the PNG here; same file uploaded to the client via Edit Client. |
