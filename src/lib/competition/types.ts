// Staff photo/video competition (migration 159). Monthly, blind-judged.
//
// The entry→entrant link lives in competition_entry_owners and is deliberately
// NOT part of CompetitionEntry — an admin judging the gallery must not learn who
// took each photo. Only `winner_name` (denormalised at reveal) exposes an
// identity, and only for entries that have already been placed.

export type MediaType = 'photo' | 'video'
export type Placement = 'winner' | 'runner_up'
export type RoundStatus = 'open' | 'judging' | 'closed'

export interface CompetitionEntry {
  id: string
  month: string // 'YYYY-MM-01' (Trinidad time, server-set)
  media_type: MediaType
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  filename: string | null
  caption: string | null
  captured_at: string | null
  placement: Placement | null
  placed_at: string | null
  winner_name: string | null
  created_at: string
}

export interface CompetitionRound {
  month: string
  theme: string | null
  status: RoundStatus
  closed_at: string | null
  created_at: string
  updated_at: string
}

/** An entry decorated with a fresh signed thumbnail/preview URL for display. */
export interface EntryWithUrl extends CompetitionEntry {
  url: string | null
  mine?: boolean
}

export const PLACEMENT_LABEL: Record<Placement, string> = {
  winner: 'Winner',
  runner_up: 'Runner-up',
}

/** Bucket for a media type. Photos and video are stored separately so the video
 *  bucket can carry a much larger size cap. */
export function bucketFor(mediaType: MediaType): 'competition-photos' | 'competition-video' {
  return mediaType === 'video' ? 'competition-video' : 'competition-photos'
}
