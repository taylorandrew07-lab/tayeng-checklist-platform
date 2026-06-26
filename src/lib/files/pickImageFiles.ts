// Open the device's FILE / DOCUMENT picker (not the photo gallery) so a plugged-in
// USB / OTG drive — where a borescope camera saves its photos — is reachable when
// adding photos. Setting NO `accept` is the trick: Android then opens the Storage
// Access Framework picker (the USB drive shows under the ☰ menu) instead of the
// gallery photo-picker that hides external drives; iOS shows "Choose File" → Files,
// which includes connected drives. Must be called from a user gesture (a click).
//
// Only image files are returned; anything else is reported separately so the caller
// can tell the user it was skipped.
export function pickImageFiles(onFiles: (images: File[], rejected: string[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
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
    onFiles(images, rejected)
  }
  input.click()
}
