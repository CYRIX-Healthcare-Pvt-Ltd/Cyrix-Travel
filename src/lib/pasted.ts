import { supabase } from '@/lib/supabase'

/*
  A spot pasted into the place search instead of a name (te_0071; the user, 26 Oct: a place our map does not have,
  such as our own office, found on Google Maps): its coordinates ("9.9474, 76.3332", or 9°56'50.7"N 76°19'59.7"E),
  a Google Maps link carrying them, or a short share link (maps.app.goo.gl), which the place-link function opens.
  The same file in Travel (src/lib) and in KPI for SW Admin's Edit place map (src/lib); change both.
*/
export type Pasted =
  | { at: { lat: number; lng: number }; name?: string }
  | { short: string }
  | { bad: string }
  | null

const NO_SPOT = 'That link has no spot in it. In Google Maps, press and hold the place, then copy the numbers shown.'
const IN_INDIA = (lat: number, lng: number) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98
const ok = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

// Longitude first by mistake, when only the other way round lands in India.
const spot = (a: number, b: number) => (!IN_INDIA(a, b) && IN_INDIA(b, a) ? { lat: b, lng: a } : { lat: a, lng: b })

function dms(s: string): { lat: number; lng: number } | null {
  const m = s.match(/(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.]+)\s*(?:"|″|'')?\s*([NS])[\s,]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.]+)\s*(?:"|″|'')?\s*([EW])/i)
  if (!m) return null
  const lat = (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/s/i.test(m[4]) ? -1 : 1)
  const lng = (+m[5] + +m[6] / 60 + +m[7] / 3600) * (/w/i.test(m[8]) ? -1 : 1)
  return ok(lat, lng) ? { lat, lng } : null
}

/** The spot in a Google Maps address, and the place's name when it has one. */
export function fromMapsUrl(raw: string): { at: { lat: number; lng: number }; name?: string } | null {
  let u: string
  try { u = decodeURIComponent(raw) } catch { u = raw }
  const num = '(-?\\d{1,3}\\.\\d+)'
  /*
    The place's own pin before the view's centre (@…), which can sit beside it: a directions link (the user, 26 Oct:
    /maps/dir//Cyrix+Health+Care…/@9.9425,76.3290…!1d76.3332683!2d9.9473751) has the screen 600 m off and the
    place as !1d<lng>!2d<lat>, the last of them being where it goes.
  */
  const last = [...u.matchAll(new RegExp(`!1d${num}!2d${num}`, 'g'))].pop()
  const tries: Array<RegExpMatchArray | null> = [
    u.match(new RegExp(`!3d${num}!4d${num}`)),
    last ? Object.assign([last[0], last[2], last[1]], { index: last.index }) as RegExpMatchArray : null,
    u.match(new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?${num},\\s*\\+?${num}`)),
    u.match(new RegExp(`/(?:search|place|dir/[^/]*)/${num},\\s*\\+?${num}`)),
    u.match(new RegExp(`@${num},${num}`)),
  ]
  for (const m of tries) {
    if (!m) continue
    const at = spot(+m[1], +m[2])
    if (!ok(at.lat, at.lng)) continue
    return { at, name: placeName(raw) }
  }
  return null
}

// The place's name in the link, read before decoding (its address may hold a "/", as 30%2F641B), to the first comma.
function placeName(raw: string): string | undefined {
  const seg = raw.match(/\/maps\/place\/([^/@?]+)/)?.[1] ?? raw.match(/\/maps\/dir\/[^/@?]*\/([^/@?]+)/)?.[1]
  if (!seg) return undefined
  let n: string
  try { n = decodeURIComponent(seg.replace(/\+/g, ' ')) } catch { n = seg.replace(/\+/g, ' ') }
  n = n.split(',')[0].trim()
  return n && !/^-?\d/.test(n) ? n : undefined
}

export function readPasted(text: string): Pasted {
  const s = text.trim()
  if (!s) return null
  // "9.9474, 76.3332" or "9.9474 76.3332", with or without brackets.
  const m = s.match(/^\(?\s*(-?\d{1,3}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*\)?$/)
  if (m) { const at = spot(+m[1], +m[2]); return ok(at.lat, at.lng) ? { at } : { bad: 'Those numbers are not a place on the map' } }
  const d = dms(s)
  if (d) return { at: d }
  if (!/^(https?:\/\/)?([\w-]+\.)*(google\.[a-z.]+|goo\.gl)\//i.test(s)) return null
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(url)) return { short: url }
  return fromMapsUrl(url) ?? { bad: NO_SPOT }
}

/** A pasted spot, with a short share link opened by the place-link function: where it is, or why it is not one. */
export async function spotFrom(p: Exclude<Pasted, null>): Promise<{ at: { lat: number; lng: number }; name?: string } | { bad: string }> {
  if (!('short' in p)) return p
  const { data, error } = await supabase.functions.invoke('place-link', { body: { url: p.short } })
  if (error || !data?.url) {
    const said = error && 'context' in error ? await (error.context as Response).json().then(j => (j as { error?: string }).error).catch(() => undefined) : undefined
    return { bad: said ?? 'That link could not be opened. Copy the numbers from Google Maps instead.' }
  }
  return fromMapsUrl(String(data.url)) ?? { bad: NO_SPOT }
}

/*
  A place searched by name on an admin's Edit place map (the user, 26 Oct: "sw admin also need to search with location
  link etc in edit places"): Photon, nearest the pin first, in India only. Its name, and where it is for the list.
*/
export async function findOnMap(q: string, near: { lat: number; lng: number }): Promise<Array<{ name: string; where: string; lat: number; lng: number }>> {
  const ctl = new AbortController(), t = window.setTimeout(() => ctl.abort(), 5000)
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q.trim())}&lat=${near.lat}&lon=${near.lng}&limit=10&lang=en`, { signal: ctl.signal })
    const j = await r.json() as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
    return (j.features ?? []).filter(f => f.properties.name && (f.properties.countrycode ?? '').toUpperCase() === 'IN').map(f => {
      const p = f.properties
      const where = [p.street && p.street !== p.name ? p.street : null, p.city ?? p.district ?? p.county, p.state].filter(Boolean).join(', ')
      return { name: p.name, where, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
    }).slice(0, 8)
  } catch { return [] } finally { window.clearTimeout(t) }
}
