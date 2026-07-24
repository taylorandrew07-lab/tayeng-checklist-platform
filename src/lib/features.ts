// Feature flags for staged rollout.
//
// CLIENT_PORTAL_ENABLED: the client-facing portal (client login + everything a
// client can see) is intentionally OFF while the app is rebuilt. Client COMPANY
// records and billing are unaffected — this only gates the client *login/view*.
// The portal scaffolding (/client routes, client RLS, client_job_permissions)
// is left intact, so flipping this back to `true` restores access without a
// rebuild. See the v2 plan: clients return on a clean permissions model.
export const CLIENT_PORTAL_ENABLED = false

// COMPETITION_VIDEO_ENABLED: the staff photo competition (mig 159) can also
// accept VIDEO. The storage bucket, size caps, RLS and upload path are all
// provisioned, but the entrant UI stays photos-only until this flips to `true`
// — nobody has been told about video yet. Flip it here to reveal the video
// uploader; no migration or rebuild needed.
export const COMPETITION_VIDEO_ENABLED = false
