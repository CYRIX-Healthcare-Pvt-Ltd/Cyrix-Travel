/*
  A Google Maps screenshot for a ride claimed well over the map (te_0140; the user, 9 Nov: "if they enter km more than
  10%, can we ask them to post this?", "when we click check map, so it will open a pop up tab, so on that tab, we need
  scrnshot, so that will save to our app and checks the location km").

  The ride's map opens Google Maps with the ride's From and To; the screenshot taken there is added back on the map,
  read on the phone for its km, and kept with the claim's bills in its own table, so it never counts as a bill.
*/
import { supabase, friendlyError } from './supabase'
import { newId, sha256 } from './claims'

/** For the test accounts only until it is tried out (the user, 9 Nov: "ok show only for test accounts now"). */
const TRY = new Set(['E6666', 'E7777', 'E8888', 'E9999'])
export const routeShotsOn = (ecode: string | null | undefined) => !!ecode && TRY.has(ecode)

export interface RouteShot { id: string; ride_id: string; path: string; km: number | null; kms: number[]; created_at: string }

/** Over this much above the map, a bike or car ride needs its screenshot. */
export const shotPct = (policy: Record<string, unknown> | undefined) => Number(policy?.route_shot_pct ?? 10)

export const needsShot = (r: { mode: string; claimed_km: number | null; map_km: number | null }, pct: number) =>
  (r.mode === 'bike' || r.mode === 'car') && r.map_km != null && r.map_km > 0 && r.claimed_km != null && r.claimed_km > r.map_km * (1 + pct / 100) + 1e-9

/** How far over the map the km typed is, in whole percent. */
export const overPct = (r: { claimed_km: number | null; map_km: number | null }) =>
  r.map_km && r.claimed_km != null ? Math.round(((r.claimed_km - r.map_km) / r.map_km) * 100) : 0

/*
  Google Maps with the ride's From and To filled in: free, no key; the app on a phone, the site on a computer. A named
  place goes by its name, so Google finds its door and says its name (the user, 9 Nov: "to is wrong" — the airport's
  point, the middle of its grounds, came up as the hotel beside it); home, the day's start or a photo's place, which
  Google has no name for, by the point itself.
*/
const UNNAMED = /^(home|work|office|start of day|starts? here|photo place|visit photo|my location|current location)\b/i
const COORDS = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/
const end = (name: string | null | undefined, lat: number | null, lng: number | null) => {
  const n = name?.trim() ?? ''
  return n.length > 2 && !UNNAMED.test(n) && !COORDS.test(n) ? encodeURIComponent(n) : `${lat},${lng}`
}
export const googleRoute = (r: { from_name?: string | null; from_lat: number | null; from_lng: number | null; to_name?: string | null; to_lat: number | null; to_lng: number | null }) =>
  `https://www.google.com/maps/dir/?api=1&origin=${end(r.from_name, r.from_lat, r.from_lng)}&destination=${end(r.to_name, r.to_lat, r.to_lng)}&travelmode=driving`

/** Every km figure on the screenshot: "65 km", "(65 km)", "58.4 km", "54,0km". */
export function kmFigures(text: string): number[] {
  const t = text.replace(/[Oo](?=\d)/g, '0')
  const out = [...t.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:km|kms|kilometres|kilometers)\b/gi)]
    .map(m => Number(m[1].replace(',', '.'))).filter(n => n > 0 && n < 3000)
  return [...new Set(out)]
}

/** The route's km: of the figures read, the one nearest the km claimed. */
export const shotKm = (kms: number[], claimed: number | null) =>
  !kms.length ? null : claimed == null ? Math.max(...kms) : kms.reduce((a, b) => (Math.abs(b - claimed) < Math.abs(a - claimed) ? b : a))

/** The km claimed is borne out by the screenshot: no more than its km, give half a km for the rounding. */
export const shotBacks = (shotKmRead: number | null, claimed: number | null) =>
  shotKmRead != null && claimed != null && claimed <= shotKmRead + 0.5

async function readKms(file: Blob): Promise<number[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try { return kmFigures((await worker.recognize(file)).data.text) } finally { void worker.terminate() }
}

/** Into the claim's folder of bills, read, then recorded; one a ride, a new one taking the old one's place. */
export async function addRouteShot(claimId: string, rideId: string, file: File, claimed: number | null) {
  const hash = await sha256(file)
  const kms = await readKms(file).catch(() => [] as number[])
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${claimId}/route-${newId()}.${ext}`
  const { error: up } = await supabase.storage.from('te-bills').upload(path, file, { contentType: file.type || 'image/jpeg' })
  if (up) throw new Error(friendlyError(up))
  const { data: old, error } = await supabase.rpc('te_route_shot_add', { p_claim: claimId, p_ride: rideId, p_path: path, p_sha256: hash, p_kms: kms, p_km: shotKm(kms, claimed) })
  if (error) { await supabase.storage.from('te-bills').remove([path]); throw new Error(friendlyError(error)) }
  if (old) await supabase.storage.from('te-bills').remove([old as string])
}

export async function removeRouteShot(id: string) {
  const { data: path, error } = await supabase.rpc('te_route_shot_remove', { p_id: id })
  if (error) throw new Error(friendlyError(error))
  if (path) await supabase.storage.from('te-bills').remove([path as string])
}

export async function openRouteShot(path: string) {
  const w = window.open('', '_blank')
  const { data } = await supabase.storage.from('te-bills').createSignedUrl(path, 600)
  if (data?.signedUrl && w) w.location.href = data.signedUrl
  else w?.close()
}
