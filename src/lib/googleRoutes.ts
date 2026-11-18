/*
  Google's road routes (Routes API, Compute Routes Essentials; the user, 18 Nov: "got api from google, so now do only
  changes to test user"). From and To give Google's routes, the first its choice and up to two others, so the engineer
  picks the road actually taken. Car routes, no traffic, nothing else asked: every request stays on the Essentials
  price (two-wheeler routes, traffic or tolls are dearer). Kept for the session, so the same two places ask once.
  Asked only within the month's free requests (te_0163), so it never costs anything.
*/
import { supabase } from './supabase'

export interface RouteAlt { km: number; mins: number; via: string; line: [number, number][]; poly?: string }
/** Google's roads as kept on the ride until the Travel Desk approves (te_0164): the points as Google's own short text. */
export interface KeptRoads { at: string; key: string; roads: Array<{ km: number; mins: number; via: string; poly: string }> }
interface Pt { lat: number; lng: number }

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() || ''
/** Everyone's rides from this day on (the user, 18 Nov: "can we enable to all from 19th date claim?"); test logins any day. */
export const GOOGLE_FROM = '2026-11-19'
export const googleFor = (test: boolean, day: string) => test || day >= GOOGLE_FROM
/** Google is asked only when the key is set and the day is Google's (googleFor). */
let on = false
/** The month's free requests used up: off for the rest of the session, whatever the page sets. */
let spent = false
export const setGoogleRoutes = (yes: boolean) => { on = yes && !!KEY && !spent }
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
const keyOf = (a: Pt, b: Pt) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
/**
  Google's roads already asked in this session, without asking again (the user, 18 Nov: "we need to max reduce the
  clicks"): opening a day or its map again, or an approver's look, costs nothing.
*/
/** Told whenever Google gives a new answer, so what only looks (googleKnown) can look again. */
const heard = new Set<() => void>()
export const onGoogle = (fn: () => void) => { heard.add(fn); return () => { heard.delete(fn) } }
export const roadsKey = keyOf
/** A ride's kept roads put back, so nothing is asked for them again (only for the From and To they were asked for). */
export function googleSeed(a: Pt, b: Pt, kept0: KeptRoads | null | undefined) {
  const key = keyOf(a, b)
  if (!on || !kept0?.roads?.length || kept0.key !== key || kept.has(key)) return
  kept.set(key, Promise.resolve(kept0.roads.map(r => ({ km: r.km, mins: r.mins, via: r.via, poly: r.poly, line: r.poly ? decode(r.poly) : [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][] }))))
}
/** Google's roads to keep on the ride. */
export const keepRoads = (a: Pt, b: Pt, alts: RouteAlt[]): KeptRoads =>
  ({ at: new Date().toISOString(), key: keyOf(a, b), roads: alts.map(x => ({ km: x.km, mins: x.mins, via: x.via, poly: x.poly ?? '' })) })
export const googleKnown = (a: Pt, b: Pt): Promise<RouteAlt[] | null> => (on ? kept.get(keyOf(a, b)) ?? Promise.resolve(null) : Promise.resolve(null))
export function googleRoutes(a: Pt, b: Pt): Promise<RouteAlt[] | null> {
  if (!on) return Promise.resolve(null)
  const key = keyOf(a, b)
  const hit = kept.get(key)
  if (hit) return hit
  const p = ask(a, b)
  kept.set(key, p)
  void p.then(v => { if (!v) kept.delete(key); else heard.forEach(fn => fn()) })
  return p
}

async function ask(a: Pt, b: Pt): Promise<RouteAlt[] | null> {
  // Only while Google is free this month (te_0163): at the limit, our own map, and no more asking this session.
  const { data: free, error } = await supabase.rpc('te_google_take')
  if (error || free !== true) { if (!error) { on = false; spent = true } return null }
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
    const j = await res.json() as { routes?: Array<{ distanceMeters?: number; duration?: string; description?: string; polyline?: { encodedPolyline?: string } }> }
    const alts = (j.routes ?? []).filter(r => typeof r.distanceMeters === 'number').map(r => ({
      km: Math.round((r.distanceMeters! / 1000) * 10) / 10,
      mins: Math.round(parseFloat(String(r.duration ?? '0').replace('s', '')) / 60),
      via: (r.description ?? '').trim(),
      line: r.polyline?.encodedPolyline ? decode(r.polyline.encodedPolyline) : [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][],
      poly: r.polyline?.encodedPolyline ?? '',
    }))
    return alts.length ? alts : null
  } catch { return null } finally { clearTimeout(t) }
}
