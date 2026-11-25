/**
 * Phones save photos as HEIC, which a computer's browser cannot show (TE-67, 24 Nov: the Travel Desk saw a broken bill).
 * Any HEIC/HEIF picked is turned into a JPG before it is read or uploaded; everything else passes through.
 */
export async function toJpegIfHeic(f: File): Promise<File> {
  const heic = /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
  if (!heic) return f
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.85 })
  const blob = Array.isArray(out) ? out[0] : out
  return new File([blob], f.name.replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: f.lastModified })
}
