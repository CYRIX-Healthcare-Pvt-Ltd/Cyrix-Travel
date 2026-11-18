/*
  Google's road routes (Routes API, Compute Routes Essentials; the user, 18 Nov: "got api from google, so now do only
  changes to test user"). From and To give Google's routes, the first its choice and up to two others, so the engineer
  picks the road actually taken. Car routes, no traffic, nothing else asked: every request stays on the Essentials
  price (two-wheeler routes, traffic or tolls are dearer). Kept for the session, so the same two places ask once.
*/
import { supabase } from './supabase'

export interface RouteAlt { km: number; mins: number; via: string; line: [number, number][] }
interface Pt { lat: number; lng: number }

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() || ''
/** Google is asked only when the key is set and the claim is a test login's (on for them alone, for now). */
let on = false
export const setGoogleRoutes = (yes: boolean) => { on = yes && !!KEY }
export const googleRoutesOn = () => on

/** Google's encoded polyline to [lat, lng] points. */
function decode(s: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, res = 0, b: number
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const d = res & 1 ? ~(res >> 1) : res >> 1
      if (which === 0) lat += d; else lng += d
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

const kept = new Map<string, Promise<RouteAlt[] | null>>()
export function googleRoutes(a: Pt, b: Pt): Promise<RouteAlt[] | null> {
  if (!on) return Promise.resolve(null)
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
  const hit = kept.get(key)
  if (hit) return hit
  const p = ask(a, b)
  kept.set(key, p)
  void p.then(v => { if (!v) kept.delete(key) })
  return p
}

async function ask(a: Pt, b: Pt): Promise<RouteAlt[] | null> {
  const stop = new AbortController(), t = setTimeout(() => stop.abort(), 12_000)
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', signal: stop.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.description,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', computeAlternativeRoutes: true,
        languageCode: 'en-IN', units: 'METRIC',
      }),
    })
    if (!res.ok) return null
    // One billed request, counted for SW Admin's Live tab (te_0161).
    void supabase.rpc('te_google_call').then(() => {}, () => {})
    const j = await res.json() as { routes?: Array<{ distanceMeters?: number; duration?: string; description?: string; polyline?: { encodedPolyline?: string } }> }
    const alts = (j.routes ?? []).filter(r => typeof r.distanceMeters === 'number').map(r => ({
      km: Math.round((r.distanceMeters! / 1000) * 10) / 10,
      mins: Math.round(parseFloat(String(r.duration ?? '0').replace('s', '')) / 60),
      via: (r.description ?? '').trim(),
      line: r.polyline?.encodedPolyline ? decode(r.polyline.encodedPolyline) : [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][],
    }))
    return alts.length ? alts : null
  } catch { return null } finally { clearTimeout(t) }
}
