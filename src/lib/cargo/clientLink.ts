// The one place that decides what a voyage's client fields become when Setup saves.
//
// Setup (VoyageSetupForm) has TWO client inputs: a dropdown when the client pick
// list loaded, and a free-text box when it did not. The second is not an edge
// case — it is the normal dockside one, where a voyage is opened with no signal
// and loadPickLists() has no cached list to fall back on.
//
// The trap: text mode cannot REPRESENT a link, only a name, so a save made in it
// must never be read as "this voyage has no client". d3966e6 found that and
// stopped it wiping the stored NAME — but left the id wiping. That is how a
// voyage picked from the dropdown online loses its clients FK after a single
// offline Setup edit: name intact, link gone, and the jobs register shows "—"
// with no client colour on the row.
//
// Both call sites in the form ran their own copy of this and had already drifted
// (only one of them carried the name guard), which is why it lives here.

export interface VoyageClientFields {
  clientId?: string | null
  clientName?: string
}

export interface ResolvedClientLink {
  clientId: string | null
  clientName: string | undefined
}

export function resolveClientLink({ options, clientId, clientName, stored }: {
  /** The clients Setup was able to offer. EMPTY means the form was in text mode. */
  options: { id: string; name: string }[]
  /** The dropdown's selection (ignored in text mode). */
  clientId: string
  /** The text box's contents (ignored in dropdown mode). */
  clientName: string
  /** The voyage as already stored — null when creating one. */
  stored?: VoyageClientFields | null
}): ResolvedClientLink {
  const storedId = stored?.clientId ?? null
  const storedName = stored?.clientName

  // Dropdown mode: the selection is the answer. The stored name stays as the
  // fallback because a voyage created offline in text mode opens here carrying a
  // name the dropdown cannot show — dropping it would lose the only record of who
  // the client is.
  if (options.length > 0) {
    const picked = clientId ? options.find(c => c.id === clientId) : undefined
    return { clientId: clientId || null, clientName: picked?.name || storedName || undefined }
  }

  // Text mode: keep the stored LINK for as long as the name still describes it.
  // Typing a different client means the old link no longer points at this client,
  // so it goes; leaving the name untouched says nothing about the link changed.
  const typed = clientName.trim()
  const sameName = typed === (storedName ?? '').trim()
  return { clientId: sameName ? storedId : null, clientName: typed || storedName || undefined }
}
