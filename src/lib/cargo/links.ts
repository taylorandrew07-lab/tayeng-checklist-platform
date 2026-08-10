// Where a cargo voyage lives, per role.
//
// These four paths were spelled out by hand in CargoOperationsView,
// JobCargoVoyages, the vessel record, the report register and the office/client
// lists. The admin one is the trap: /admin/cargo/{id} is THIS BROWSER's local
// copy from IndexedDB, while /admin/cargo/cloud/{id} is the synced copy every
// other device can see. An admin following a link to a voyage a surveyor
// created gets "not found" from the first and the actual voyage from the second.

export type VoyageRole = 'admin' | 'office' | 'client' | 'surveyor'

/**
 * The URL for a SYNCED voyage, for the given role.
 *
 * admin    → the cloud copy, because an admin is almost never the device owner
 * office   → its read-only cloud view
 * client   → the client portal view (gated by CLIENT_PORTAL_ENABLED)
 * surveyor → their own device workspace, which is the editable one
 */
export function voyageHref(role: VoyageRole, voyageId: string): string {
  const id = encodeURIComponent(voyageId)
  switch (role) {
    case 'admin': return `/admin/cargo/cloud/${id}`
    case 'office': return `/office/cargo/${id}`
    case 'client': return `/client/cargo/${id}`
    case 'surveyor': return `/surveyor/cargo/${id}`
  }
}

/** The role whose voyage links a page should render, from its own path. */
export function voyageRoleFromPath(pathname: string): VoyageRole {
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/office')) return 'office'
  if (pathname.startsWith('/client')) return 'client'
  return 'surveyor'
}
