// Inventory reads and admin CRUD. Migrations 190/191.
//
// House conventions (lib/vessels/api.ts, lib/jobs/tracker.ts): a fresh
// createClient() per call, functions return { error?: string } rather than
// throwing, one shared COLS string per table, and two list functions — active
// only for pickers, everything for the admin screen.
//
// WRITES TO THE LEDGER DO NOT LIVE HERE. See movements.ts: inventory_movements
// has no INSERT policy for anyone, and stock is derived. Nothing in this file
// may write inventory_stock or inventory_movements.

import { createClient } from '@/lib/supabase/client'
import { num } from './packs'
import { soonestExpiry, totalUnits } from './stock'
import type {
  InventoryItem, InventoryKind, InventoryLocation, ItemWithStock,
  MovementDetail, StockRow,
} from './types'

// Omitting a column here silently leaves the field `undefined` on every consumer
// — the same trap documented in lib/vessels/api.ts. Keep these in step with the
// interfaces in types.ts.
const LOC_COLS =
  'id, name, kind, is_active, sort_order, notes, created_at'

const ITEM_COLS =
  'id, kind, name, category, sku, notes, is_active, unit_label, pack_label, units_per_pack, ' +
  'min_qty_units, reorder_qty_units, serial_number, manufacturer, model, calibrated_at, ' +
  'calibration_due, calibration_note, calibration_interval_months, service_status, ' +
  'held_by, held_since, created_at, updated_at'

const STOCK_COLS = 'item_id, location_id, qty_units, expiry_date, updated_at'

const MOVE_COLS =
  'id, item_id, kind, qty_units, from_location_id, to_location_id, from_holder_id, to_holder_id, ' +
  'packs_at_time, units_per_pack_at_time, expiry_date, note, reverses_movement_id, actor_id, created_at'

// ============================================================
// Locations
// ============================================================

export async function listLocations(): Promise<InventoryLocation[]> {
  const { data } = await createClient()
    .from('inventory_locations').select(LOC_COLS)
    .eq('is_active', true).order('sort_order').order('name')
  return (data ?? []) as unknown as InventoryLocation[]
}

/** Admin screen — includes deactivated locations, which still hold history. */
export async function listAllLocations(): Promise<InventoryLocation[]> {
  const { data } = await createClient()
    .from('inventory_locations').select(LOC_COLS).order('sort_order').order('name')
  return (data ?? []) as unknown as InventoryLocation[]
}

export interface LocationInput {
  name: string
  kind?: InventoryLocation['kind']
  sort_order?: number
  notes?: string | null
  is_active?: boolean
}

export async function createLocation(input: LocationInput): Promise<{ error?: string; id?: string }> {
  const { data, error } = await createClient()
    .from('inventory_locations').insert(input).select('id').maybeSingle()
  if (error) return { error: friendlyLocationError(error) }
  return { id: (data as { id: string } | null)?.id }
}

export async function updateLocation(id: string, patch: Partial<LocationInput>): Promise<{ error?: string }> {
  const { data, error } = await createClient()
    .from('inventory_locations').update(patch).eq('id', id).select('id')
  if (error) return { error: friendlyLocationError(error) }
  // RLS filters an UPDATE to zero rows with NO error — the house idiom for
  // telling a real denial apart from a successful write (lib/offline/sync.ts).
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission.' }
  return {}
}

/**
 * Hard delete. Only possible when the location holds no stock and appears in no
 * movement; the ON DELETE RESTRICT FKs in migration 190 enforce that, so history
 * can never be orphaned by a click. Deactivating is the normal retirement.
 */
export async function deleteLocation(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('inventory_locations').delete().eq('id', id)
  if (error) return { error: friendlyLocationError(error) }
  return {}
}

function friendlyLocationError(error: { code?: string; message: string }): string {
  if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
    return 'A location with that name already exists.'
  }
  if (error.code === '23503' || /foreign key|violates/i.test(error.message)) {
    return 'This location still has stock or history. Deactivate it instead of deleting it.'
  }
  return error.message
}

// ============================================================
// Items
// ============================================================

/** Active items with their stock rolled up. `kind` narrows to one tab. */
export async function listItems(kind?: InventoryKind): Promise<ItemWithStock[]> {
  return fetchItems(kind, true)
}

/** Admin screen — includes archived items. */
export async function listAllItems(kind?: InventoryKind): Promise<ItemWithStock[]> {
  return fetchItems(kind, false)
}

async function fetchItems(kind: InventoryKind | undefined, activeOnly: boolean): Promise<ItemWithStock[]> {
  const supabase = createClient()
  let q = supabase.from('inventory_items').select(ITEM_COLS).order('name')
  if (kind) q = q.eq('kind', kind)
  if (activeOnly) q = q.eq('is_active', true)

  // Three flat reads rather than a nested embed: inventory_stock has no FK back
  // to profiles, and holder names come from a table with its own RLS. Batched,
  // so this is still one round trip's worth of latency.
  const [{ data: items }, { data: stock }, { data: people }] = await Promise.all([
    q,
    supabase.from('inventory_stock').select(STOCK_COLS),
    supabase.from('profiles').select('id, full_name'),
  ])

  return decorate(
    (items ?? []) as unknown as InventoryItem[],
    (stock ?? []) as unknown as StockRow[],
    (people ?? []) as { id: string; full_name: string }[],
  )
}

