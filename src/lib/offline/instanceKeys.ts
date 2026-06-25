// Repeatable-section instance keys.
//
// A repeatable section can be filled out N times in one job. Rather than reshape
// every value/photo/signature map (which would ripple through the offline draft and
// its conflict-detection), we keep the existing `Record<fieldKey, …>` maps and encode
// the instance IN the key: instance 0 is the bare field id (so all existing data and
// non-repeatable fields are untouched), instance ≥ 1 is `${fieldId}@@${n}`.
//
// Persistence: job_field_values / job_photos / job_signatures gain an `instance`
// SMALLINT column (default 0) and a unique key of (job_id, field_id, instance).
// Anything that reads those tables into a map keys with instanceKey(); anything that
// writes them back parses with parseInstanceKey(). Field ids are UUIDs, so the "@@"
// separator can never collide with a real id.

export const INSTANCE_SEP = '@@'

export function instanceKey(fieldId: string, instance: number): string {
  return instance > 0 ? `${fieldId}${INSTANCE_SEP}${instance}` : fieldId
}

export function parseInstanceKey(key: string): { fieldId: string; instance: number } {
  const i = key.indexOf(INSTANCE_SEP)
  if (i === -1) return { fieldId: key, instance: 0 }
  const n = Number(key.slice(i + INSTANCE_SEP.length))
  return { fieldId: key.slice(0, i), instance: Number.isFinite(n) && n > 0 ? n : 0 }
}
