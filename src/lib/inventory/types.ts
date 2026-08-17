// Inventory domain types — migrations 190 (schema) and 191 (RPCs).
//
// Domain-local, following the cargo/offline precedent. Only the two office
// permission keys live in lib/types/database.ts, because that file holds the
// types shared across many surfaces.
//
// THE ONE RULE: quantities are always in BASE UNITS (bottles, sticks), never in
// packs. "3 boxes (72 bottles)" is a display concern — see packs.ts. Storing
// packs would make a part-used box unrepresentable, which is the entire reason
// for the two-level model.

/** consumable = counted stock; asset = one physical thing, calibrated and held. */
export type InventoryKind = 'consumable' | 'asset'

export type MovementKind =
  | 'receive'    // stock arrives at a location
  | 'take'       // stock is consumed, leaves the system
  | 'move'       // between two locations
  | 'adjust'     // a recount: the delta between counted and recorded
  | 'check_out'  // an asset passes into someone's custody
  | 'check_in'   // an asset comes back
  | 'correction' // the mirror of an earlier movement; written only by the undo RPC

/** 'negative' — the write landed but the count is now below zero, so the books
 *  need a recount. 'duplicate' — a retry of an already-recorded tap; treat as
 *  success, because it is one. */
export type MovementWarning = 'negative' | 'duplicate' | null

export type ServiceStatus = 'in_service' | 'out_for_calibration' | 'out_of_service' | 'retired'

export type LocationKind = 'office' | 'store' | 'vehicle' | 'vessel' | 'other'

export interface InventoryLocation {
  id: string
  name: string
  kind: LocationKind
  is_active: boolean
  sort_order: number
  notes: string | null
  created_at: string
}

/**
 * One person who can hold equipment. NAMES ONLY — this comes from
 * inventory_staff_directory() (migration 194), not from profiles, so it carries
 * no email, phone or employee number.
 */
export interface StaffMember {
  id: string
  full_name: string
  role: string
}

export interface InventoryItem {
  id: string
  /** Drives which fields below are meaningful — migration 190 CHECKs enforce it. */
  kind: InventoryKind
  name: string
  category: string | null
  sku: string | null
  notes: string | null
  is_active: boolean

  // ---- pack maths (consumables; always 1 for an asset) --------------------
  unit_label: string      // 'bottle'
  pack_label: string      // 'box'
  units_per_pack: number
  /** Reorder thresholds in BASE UNITS. null = no low-stock alert for this item. */
  min_qty_units: number | null
  reorder_qty_units: number | null

  // ---- equipment ----------------------------------------------------------
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  calibrated_at: string | null
  calibration_due: string | null
  calibration_note: string | null
  /** Suggests the next due date when a calibration is recorded. Never applied
   *  automatically — the certificate is the authority, not our arithmetic. */
  calibration_interval_months: number | null
  service_status: ServiceStatus

  // ---- custody ------------------------------------------------------------
  /** Who has it in hand right now, or null when it is in stores. Written ONLY by
   *  the migration-190 trigger via the movement RPCs — never patched directly,
   *  so it can never disagree with the history. */
  held_by: string | null
  held_since: string | null

  created_at: string
  updated_at: string
}

/** One item's stock at one location. DERIVED — see migration 190. */
export interface StockRow {
  item_id: string
  location_id: string
  qty_units: number
  /** Per-location batch date, set when stock is received there. */
  expiry_date: string | null
  updated_at?: string
}

export interface ItemWithStock extends InventoryItem {
  stock: StockRow[]
  /** Sum across every location, in base units. */
  total_units: number
  /** Resolved from held_by; null when nobody holds it. */
  holder_name: string | null
  /** Earliest expiry across the item's locations, for the list badge. */
  soonest_expiry: string | null
}

/**
 * A ledger row. Admins and office-with-`inventory.history.view` see all of them;
 * a surveyor sees only their own (migration 190's SELECT policy).
 */
export interface InventoryMovement {
  id: string
  item_id: string
  kind: MovementKind
  qty_units: number
  from_location_id: string | null
  to_location_id: string | null
  from_holder_id: string | null
  to_holder_id: string | null
  /** What the human actually entered. Render history from THESE, not from the
   *  item's current units_per_pack — otherwise correcting a pack size silently
   *  rewrites what every past entry appears to say. */
  packs_at_time: number | null
  units_per_pack_at_time: number | null
  expiry_date: string | null
  note: string | null
  reverses_movement_id: string | null
  actor_id: string
  created_at: string
}

/** A movement joined to the names a history table needs. */
export interface MovementDetail extends InventoryMovement {
  item_name: string
  item_unit_label: string
  item_pack_label: string
  actor_name: string | null
  from_location_name: string | null
  to_location_name: string | null
  holder_name: string | null
  /** True when some later `correction` row reverses this one. */
  reversed: boolean
}

/**
 * What `inventory_record_movement` returns: the resulting STOCK state, never the
 * ledger row. Migration 164's lesson — a chained .select() on an insert is
 * checked against the SELECT policy, so returning the ledger row would fail for
 * exactly the users who most need the write to work.
 */
export interface MovementResult {
  movement_id: string
  item_id: string
  kind: MovementKind
  qty_units: number
  from_location_id: string | null
  from_qty_units: number | null
  to_location_id: string | null
  to_qty_units: number | null
  total_qty_units: number
  held_by: string | null
  warning: MovementWarning
}