export async function getItem(id: string): Promise<ItemWithStock | null> {
  const supabase = createClient()
  const [{ data: item }, { data: stock }, { data: people }] = await Promise.all([
    supabase.from('inventory_items').select(ITEM_COLS).eq('id', id).maybeSingle(),
    supabase.from('inventory_stock').select(STOCK_COLS).eq('item_id', id),
    supabase.from('profiles').select('id, full_name'),
  ])
  if (!item) return null
  return decorate(
    [item as unknown as InventoryItem],
    (stock ?? []) as unknown as StockRow[],
    (people ?? []) as { id: string; full_name: string }[],
  )[0]
}

/** Roll stock onto each item and resolve the holder's name. */
function decorate(
  items: InventoryItem[],
  stock: StockRow[],
  people: { id: string; full_name: string }[],
): ItemWithStock[] {
  const names = new Map(people.map(p => [p.id, p.full_name]))
  const byItem = new Map<string, StockRow[]>()
  for (const raw of stock) {
    // NUMERIC arrives as a string on some supabase-js paths — coerce once, here,
    // so nothing downstream ever has to think about it.
    const row: StockRow = { ...raw, qty_units: num(raw.qty_units) }
    const list = byItem.get(row.item_id)
    if (list) list.push(row)
    else byItem.set(row.item_id, [row])
  }

  return items.map(item => {
    const rows = byItem.get(item.id) ?? []
    return {
      ...item,
      units_per_pack: num(item.units_per_pack),
      min_qty_units: item.min_qty_units === null ? null : num(item.min_qty_units),
      reorder_qty_units: item.reorder_qty_units === null ? null : num(item.reorder_qty_units),
      stock: rows,
      total_units: totalUnits(rows),
      holder_name: item.held_by ? names.get(item.held_by) ?? null : null,
      soonest_expiry: soonestExpiry(rows),
    }
  })
}

export type ItemInput =
  Pick<InventoryItem, 'kind' | 'name'> &
  Partial<Omit<InventoryItem, 'id' | 'kind' | 'name' | 'held_by' | 'held_since' | 'created_at' | 'updated_at'>>

export async function createItem(input: ItemInput): Promise<{ error?: string; id?: string }> {
  // .select() here is safe ONLY because item-create is admin-only and admins can
  // SELECT items. If a surveyor is ever allowed to create one, this chained
  // select becomes a migration-164 failure that LOOKS like an INSERT denial.
  const { data, error } = await createClient()
    .from('inventory_items').insert(input).select('id').maybeSingle()
  if (error) return { error: friendlyItemError(error) }
  return { id: (data as { id: string } | null)?.id }
}

export async function updateItem(id: string, patch: Partial<ItemInput>): Promise<{ error?: string }> {
  const { data, error } = await createClient()
    .from('inventory_items').update(patch).eq('id', id).select('id')
  if (error) return { error: friendlyItemError(error) }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission.' }
  return {}
}

export async function setItemActive(id: string, is_active: boolean): Promise<{ error?: string }> {
  return updateItem(id, { is_active })
}

/**
 * Plain delete. Succeeds only for an item with no history — the FKs see to that.
 * Use purgeItem() when the caller has knowingly chosen to destroy the history too.
 */
export async function deleteItem(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('inventory_items').delete().eq('id', id)
  if (error) return { error: friendlyItemError(error) }
  return {}
}

/**
 * Delete an item AND its history. Admin only (migration 193).
 *
 * This is the escape hatch for a catalogue mistake — a typo'd item, a duplicate,
 * something added while working out how the page worked. It is NOT the way to
 * fix a wrong movement: reverseMovement() is, because that keeps both the error
 * and the correction on the record.
 *
 * Returns how many movements were destroyed, so the UI can say so afterwards.
 */
export async function purgeItem(id: string): Promise<{ error?: string; movements?: number }> {
  const { data, error } = await createClient().rpc('inventory_purge_item', { p_item_id: id })
  if (error) return { error: error.message }
  return { movements: Number(data ?? 0) }
}

/** How much history an item carries — what a delete confirmation needs to say. */
export async function countItemMovements(id: string): Promise<number> {
  const { count } = await createClient()
    .from('inventory_movements')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', id)
  return count ?? 0
}

function friendlyItemError(error: { code?: string; message: string }): string {
  if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
    return 'An active item with that name already exists.'
  }
  if (error.code === '23503' || /foreign key|violates/i.test(error.message)) {
    return 'This item has movement history and cannot be deleted. Archive it instead.'
  }
  if (error.code === '23514' || /inventory_items_kind_shape/i.test(error.message)) {
    return 'Those settings do not fit this item type — equipment has no pack size, and a consumable has no calibration date.'
  }
  return error.message
}

// ============================================================
// History
// ============================================================
//
// RLS decides what comes back: admins and office-with-inventory.history.view see
// everything, a surveyor sees only their own rows. Neither call needs a role
// check of its own — but the UI must not present an empty result as "no history",
// because for a surveyor it means "not yours to see".

