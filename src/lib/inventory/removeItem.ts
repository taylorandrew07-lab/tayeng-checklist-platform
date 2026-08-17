'use client'

// ONE delete conversation, shared by the Stock list, the Equipment list and the
// Manage tab — so removing an item asks the same question and states the same
// consequence wherever you happen to be standing when you decide to remove it.
//
// The consequence is the whole point. An item with history cannot be deleted
// without destroying that history, and the user has to be told which case they
// are in BEFORE they confirm, in numbers, not in general terms.

import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { countItemMovements, deleteItem, purgeItem, updateItem } from './api'
import type { InventoryItem } from './types'

export type RemoveOutcome = 'deleted' | 'archived' | 'cancelled' | 'failed'

/**
 * Ask, then remove. Returns what actually happened so the caller can reload.
 *
 * Three shapes, decided by how much history the item carries:
 *   none      → a plain delete, described as exactly that
 *   some      → a destructive delete, with the count said out loud
 *   held      → refused by the database; we say to check it in first
 */
export async function removeItemWithPrompt(
  item: Pick<InventoryItem, 'id' | 'name' | 'kind' | 'held_by'>,
  { isAdmin }: { isAdmin: boolean },
): Promise<RemoveOutcome> {
  if (!isAdmin) {
    toast.error('Only an admin can remove items.')
    return 'failed'
  }

  if (item.held_by) {
    toast.error(`${item.name} is checked out. Check it back in before deleting it.`)
    return 'failed'
  }

  const movements = await countItemMovements(item.id)

  if (movements === 0) {
    const ok = await confirmDialog({
      title: `Delete ${item.name}?`,
      message: 'It has no history, so this removes it completely. Nothing else is affected.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return 'cancelled'

    const { error } = await deleteItem(item.id)
    if (error) { toast.error(error); return 'failed' }
    toast.success(`${item.name} deleted`)
    return 'deleted'
  }

  const entries = `${movements} history ${movements === 1 ? 'entry' : 'entries'}`
  const ok = await confirmDialog({
    title: `Delete ${item.name} and its history?`,
    message:
      `${item.name} has ${entries} — every take, add and move ever recorded against it.\n\n` +
      'Deleting removes the item AND all of that, permanently. There is no undo.\n\n' +
      'If you only want it out of the way, archive it instead: it leaves every list but keeps the record.',
    confirmLabel: 'Delete permanently',
    danger: true,
  })
  if (!ok) return 'cancelled'

  const { error } = await purgeItem(item.id)
  if (error) { toast.error(error); return 'failed' }
  toast.success(`${item.name} deleted, along with ${entries}`)
  return 'deleted'
}

/** The gentler option, offered alongside delete everywhere delete appears. */
export async function archiveItemWithPrompt(
  item: Pick<InventoryItem, 'id' | 'name' | 'is_active'>,
): Promise<RemoveOutcome> {
  if (item.is_active) {
    const ok = await confirmDialog({
      title: `Archive ${item.name}?`,
      message: 'It disappears from the stock and equipment lists, but its history and counts stay exactly as they are. You can bring it back any time from Manage.',
      confirmLabel: 'Archive',
    })
    if (!ok) return 'cancelled'
  }

  const { error } = await updateItem(item.id, { is_active: !item.is_active })
  if (error) { toast.error(error); return 'failed' }
  toast.success(item.is_active ? `${item.name} archived` : `${item.name} restored`)
  return 'archived'
}
