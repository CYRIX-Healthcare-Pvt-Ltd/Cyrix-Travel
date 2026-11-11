/*
  A Google Maps screenshot for a ride claimed well over the map (te_0140; the user, 9 Nov: "if they enter km more than
  10%, can we ask them to post this?", "when we click check map, so it will open a pop up tab, so on that tab, we need
  scrnshot, so that will save to our app and checks the location km").

  The ride's map opens Google Maps with the ride's From and To; the screenshot taken there is added back on the map,
  read on the phone for its km, and kept with the claim's bills in its own table, so it never counts as a bill.
*/
import { supabase, friendlyError } from './supabase'
import { newId, sha256 } from './claims'

/** For everybody since the test accounts tried it out (the user, 9 Nov: "roll out g map screenshot to all users"). */
export const routeShotsOn = (_ecode?: string | null) => true
/** Asked for on rides from 10 Nov; a day before it goes as it did (the user, 9 Nov: "from 2mrws claim only needed"). */
export const SHOT_FROM = '2026-11-10'
const TEST = new Set(['E6666', 'E7777', 'E8888', 'E9999'])
export const isTestLogin = (ecode?: string | null) => !!ecode && TEST.has(ecode.toUpperCase())
/** The test accounts any day (the user, 9 Nov: "for test accounts there is not date or starting"). */
export const shotDay = (day: string | null | undefined, ecode?: string | null) => (!!ecode && TEST.has(ecode.toUpperCase())) || (!!day && day >= SHOT_FROM)

/** What the phone found of the ride's points on the screenshot (te_0141). */
export type Places = 'match' | 'partial' | 'edited' | 'unread'
export interface RouteShot {
  id: string; ride_id: string; path: string; km: number | null; kms: number[]; created_at: string
  places?: Places; from_lat?: number | null; from_lng?: number | null; to_lat?: number | null; to_lng?: number | null
}
type Pts = { from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null }
const near = (a: number | null | undefined, b: number | null | undefined, d = 0.0006) => a != null && b != null && Math.abs(a - b) <= d
/** The screenshot was taken for the ride as it is: its From and To have not moved since (te_0141). */
export const shotFits = (shot: RouteShot | undefined, r: Pts) => !!shot && (shot.from_lat == null ||
  (near(shot.from_lat, r.from_lat) && near(shot.from_lng, r.from_lng) && near(shot.to_lat, r.to_lat) && near(shot.to_lng, r.to_lng)))
/*
  The screenshot is the ride's: its points have not moved since, and none it shows is another place. Both points as
  numbers, match. None as numbers, unread: the From and To were changed to names such as "Your location" and
  "Home" (E481, 10 Nov), so it is refused too — it was let through for Google Maps on a computer, which writes
  addresses, and nobody uses a computer for it (the user, 10 Nov: "from computer no one will use it"). One as numbers and the other a name means a place was searched
  (a To shown as "Grand Mall", 2 km from the ride's: "it is wrong location"), so partial is refused like edited.
*/
export const shotOk = (shot: RouteShot | undefined, r: Pts) => shotFits(shot, r) && shot!.places === 'match'
/** The km the ride takes from its screenshot, while it is the ride's and its km could be read. */
export const shotSetsKm = (shot: RouteShot | undefined, r: Pts) => shotOk(shot, r) && shot!.km != null ? Number(shot!.km) : null

/** The band from Settings (te_0143): every started `every` km of map allows `extra` km more without a screenshot. */
export type Band = { every: number; extra: number }
export const shotBand = (policy: Record<string, unknown> | undefined): Band =>
  ({ every: Number(policy?.km_band_km ?? 10) || 10, extra: Number(policy?.km_band_extra_km ?? 1) })

/*
  The km a ride may claim without a screenshot: the map's km and 1 km for every started 10 km of it — up to 9.9 km
  of map 1 km more, 10 to 19.9 km 2 km, 20 to 29.9 km 3 km (the user, 9 Nov: "0-9 km max 1 km, 10-19 2 km, 20-29 3
  km, 30-39 4 km"). Always by the map's km, which the person cannot change, so a map of 9.9 km allows 10.9 km and
  typing 10.9 does not reach the next band (the user, 9 Nov: "that doesnt allow user to add 2 again isnt?").
*/
export const kmAllowed = (mapKm: number, b: Band = { every: 10, extra: 1 }) =>
  Math.round((mapKm + (Math.floor(mapKm / b.every + 1e-9) + 1) * b.extra) * 10) / 10

export const needsShot = (r: { mode: string; claimed_km: number | null; map_km: number | null }, b?: Band) =>
  (r.mode === 'bike' || r.mode === 'car') && r.map_km != null && r.map_km > 0 && r.claimed_km != null && r.claimed_km > kmAllowed(Number(r.map_km), b) + 1e-9

/** How far over the map the km typed is, in whole percent. */
export const overPct = (r: { claimed_km: number | null; map_km: number | null }) =>
  r.map_km && r.claimed_km != null ? Math.round(((r.claimed_km - r.map_km) / r.map_km) * 100) : 0

/*
  Google Maps with the ride's From and To filled in: free, no key; the website, never the app (below). Always
  the ride's own points, never its names (the user, 9 Nov: a To named "Salem - Kochi - Kanyakumari Hwy…" was searched
  by Google as another place, "on our map it is correct … we already have location"), so Google measures the same
  road ends as our map.
*/
export const googleRoute = (r: { from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null }, _ecode?: string | null) =>
  // The points in the link's path, opened in the browser for everybody (the user, 11 Nov: "ya browser only"): the
  // Maps app turns each point into the nearest business's name (Jestin Jose: "DOXA Child Development Cli…"), the
  // website keeps them as numbers, so the screenshot can be matched.
  inBrowser(`https://www.google.com/maps/dir/${r.from_lat},${r.from_lng}/${r.to_lat},${r.to_lng}/data=!4m2!4m1!3e0`)

