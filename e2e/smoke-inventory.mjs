/**
 * Smoke test — inventory permissions and the movement RPC, against the live database.
 *
 * vitest in this repo is pure-function only, so NOTHING in migrations 190/191 is
 * covered by `npm test`. This script is the only thing that proves the policies
 * actually behave. It provisions a throwaway surveyor plus a test item and two
 * locations, then signs in AS the surveyor and asserts both halves of the
 * permission model:
 *
 *   CAN   record a movement, move stock, check equipment out and in, read stock,
 *         read their OWN history, undo their own entry.
 *   CANNOT insert into the ledger directly, touch the derived stock table,
 *         create or edit an item, or see anyone else's movements.
 *
 * It also pins the three things most likely to break silently:
 *   * idempotency — the same client_ref twice must not double-decrement
 *   * the negative guard — and that confirming it through works
 *   * the rollup — stock must equal the sum of the ledger at the end
 *
 * Run:  npm run smoke-inventory
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit code 0 = the permission model holds. Non-zero = something is wrong.
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

const admin = createClient(URL, SR, { auth: { persistSession: false } })
const stamp = Date.now()
const email = `smoke-inv-${stamp}@tayeng-test.local`
const password = 'Smoke!Test12345'

let userId, otherId, itemId, assetId, locA, locB, failures = 0
const cleanup = []
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }

/** A read that must return rows. 0 rows with no error is the silent-denial trap. */
const check = (r, label) =>
  (r.error || !r.data?.length) ? bad(`${label}: ${r.error?.message ?? '0 rows (silently denied)'}`) : ok(label)

/** A write that must be REFUSED — either an error, or filtered to zero rows. */
const mustDeny = (r, label) =>
  (r.error || !r.data?.length) ? ok(`${label} — correctly refused`) : bad(`${label} — WAS ALLOWED (${r.data.length} row(s))`)

const uuid = () => crypto.randomUUID()

async function stockAt(item, loc) {
  const { data } = await admin.from('inventory_stock')
    .select('qty_units').eq('item_id', item).eq('location_id', loc).maybeSingle()
  return Number(data?.qty_units ?? 0)
}