export interface HistoryFilter {
  itemId?: string
  locationId?: string
  actorId?: string
  from?: string
  to?: string
  kind?: string
  limit?: number
}

export async function listMovements(filter: HistoryFilter = {}): Promise<MovementDetail[]> {
  const supabase = createClient()
  let q = supabase.from('inventory_movements').select(MOVE_COLS)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 200)

  if (filter.itemId) q = q.eq('item_id', filter.itemId)
  if (filter.actorId) q = q.eq('actor_id', filter.actorId)
  if (filter.kind) q = q.eq('kind', filter.kind)
  if (filter.from) q = q.gte('created_at', filter.from)
  if (filter.to) q = q.lte('created_at', filter.to)
  if (filter.locationId) {
    q = q.or(`from_location_id.eq.${filter.locationId},to_location_id.eq.${filter.locationId}`)
  }

  const [{ data: moves }, { data: items }, { data: locs }, { data: people }] = await Promise.all([
    q,
    supabase.from('inventory_items').select('id, name, unit_label, pack_label'),
    supabase.from('inventory_locations').select('id, name'),
    supabase.from('profiles').select('id, full_name'),
  ])

  const itemById = new Map((items ?? []).map((i: { id: string }) => [i.id, i as {
    id: string; name: string; unit_label: string; pack_label: string
  }]))
  const locById = new Map((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name]))
  const nameById = new Map((people ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]))

  const rows = (moves ?? []) as unknown as MovementDetail[]
  // A row is "reversed" when some correction in this result set points at it.
  const reversedIds = new Set(rows.map(m => m.reverses_movement_id).filter(Boolean) as string[])

  return rows.map(m => {
    const item = itemById.get(m.item_id)
    const holder = m.to_holder_id ?? m.from_holder_id
    return {
      ...m,
      qty_units: num(m.qty_units),
      item_name: item?.name ?? 'Deleted item',
      item_unit_label: item?.unit_label ?? 'unit',
      item_pack_label: item?.pack_label ?? 'pack',
      actor_name: nameById.get(m.actor_id) ?? null,
      from_location_name: m.from_location_id ? locById.get(m.from_location_id) ?? null : null,
      to_location_name: m.to_location_id ? locById.get(m.to_location_id) ?? null : null,
      holder_name: holder ? nameById.get(holder) ?? null : null,
      reversed: reversedIds.has(m.id),
    }
  })
}

/** "My activity" — the surveyor's own rows, which is all RLS will return anyway. */
export async function listMyMovements(limit = 20): Promise<MovementDetail[]> {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return []
  return listMovements({ actorId: user.id, limit })
}

export async function listItemHistory(itemId: string, limit = 50): Promise<MovementDetail[]> {
  return listMovements({ itemId, limit })
}

// ============================================================
// Boards — all readable by surveyors, none touching the ledger
// ============================================================

/** Everything at or below its reorder level, plus anything gone negative. */
export async function listLowStock(): Promise<ItemWithStock[]> {
  const items = await listItems('consumable')
  return items.filter(i =>
    i.total_units < 0 || (i.min_qty_units !== null && i.total_units <= i.min_qty_units))
}

/** Equipment whose calibration falls due inside `withinDays`, and anything past. */
export async function listCalibrationDue(withinDays = 60): Promise<ItemWithStock[]> {
  const items = await listItems('asset')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + withinDays)
  const limit = cutoff.toISOString().slice(0, 10)
  return items
    .filter(i => i.service_status !== 'retired' && i.calibration_due && i.calibration_due <= limit)
    .sort((a, b) => (a.calibration_due ?? '').localeCompare(b.calibration_due ?? ''))
}

/** Stock expiring inside `withinDays`, and anything already expired. */
export async function listExpiringSoon(withinDays = 60): Promise<ItemWithStock[]> {
  const items = await listItems('consumable')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + withinDays)
  const limit = cutoff.toISOString().slice(0, 10)
  return items
    .filter(i => i.soonest_expiry && i.soonest_expiry <= limit)
    .sort((a, b) => (a.soonest_expiry ?? '').localeCompare(b.soonest_expiry ?? ''))
}

/**
 * What the signed-in user is holding. Reads inventory_items.held_by, NOT the
 * ledger — which is exactly why custody is denormalised onto the item row: a
 * surveyor can answer "what have I got?" without any history access at all.
 */
export async function listMyHeldAssets(): Promise<ItemWithStock[]> {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return []
  const items = await listItems('asset')
  return items.filter(i => i.held_by === user.id)
}

export async function listHeldAssets(): Promise<ItemWithStock[]> {
  const items = await listItems('asset')
  return items.filter(i => i.held_by !== null)
}

/** Active staff who can take custody of equipment — the check-out picker. */
export async function listCustodyCandidates(): Promise<{ id: string; full_name: string }[]> {
  const { data } = await createClient()
    .from('profiles').select('id, full_name')
    .eq('is_active', true).in('role', ['admin', 'surveyor', 'office'])
    .order('full_name')
  return (data ?? []) as { id: string; full_name: string }[]
}