/*
  Through Travel's own gmaps.html, which loads the Google Maps website a moment later without a press (the user, 11 Nov:
  "still opening in map app for android"): Android's Chrome hands a google.com/maps link opened by a press to the Maps
  app, even when sent to Chrome by name, and the app turns the ride's points into the nearest business's name. Loaded
  without a press it stays in the browser, where the points stay as numbers and the screenshot can be matched.
*/
const inBrowser = (url: string) => `${import.meta.env.BASE_URL}gmaps.html#${encodeURIComponent(url)}`

/** Every km figure on the screenshot: "65 km", "(65 km)", "58.4 km", "54,0km". */
export function kmFigures(text: string): number[] {
  // Not the map's scale bar, which Google writes on the line of "Map data ©2026 … Terms Privacy 2 km".
  const t = text.replace(/[Oo](?=\d)/g, '0').split('\n').filter(l => !/map data|©|terms|privacy/i.test(l)).join('\n')
  const out = [...t.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:km|kms|kilometres|kilometers)\b/gi)]
    .map(m => Number(m[1].replace(',', '.'))).filter(n => n > 0 && n < 3000)
  return [...new Set(out)]
}

/** The route's km: Google's own "(9.6 km)" beside its time first, else of the figures read the one nearest the km claimed. */
export function shotKm(text: string, kms: number[], claimed: number | null) {
  const own = [...text.replace(/[Oo](?=\d)/g, '0').matchAll(/\(\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*km\s*\)/gi)].map(m => Number(m[1].replace(',', '.'))).filter(n => n > 0)
  if (own.length) return own[0]
  return !kms.length ? null : claimed == null ? Math.max(...kms) : kms.reduce((a, b) => (Math.abs(b - claimed) < Math.abs(a - claimed) ? b : a))
}

/**
  The ride's points as Google shows them: Google Maps writes a point it was given as "9.9475136, 76.3333099". Both
  found, match; one found and the other shown by a name, partial; a point that is neither, edited (the user, 9 Nov:
  "on scnshot we should check the from n to is edited or not"); none read, unread.
*/
export function placesOn(text: string, r: Pts): Places {
  const pts = [...text.replace(/[Oo](?=\d)/g, '0').matchAll(/(-?\d{1,2}\.\d{3,})\s*[,，]\s*(-?\d{1,3}\.\d{3,})/g)].map(m => [Number(m[1]), Number(m[2])] as const)
  if (!pts.length) return 'unread'
  const isFrom = (p: readonly [number, number]) => near(p[0], r.from_lat, 0.002) && near(p[1], r.from_lng, 0.002)
  const isTo = (p: readonly [number, number]) => near(p[0], r.to_lat, 0.002) && near(p[1], r.to_lng, 0.002)
  // Both of the ride's points found is enough: Google writes each again as a label on the map, where a digit read
  // wrong would otherwise look like another place (the user, 9 Nov: a right one refused on the phone, kept on a computer).
  if (pts.some(isFrom) && pts.some(isTo)) return 'match'
  return pts.some(p => !isFrom(p) && !isTo(p)) ? 'edited' : 'partial'
}

/** The km claimed is borne out by the screenshot: no more than its km, give half a km for the rounding. */
export const shotBacks = (shotKmRead: number | null, claimed: number | null) =>
  shotKmRead != null && claimed != null && claimed <= shotKmRead + 0.5

async function readText(file: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try { return (await worker.recognize(file)).data.text } finally { void worker.terminate() }
}

/** Into the claim's folder of bills, read, then recorded; one a ride, a new one taking the old one's place. */
export async function addRouteShot(claimId: string, ride: Pts & { id: string }, file: File, claimed: number | null): Promise<number | null> {
  const hash = await sha256(file)
  const text = await readText(file).catch(() => '')
  const kms = kmFigures(text), km = shotKm(text, kms, claimed), places = placesOn(text, ride)
  if (places === 'unread') throw new Error("From and To on this screenshot are not the ride's. Press Google Maps under the ride and don't change From or To.")
  if (places === 'partial' || places === 'edited') throw new Error("From or To on this screenshot is not the ride's")
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${claimId}/route-${newId()}.${ext}`
  const { error: up } = await supabase.storage.from('te-bills').upload(path, file, { contentType: file.type || 'image/jpeg' })
  if (up) throw new Error(friendlyError(up))
  const { data: old, error } = await supabase.rpc('te_route_shot_add', {
    p_claim: claimId, p_ride: ride.id, p_path: path, p_sha256: hash, p_kms: kms, p_km: km, p_places: places,
    p_from_lat: ride.from_lat, p_from_lng: ride.from_lng, p_to_lat: ride.to_lat, p_to_lng: ride.to_lng,
  })
  if (error) { await supabase.storage.from('te-bills').remove([path]); throw new Error(friendlyError(error)) }
  if (old) await supabase.storage.from('te-bills').remove([old as string])
  return km
}

export async function removeRouteShot(id: string) {
  const { data: path, error } = await supabase.rpc('te_route_shot_remove', { p_id: id })
  if (error) throw new Error(friendlyError(error))
  if (path) await supabase.storage.from('te-bills').remove([path as string])
}

/** The screenshot's address for a while, shown inside the app, never in a tab of its own (the user, 9 Nov). */
export async function routeShotUrl(path: string) {
  const { data } = await supabase.storage.from('te-bills').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
