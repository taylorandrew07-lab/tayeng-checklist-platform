// DRI report register — official numbering shared with the job/checklist series.
// Issuing a number is a cloud, staff-only action (admin/office): it draws from the
// same sequence as job numbers via the issue_cargo_report_number RPC (migration 063)
// and records the issue in cargo_report_register.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RegisterEntry {
  id: string
  report_number: string
  voyage_id: string | null
  vessel_name: string | null
  voyage_number: string | null
  issued_by_name: string | null
  issued_at: string
}

/** Issue a new official report number for a voyage and record it in the register. */
export async function issueReportNumber(
  supabase: SupabaseClient,
  args: { voyageId: string; vessel: string; voyageNo: string; sections: string[] }
): Promise<{ reportNumber: string }> {
  const { data, error } = await supabase.rpc('issue_cargo_report_number', {
    p_voyage_id: args.voyageId,
    p_vessel: args.vessel,
    p_voyage_no: args.voyageNo,
    p_sections: args.sections,
  })
  if (error) throw error
  if (!data?.ok || !data?.report_number) throw new Error('Could not issue a report number')
  return { reportNumber: data.report_number as string }
}

/** The most recent issued number for a voyage, or null if none issued yet. */
export async function getVoyageReportNumber(supabase: SupabaseClient, voyageId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('cargo_report_register')
    .select('report_number')
    .eq('voyage_id', voyageId)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data.report_number as string
}

/** Full register listing (admin + office). Newest first. */
export async function listReportRegister(supabase: SupabaseClient): Promise<RegisterEntry[]> {
  const { data, error } = await supabase
    .from('cargo_report_register')
    .select('id, report_number, voyage_id, vessel_name, voyage_number, issued_by_name, issued_at')
    .order('issued_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as RegisterEntry[]
}
