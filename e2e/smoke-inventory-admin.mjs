/**
 * Smoke test — the ADMIN lifecycle, against the live database.
 *
 * smoke-inventory.mjs proves a surveyor can run stock and cannot break the books.
 * This one proves the other half: that an admin can actually set the thing up and
 * take it apart again — add a location, add items, stock them, correct them,
 * rename them, archive them, and delete them cleanly with nothing left behind.
 *
 * It drives the exact calls the UI makes, so a break here is a break on screen.
 *
 * Run:  npm run smoke-inventory-admin
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON || !SR) {
  console.error('✗ Missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const service = createClient(URL, SR, { auth: { persistSession: false } })
const stamp = Date.now()
const email = `smoke-admin-${stamp}@tayeng-test.local`
const password = 'Smoke!Test12345'

let userId, failures = 0
const madeItems = []
const madeLocations = []

const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }
const uuid = () => crypto.randomUUID()

async function stockAt(item, loc) {
  const { data } = await service.from('inventory_stock')
    .select('qty_units').eq('item_id', item).eq('location_id', loc).maybeSingle()
  return Number(data?.qty_units ?? 0)
}

try {
  const { data: created, error: ce } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error('createUser: ' + ce.message)
  userId = created.user.id
  await service.from('profiles')
    .update({ full_name: 'Smoke Admin', role: 'admin', is_active: true }).eq('id', userId)

  const db = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: se } = await db.auth.signInWithPassword({ email, password })
  if (se) throw new Error('admin signIn: ' + se.message)
  console.log('Signed in as a throwaway admin. Running the full lifecycle:\n')

  // ---------- LOCATIONS ----------
  const { data: locA, error: laErr } = await db.from('inventory_locations')
    .insert({ name: `Smoke Store A ${stamp}`, kind: 'store', sort_order: 900 }).select('id').single()
  if (laErr) throw new Error('create location A: ' + laErr.message)
  madeLocations.push(locA.id)
  ok('create a location')

  const { data: locB } = await db.from('inventory_locations')
    .insert({ name: `Smoke Store B ${stamp}`, kind: 'vehicle', sort_order: 910 }).select('id').single()
  madeLocations.push(locB.id)

  const dupe = await db.from('inventory_locations').insert({ name: `Smoke Store A ${stamp}` }).select('id')
  if (dupe.error?.code === '23505') ok('a duplicate location name is rejected')
  else bad(`duplicate location name was accepted (${dupe.error?.code ?? 'no error'})`)

  const renamed = await db.from('inventory_locations')
    .update({ name: `Smoke Store A2 ${stamp}` }).eq('id', locA.id).select('id')
  if (!renamed.error && renamed.data?.length === 1) ok('rename a location')
  else bad(`rename a location: ${renamed.error?.message ?? '0 rows'}`)

  // ---------- CONSUMABLE ----------
  const { data: item, error: ie } = await db.from('inventory_items').insert({
    kind: 'consumable', name: `Smoke Bottles ${stamp}`, category: 'Sampling',
    unit_label: 'bottle', pack_label: 'box', units_per_pack: 24, min_qty_units: 24,
  }).select('id').single()
  if (ie) throw new Error('create consumable: ' + ie.message)
  madeItems.push(item.id)
  ok('create a consumable with a pack size')

  // A consumable may not carry equipment fields — migration 190's CHECK.
  const badShape = await db.from('inventory_items').insert({
    kind: 'consumable', name: `Smoke Bad ${stamp}`, calibration_due: '2027-01-01',
  }).select('id')
  if (badShape.error) ok('a consumable cannot be given a calibration date')
  else { madeItems.push(badShape.data[0].id); bad('a consumable WAS given a calibration date') }

  // ---------- STOCK MOVEMENTS ----------
  const receive = await db.rpc('inventory_record_movement', {
    p_item_id: item.id, p_kind: 'receive', p_qty_units: 72,
    p_to_location_id: locA.id, p_packs: 3, p_expiry_date: '2027-06-30', p_client_ref: uuid(),
  })
  if (receive.error) bad(`receive 3 boxes: ${receive.error.message}`)
  else if (await stockAt(item.id, locA.id) !== 72) bad('receive: stock did not reach 72')
  else ok('receive 3 boxes (72 bottles)')

  const { data: expiryRow } = await service.from('inventory_stock')
    .select('expiry_date').eq('item_id', item.id).eq('location_id', locA.id).single()
  if (expiryRow?.expiry_date === '2027-06-30') ok('the receive stamped that location with its expiry date')
  else bad(`expiry not recorded: got ${expiryRow?.expiry_date}`)

  const take = await db.rpc('inventory_record_movement', {
    p_item_id: item.id, p_kind: 'take', p_qty_units: 24,
    p_from_location_id: locA.id, p_packs: 1, p_client_ref: uuid(),
  })
  if (!take.error && await stockAt(item.id, locA.id) === 48) ok('take 1 box (72 → 48)')
  else bad(`take: ${take.error?.message ?? `stock is ${await stockAt(item.id, locA.id)}`}`)

  const mv = await db.rpc('inventory_record_movement', {
    p_item_id: item.id, p_kind: 'move', p_qty_units: 24,
    p_from_location_id: locA.id, p_to_location_id: locB.id, p_packs: 1, p_client_ref: uuid(),
  })
  if (!mv.error && await stockAt(item.id, locA.id) === 24 && await stockAt(item.id, locB.id) === 24) {
    ok('move a box between locations (24 / 24)')
  } else bad(`move: ${mv.error?.message ?? 'counts wrong'}`)

  const sameLoc = await db.rpc('inventory_record_movement', {
    p_item_id: item.id, p_kind: 'move', p_qty_units: 1,
    p_from_location_id: locA.id, p_to_location_id: locA.id, p_client_ref: uuid(),
  })
  if (sameLoc.error) ok('moving a location to itself is rejected')
  else bad('moving a location to itself WAS ALLOWED')

  const recount = await db.rpc('inventory_record_movement', {
    p_item_id: item.id, p_kind: 'adjust', p_counted_units: 20,
    p_from_location_id: locA.id, p_client_ref: uuid(),
  })
  if (!recount.error && await stockAt(item.id, locA.id) === 20) ok('recount 24 → 20 writes the difference')
  else bad(`recount: ${recount.error?.message ?? `stock is ${await stockAt(item.id, locA.id)}`}`)

  // ---------- EDIT ----------
  const edited = await db.from('inventory_items')
    .update({ name: `Smoke Bottles ${stamp} v2`, min_qty_units: 48, units_per_pack: 12 })
    .eq('id', item.id).select('id')
  if (!edited.error && edited.data?.length === 1) ok('rename an item and change its pack size')
  else bad(`edit item: ${edited.error?.message ?? '0 rows'}`)

  const { data: afterEdit } = await service.from('inventory_movements')
    .select('units_per_pack_at_time').eq('item_id', item.id).eq('kind', 'receive').single()
  if (Number(afterEdit?.units_per_pack_at_time) === 24) {
    ok('history keeps the OLD pack size, so past entries still read as recorded')
  } else bad(`history pack size was rewritten to ${afterEdit?.units_per_pack_at_time}`)

  // ---------- EQUIPMENT ----------
  const { data: gauge, error: ge } = await db.from('inventory_items').insert({
    kind: 'asset', name: `Smoke Gauge ${stamp}`, serial_number: `SN-${stamp}`,
    manufacturer: 'Cygnus', calibration_due: '2027-01-15', calibration_interval_months: 12,
  }).select('id').single()
  if (ge) throw new Error('create equipment: ' + ge.message)
  madeItems.push(gauge.id)
  ok('create equipment with a calibration date')

  const packedAsset = await db.from('inventory_items')
    .update({ units_per_pack: 6 }).eq('id', gauge.id).select('id')
  if (packedAsset.error) ok('equipment cannot be given a pack size')
  else bad('equipment WAS given a pack size')

  await db.rpc('inventory_record_movement', {
    p_item_id: gauge.id, p_kind: 'receive', p_qty_units: 1, p_to_location_id: locA.id, p_client_ref: uuid(),
  })
  const dupAsset = await db.rpc('inventory_record_movement', {
    p_item_id: gauge.id, p_kind: 'receive', p_qty_units: 1, p_to_location_id: locB.id, p_client_ref: uuid(),
  })
  if (dupAsset.error) ok('one gauge cannot be received into two places at once')
  else bad('a gauge WAS received twice')

  const out = await db.rpc('inventory_record_movement', {
    p_item_id: gauge.id, p_kind: 'check_out', p_holder_id: userId, p_client_ref: uuid(),
  })
  if (out.error) bad(`check out: ${out.error.message}`)
  else ok('check the gauge out')

  const heldDelete = await db.rpc('inventory_purge_item', { p_item_id: gauge.id })
  if (heldDelete.error) ok('a checked-out gauge cannot be deleted')
  else bad('a checked-out gauge WAS deleted')

  await db.rpc('inventory_record_movement', { p_item_id: gauge.id, p_kind: 'check_in', p_client_ref: uuid() })
  ok('check the gauge back in')

  // ---------- ARCHIVE / RESTORE ----------
  await db.from('inventory_items').update({ is_active: false }).eq('id', item.id)
  const { data: activeOnly } = await db.from('inventory_items')
    .select('id').eq('kind', 'consumable').eq('is_active', true).eq('id', item.id)
  if (!activeOnly?.length) ok('an archived item drops out of the active list')
  else bad('an archived item is still listed as active')

  await db.from('inventory_items').update({ is_active: true }).eq('id', item.id)
  ok('restore it again')

  // ---------- DELETE ----------
  const locWithStock = await db.from('inventory_locations').delete().eq('id', locA.id).select('id')
  if (locWithStock.error?.code === '23503') ok('a location holding stock cannot be deleted')
  else bad(`location with stock was deletable (${locWithStock.error?.code ?? 'no error'})`)

  const deactivated = await db.from('inventory_locations')
    .update({ is_active: false }).eq('id', locA.id).select('id')
  if (!deactivated.error && deactivated.data?.length === 1) ok('a location holding stock CAN be deactivated')
  else bad(`deactivate location: ${deactivated.error?.message ?? '0 rows'}`)
  await db.from('inventory_locations').update({ is_active: true }).eq('id', locA.id)

  const purged = await db.rpc('inventory_purge_item', { p_item_id: item.id })
  if (purged.error) bad(`purge the consumable: ${purged.error.message}`)
  else {
    const left = await stockAt(item.id, locA.id)
    const { count } = await service.from('inventory_movements')
      .select('id', { count: 'exact', head: true }).eq('item_id', item.id)
    if (left === 0 && count === 0) ok(`delete the consumable and its ${purged.data} history entries`)
    else bad(`purge left ${count} movement(s) and stock ${left}`)
  }

  const gone = await db.rpc('inventory_purge_item', { p_item_id: item.id })
  if (gone.error) ok('deleting the same item twice is refused, not silently ignored')
  else bad('deleting an already-deleted item reported success')

  await db.rpc('inventory_purge_item', { p_item_id: gauge.id })

  const nowEmpty = await db.from('inventory_locations').delete().in('id', madeLocations).select('id')
  if (!nowEmpty.error && nowEmpty.data?.length === 2) ok('once the items are gone, the locations delete cleanly')
  else bad(`delete locations: ${nowEmpty.error?.message ?? `${nowEmpty.data?.length} of 2`}`)

  madeItems.length = 0
  madeLocations.length = 0
} catch (err) {
  bad(`unexpected error: ${err.message}`)
} finally {
  // Belt and braces: anything the run created but did not manage to remove.
  for (const id of madeItems) {
    await service.from('inventory_items').update({ held_by: null, held_since: null }).eq('id', id)
    const { error } = await service.rpc('inventory_purge_item', { p_item_id: id })
    if (error) console.log(`  (cleanup warn: item ${id}: ${error.message})`)
  }
  if (madeLocations.length) {
    const { error } = await service.from('inventory_locations').delete().in('id', madeLocations)
    if (error) console.log(`  (cleanup warn: locations: ${error.message})`)
  }
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId)
    if (error) console.log(`  (cleanup warn: user: ${error.message})`)
  }
}

console.log(failures === 0
  ? '\n✓ ADMIN SMOKE PASS — an admin can set inventory up and take it apart cleanly.'
  : `\n✗ ADMIN SMOKE FAIL — ${failures} check(s) failed. Investigate before shipping.`)
process.exit(failures === 0 ? 0 : 1)