try {
  // ---------- ADMIN: provision ----------
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error('createUser: ' + ce.message)
  userId = created.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(userId))
  await admin.from('profiles')
    .update({ full_name: 'Smoke Inventory Surveyor', role: 'surveyor', is_active: true }).eq('id', userId)

  const { data: locs, error: le } = await admin.from('inventory_locations').insert([
    { name: `SMOKE Loc A ${stamp}`, short_name: 'A', kind: 'store' },
    { name: `SMOKE Loc B ${stamp}`, short_name: 'B', kind: 'store' },
  ]).select('id')
  if (le) throw new Error('insert locations: ' + le.message)
  locA = locs[0].id; locB = locs[1].id

  // Two separate inserts, deliberately. A PostgREST BULK insert of objects with
  // different keys sends an explicit NULL for every key a row is missing — it
  // does not fall back to the column DEFAULT — so a mixed batch here fails on
  // unit_label NOT NULL. Worth knowing before writing any bulk import.
  const { data: consumable, error: ie } = await admin.from('inventory_items').insert({
    kind: 'consumable', name: `SMOKE Bottles ${stamp}`,
    unit_label: 'bottle', pack_label: 'box', units_per_pack: 24, min_qty_units: 24,
  }).select('id').single()
  if (ie) throw new Error('insert consumable: ' + ie.message)
  itemId = consumable.id

  const { data: asset, error: ae } = await admin.from('inventory_items').insert({
    kind: 'asset', name: `SMOKE Gauge ${stamp}`, serial_number: `SN-${stamp}`,
  }).select('id').single()
  if (ae) throw new Error('insert asset: ' + ae.message)
  assetId = asset.id

  // A real person who is NOT our surveyor. The seed movements are attributed to
  // them, which doubles as the fixture for the "can't see other people's
  // movements" check further down.
  const { data: otherProf } = await admin.from('profiles')
    .select('id').eq('is_active', true).neq('id', userId).limit(1).single()
  otherId = otherProf?.id
  if (!otherId) throw new Error('need one other active profile to attribute the seed to')

  // Cleanup MUST go through inventory_purge_item (migration 193).
  //
  // A plain delete of inventory_movements is refused even for the service role —
  // trg_inventory_movements_immutable is deliberately that strong. The first
  // version of this script did exactly that, the delete raised, every later step
  // in the stack was skipped, and four SMOKE items sat on the live Inventory page
  // until someone noticed them. Migration 193 both fixed that and swept them up.
  //
  // Locations can only go AFTER their items: the ON DELETE RESTRICT FKs on the
  // movement rows hold them until the history is gone.
  cleanup.push(async () => {
    // A run that died between check_out and check_in would leave held_by set,
    // and purge refuses a held asset by design. Release it first so cleanup is
    // unconditional — this is teardown, not a user action.
    await admin.from('inventory_items')
      .update({ held_by: null, held_since: null }).in('id', [itemId, assetId])

    for (const id of [itemId, assetId]) {
      const { error } = await admin.rpc('inventory_purge_item', { p_item_id: id })
      if (error) console.log(`  (cleanup warn: purge ${id}: ${error.message})`)
    }
    const { error: locErr } = await admin.from('inventory_locations').delete().in('id', [locA, locB])
    if (locErr) console.log(`  (cleanup warn: locations: ${locErr.message})`)
  })

  // Seed 3 boxes = 72 bottles at A, plus the gauge.
  //
  // Written straight into the ledger as the service role rather than through the
  // RPC: the RPC reads auth.uid(), which is NULL for a service-role client with
  // no JWT, so it correctly refuses. (Worth knowing before anyone tries to seed
  // inventory from an /api route — do it with a direct insert, or act as a user.)
  // The rollup trigger still fires, so this doubles as proof it is armed.
  const { error: seedErr } = await admin.from('inventory_movements').insert([
    { item_id: itemId, kind: 'receive', qty_units: 72, to_location_id: locA,
      packs_at_time: 3, units_per_pack_at_time: 24, actor_id: otherId, client_ref: uuid() },
    { item_id: assetId, kind: 'receive', qty_units: 1, to_location_id: locA,
      packs_at_time: null, units_per_pack_at_time: 1, actor_id: otherId, client_ref: uuid() },
  ])
  if (seedErr) throw new Error('seed receive: ' + seedErr.message)
  if (await stockAt(itemId, locA) !== 72) throw new Error('seed did not land — rollup trigger not firing?')
  ok('the rollup trigger fires on a ledger insert (0 → 72)')

  console.log('Provisioned: 2 locations, 1 consumable (72 bottles at A), 1 asset. Acting as the surveyor:\n')

  // ---------- SURVEYOR ----------
  const sb = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: se } = await sb.auth.signInWithPassword({ email, password })
  if (se) throw new Error('surveyor signIn: ' + se.message)

  // --- reads a surveyor MUST have ---
  check(await sb.from('inventory_items').select('id').eq('id', itemId), 'read items')
  check(await sb.from('inventory_locations').select('id').eq('id', locA), 'read locations')
  check(await sb.from('inventory_stock').select('qty_units').eq('item_id', itemId), 'read stock levels')

  // --- take 1 box, through the RPC ---
  const takeRef = uuid()
  const take = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'take', p_qty_units: 24,
    p_from_location_id: locA, p_packs: 1, p_client_ref: takeRef,
  })
  if (take.error) bad(`take 1 box: ${take.error.message}`)
  else if (await stockAt(itemId, locA) !== 48) bad(`take 1 box: stock is ${await stockAt(itemId, locA)}, expected 48`)
  else ok('take 1 box (72 → 48 bottles)')

  // --- IDEMPOTENCY: the same tap replayed must not decrement twice ---
  const replay = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'take', p_qty_units: 24,
    p_from_location_id: locA, p_packs: 1, p_client_ref: takeRef,
  })
  const afterReplay = await stockAt(itemId, locA)
  if (replay.error) bad(`replay same client_ref: ${replay.error.message}`)
  else if (afterReplay !== 48) bad(`replay DOUBLE-DECREMENTED: stock is ${afterReplay}, expected 48`)
  else ok('replaying the same client_ref does not double-decrement')

  const { count: takeRows } = await admin.from('inventory_movements')
    .select('id', { count: 'exact', head: true }).eq('client_ref', takeRef)
  if (takeRows === 1) ok('exactly one ledger row for that client_ref')
  else bad(`client_ref wrote ${takeRows} rows, expected 1`)

  // --- move stock between locations ---
  const mv = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'move', p_qty_units: 24,
    p_from_location_id: locA, p_to_location_id: locB, p_packs: 1, p_client_ref: uuid(),
  })
  if (mv.error) bad(`move a box A → B: ${mv.error.message}`)
  else if (await stockAt(itemId, locA) !== 24 || await stockAt(itemId, locB) !== 24) bad('move: both sides did not update')
  else ok('move a box from A to B (24 at each)')

  // --- the negative guard: blocked, then confirmed through ---
  const over = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'take', p_qty_units: 999,
    p_from_location_id: locA, p_client_ref: uuid(),
  })
  if (over.error?.code === '23514') ok('taking more than recorded is blocked with 23514')
  else bad(`negative guard: expected 23514, got ${over.error?.code ?? 'success'}`)

  const forced = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'take', p_qty_units: 30,
    p_from_location_id: locA, p_allow_negative: true, p_client_ref: uuid(),
  })
  if (forced.error) bad(`confirmed negative take: ${forced.error.message}`)
  else if (await stockAt(itemId, locA) !== -6) bad(`confirmed negative take: stock is ${await stockAt(itemId, locA)}, expected -6`)
  else ok('confirming through records reality and goes negative (-6)')

  // --- recount clears it ---
  const recount = await sb.rpc('inventory_record_movement', {
    p_item_id: itemId, p_kind: 'adjust', p_counted_units: 0,
    p_from_location_id: locA, p_client_ref: uuid(),
  })
  if (recount.error) bad(`recount to 0: ${recount.error.message}`)
  else if (await stockAt(itemId, locA) !== 0) bad(`recount: stock is ${await stockAt(itemId, locA)}, expected 0`)
  else ok('a recount brings a negative back to the counted truth')

  // --- equipment custody ---
  const out = await sb.rpc('inventory_record_movement', {
    p_item_id: assetId, p_kind: 'check_out', p_holder_id: userId, p_client_ref: uuid(),
  })
  if (out.error) bad(`check out the gauge: ${out.error.message}`)
  else {
    const { data: held } = await admin.from('inventory_items').select('held_by, held_since').eq('id', assetId).single()
    if (held?.held_by === userId && held?.held_since) ok('check out the gauge (custody recorded on the item)')
    else bad(`check out: held_by is ${held?.held_by}, expected ${userId}`)
  }

  const outAgain = await sb.rpc('inventory_record_movement', {
    p_item_id: assetId, p_kind: 'check_out', p_holder_id: userId, p_client_ref: uuid(),
  })
  if (outAgain.error) ok('checking out an already-held gauge is refused')
  else bad('checking out an already-held gauge WAS ALLOWED')

  const back = await sb.rpc('inventory_record_movement', {
    p_item_id: assetId, p_kind: 'check_in', p_client_ref: uuid(),
  })
  if (back.error) bad(`check the gauge back in: ${back.error.message}`)
  else {
    const { data: held } = await admin.from('inventory_items').select('held_by').eq('id', assetId).single()
    if (held?.held_by === null) ok('check the gauge back in (custody cleared)')
    else bad('check in did not clear held_by')
  }

  // --- own history is visible; the undo path works ---
  check(await sb.from('inventory_movements').select('id').eq('client_ref', takeRef), 'read OWN ledger rows')

  const undo = await sb.rpc('inventory_reverse_movement', {
    p_movement_id: (await admin.from('inventory_movements').select('id').eq('client_ref', takeRef).single()).data.id,
    p_client_ref: uuid(),
  })
  if (undo.error) bad(`undo own entry: ${undo.error.message}`)
  else ok('undo own entry (writes a correction, deletes nothing)')

  // ---------- what a surveyor MUST NOT be able to do ----------
  console.log('')

  mustDeny(
    await sb.from('inventory_movements').insert({
      item_id: itemId, kind: 'take', qty_units: 24, from_location_id: locA, actor_id: userId,
    }).select('id'),
    'raw INSERT into the ledger',
  )

  mustDeny(
    await sb.from('inventory_stock').update({ qty_units: 9999 }).eq('item_id', itemId).select('item_id'),
    'direct UPDATE of the derived stock table',
  )

  mustDeny(
    await sb.from('inventory_items').insert({ kind: 'consumable', name: `SMOKE Rogue ${stamp}` }).select('id'),
    'creating an item',
  )

  mustDeny(
    await sb.from('inventory_items').update({ name: 'renamed by a surveyor' }).eq('id', itemId).select('id'),
    'renaming an item',
  )

  mustDeny(
    await sb.from('inventory_locations').insert({ name: `SMOKE Rogue Loc ${stamp}` }).select('id'),
    'creating a location',
  )

  mustDeny(
    await sb.from('inventory_movements').delete().eq('client_ref', takeRef).select('id'),
    'deleting a ledger row',
  )

  // Someone else's rows must be invisible — 0 rows here is the CORRECT answer.
  if (otherId) {
    const { data: theirs, error: theirErr } = await sb.from('inventory_movements')
      .select('id').eq('actor_id', otherId)
    if (theirErr) bad(`reading another user's movements errored: ${theirErr.message}`)
    else if (theirs.length === 0) ok("another user's movements are invisible")
    else bad(`another user's movements WERE VISIBLE (${theirs.length} rows)`)
  }

  // Admin-only surfaces
  mustDeny(await sb.from('inventory_reminders').select('item_id'), 'reading the reminder latch')

  const rebuild = await sb.rpc('inventory_stock_rebuild', {})
  if (rebuild.error) ok('inventory_stock_rebuild is admin-only — correctly refused')
  else bad('inventory_stock_rebuild WAS ALLOWED for a surveyor')

  // The purge RPC destroys history, so it must be admin-only even though every
  // surveyor holds EXECUTE on it (migration 193 gates on is_admin() inside).
  const purge = await sb.rpc('inventory_purge_item', { p_item_id: itemId })
  if (purge.error) ok('inventory_purge_item is admin-only — correctly refused')
  else bad('inventory_purge_item WAS ALLOWED for a surveyor')

  // ---------- the rollup must equal the ledger ----------
  console.log('')
  for (const loc of [locA, locB]) {
    const { data: moves } = await admin.from('inventory_movements')
      .select('qty_units, from_location_id, to_location_id').eq('item_id', itemId)
    const fromLedger = (moves ?? []).reduce((sum, m) =>
      sum + (m.to_location_id === loc ? Number(m.qty_units) : 0)
          - (m.from_location_id === loc ? Number(m.qty_units) : 0), 0)
    const rollup = await stockAt(itemId, loc)
    if (rollup === fromLedger) ok(`rollup matches the ledger at ${loc === locA ? 'A' : 'B'} (${rollup})`)
    else bad(`ROLLUP DRIFT at ${loc === locA ? 'A' : 'B'}: stock ${rollup}, ledger ${fromLedger}`)
  }
} catch (err) {
  bad(`unexpected error: ${err.message}`)
} finally {
  for (const c of cleanup.reverse()) { try { await c() } catch (e) { console.log(`  (cleanup warn: ${e.message})`) } }
}

console.log(failures === 0
  ? '\n✓ INVENTORY SMOKE PASS — surveyors can run stock, and cannot break the books.'
  : `\n✗ INVENTORY SMOKE FAIL — ${failures} check(s) failed. Investigate before shipping.`)
process.exit(failures === 0 ? 0 : 1)
