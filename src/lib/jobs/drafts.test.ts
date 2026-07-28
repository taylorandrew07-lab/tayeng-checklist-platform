import { describe, it, expect, vi } from 'vitest'
import { createDraftJob } from './drafts'
import type { SupabaseClient } from '@supabase/supabase-js'

// Don't fire real notifications from these unit tests.
vi.mock('@/lib/jobs/notify', () => ({ notifyAssignment: vi.fn() }))

type UpsertCall = { table: string; values: any; options: any }

/**
 * Minimal fake Supabase client. Records every insert/upsert and lets a test
 * force a per-table error. `from(t).upsert(...)` is both awaitable (the
 * client_job_permissions / job_surveyors / activity_log paths await it directly)
 * AND chainable via .select().single() (the jobs path).
 */
function fakeSupabase(opts: {
  errors?: Record<string, { message: string }>
  /** What the job_types lookup returns for the reminder default (migration 162). */
  jobTypeReminderHours?: number | null
} = {}) {
  const calls: UpsertCall[] = []
  const errors = opts.errors ?? {}

  const from = (table: string) => {
    const result = { data: table === 'jobs' ? { id: 'job-1', title: 'MV Test' } : null, error: errors[table] ?? null }
    const thenable = {
      select: () => ({ single: () => Promise.resolve(result) }),
      then: (res: (v: any) => unknown) => Promise.resolve(result).then(res),
    }
    return {
      upsert: (values: any, options?: any) => { calls.push({ table, values, options }); return thenable },
      insert: (values: any) => { calls.push({ table, values, options: undefined }); return thenable },
      // Read path — only the job_types reminder-default lookup uses it.
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: opts.jobTypeReminderHours === undefined ? null : { reminder_hours: opts.jobTypeReminderHours },
            error: null,
          }),
        }),
      }),
    }
  }

  return { client: { from } as unknown as SupabaseClient, calls }
}

/** The row the jobs insert/upsert was called with. */
const jobRow = (calls: UpsertCall[]) => calls.find(c => c.table === 'jobs')!.values

const baseInput = {
  job: { id: 'job-1', title: 'MV Test' },
  surveyorIds: [] as string[],
  actorId: 'actor-1',
  notify: false as const,
}

describe('createDraftJob — client_job_permissions retry safety', () => {
  it('grants client access with ignoreDuplicates so a retried sync is a no-op, not an RLS-rejected UPDATE', async () => {
    const { client, calls } = fakeSupabase()

    const result = await createDraftJob(client, { ...baseInput, clientId: 'client-9' }, 'manual')

    const cp = calls.find(c => c.table === 'client_job_permissions')
    expect(cp).toBeDefined()
    // The whole point of the fix: DO NOTHING on conflict (INSERT-only RLS grant),
    // never DO UPDATE.
    expect(cp!.options).toMatchObject({ onConflict: 'client_id,job_id', ignoreDuplicates: true })
    expect(result.permissionError).toBeUndefined()
  })

  it('surfaces a permission failure instead of swallowing it', async () => {
    const { client } = fakeSupabase({
      errors: { client_job_permissions: { message: 'new row violates row-level security policy' } },
    })

    const result = await createDraftJob(client, { ...baseInput, clientId: 'client-9' }, 'manual')

    // Job still created (non-fatal), but the error is no longer silent.
    expect(result.job).not.toBeNull()
    expect(result.permissionError).toBe('new row violates row-level security policy')
  })

  it('skips the permission write entirely when there is no client', async () => {
    const { client, calls } = fakeSupabase()

    const result = await createDraftJob(client, { ...baseInput, clientId: null }, 'manual')

    expect(calls.some(c => c.table === 'client_job_permissions')).toBe(false)
    expect(result.permissionError).toBeUndefined()
  })
})

// Migration 162. This seam is what decides whether a job ever reminds at all, so
// the inheritance rules are pinned down here rather than left to the UI.
describe('createDraftJob — report reminder default (migration 162)', () => {
  const typed = { ...baseInput, job: { ...baseInput.job, job_type: 'Fuel Loadout' } }

  it('copies the job type default onto a new job', async () => {
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: 96 })
    await createDraftJob(client, typed, 'manual')
    expect(jobRow(calls).reminder_hours).toBe(96)
  })

  it('leaves the reminder off when the job type has no default', async () => {
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: null })
    await createDraftJob(client, typed, 'manual')
    expect(jobRow(calls).reminder_hours).toBeUndefined()
  })

  it('does not look up a default when the job has no type', async () => {
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: 96 })
    await createDraftJob(client, baseInput, 'manual')
    expect(jobRow(calls).reminder_hours).toBeUndefined()
  })

  it('lets an explicit value from the caller win over the type default', async () => {
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: 96 })
    await createDraftJob(client, { ...typed, job: { ...typed.job, reminder_hours: 24 } }, 'manual')
    expect(jobRow(calls).reminder_hours).toBe(24)
  })

  it('respects an explicit null ("off") instead of re-applying the type default', async () => {
    // A job deliberately created with no reminder must not have one seeded back in.
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: 96 })
    await createDraftJob(client, { ...typed, job: { ...typed.job, reminder_hours: null } }, 'manual')
    expect(jobRow(calls).reminder_hours).toBeNull()
  })

  it('applies the default on the offline-sync upsert path too', async () => {
    const { client, calls } = fakeSupabase({ jobTypeReminderHours: 48 })
    await createDraftJob(client, { ...typed, upsert: true }, 'manual')
    expect(jobRow(calls).reminder_hours).toBe(48)
  })
})
