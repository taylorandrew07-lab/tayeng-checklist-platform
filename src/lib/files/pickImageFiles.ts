// Open the device's FILE / DOCUMENT picker (not the photo gallery) so a plugged-in
// USB / OTG drive — where a borescope camera saves its photos — is reachable when
// adding photos. Setting NO `accept` is the trick: Android then opens the Storage
// Access Framework picker (the USB drive shows under the ☰ menu) instead of the
// gallery photo-picker that hides external drives; iOS shows "Choose File" → Files,
// which includes connected drives. Must be called from a user gesture (a click).
//
// IMPORTANT: the input must be ATTACHED to the DOM before .click(). Some mobile
// browsers only open the full document browser for an in-DOM input and otherwise
// fall back to a "Camera / Camcorder / Photos" media chooser. We attach it hidden,
// then remove it once a file is chosen or the picker is dismissed.
//
// Only image files are returned; anything else is reported separately so the caller
// can tell the user it was skipped.
export function pickImageFiles(onFiles: (images: File[], rejected: string[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  input.style.opacity = '0'
  document.body.appendChild(input)

  let done = false
  const cleanup = () => { if (!done) { done = true; input.remove() } }

  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : []
    const images: File[] = []
    const rejected: string[] = []
    for (const f of files) {
      // Some files off a USB drive arrive with an empty MIME type, so also accept by
      // common image extension.
      if (f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name)) images.push(f)
      else rejected.push(f.name)
    }
    cleanup()
    onFiles(images, rejected)
  }

  // If the picker is cancelled there's no change event — clean up when focus returns.
  window.addEventListener('focus', () => setTimeout(cleanup, 500), { once: true })
  input.click()
}
