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
function fakeSupabase(opts: { errors?: Record<string, { message: string }> } = {}) {
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
    }
  }

  return { client: { from } as unknown as SupabaseClient, calls }
}

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
