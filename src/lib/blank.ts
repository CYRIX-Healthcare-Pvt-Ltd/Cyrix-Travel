/*
  A blank bill photo (plain paper, a wall, a shadow) is refused at upload (the user, 25 Nov; TE-222).
  The photo is shrunk to 240 px and sharp light-to-dark steps are counted: printed or written text has
  thousands, plain paper — even with a soft shadow — almost none. PDFs and unreadable files pass.
*/
export async function looksBlank(f: File): Promise<boolean> {
  if (!f.type.startsWith('image/')) return false
  try {
    const bmp = await createImageBitmap(f)
    const k = 240 / Math.max(bmp.width, bmp.height)
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); if (!g) return false
    g.drawImage(bmp, 0, 0, w, h); bmp.close()
    const d = g.getImageData(0, 0, w, h).data
    const y = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) y[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    let edges = 0
    for (let r = 1; r < h - 1; r++) for (let x = 1; x < w - 1; x++) {
      const i = r * w + x
      if (Math.abs(y[i] - y[i + 1]) > 28 || Math.abs(y[i] - y[i + w]) > 28) edges++
    }
    return edges / (w * h) < 0.002
  } catch { return false }
}
