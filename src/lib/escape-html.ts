/** Escape a value for safe interpolation into HTML. Used wherever DB/user-supplied
 *  text is placed into an HTML string (e.g. the invoice email draft) to prevent
 *  markup/script injection. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
