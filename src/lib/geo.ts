/** Where the phone is, what that place is called, and how far it is by road from one point to the next. */

export interface Point { lat: number; lng: number }

/** A reading from the phone: the point, and how many metres it may be out by. */
export interface Fix extends Point { accuracy: number }

/** Asked for afresh each time: a place remembered from ten minutes ago is not where a press was made. */
export function whereAmI(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This phone or browser does not give its location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(
        e.code === e.PERMISSION_DENIED
          ? 'Location is switched off for this page. Allow location in the browser, then try again.'
          : 'Your location could not be read. Step outside or wait a moment, then try again.',
      )),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  })
}

/** Straight-line kilometres (haversine) — the floor under any road distance. */
export function lineKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/**
 * Road kilometres along a run of points — a leg's start, each stop reached
 * on it, its end — from OpenStreetMap's routing (OSRM's public server: free,
 * no key). Through the stops, not past them: home to a hospital and home
 * again begins and ends at the same place, and is twice the way there.
 *
 * Null when it cannot be reached — the database then pays on the straight
 * line and marks the leg so the manager sees which it was. The database
 * also refuses a figure far off the straight line through the same points,
 * so this number is a claim, not the last word.
 */
export async function roadKm(points: Point[]): Promise<number | null> {
  if (points.length < 2) return null
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 12_000)
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${points.map(p => `${p.lng},${p.lat}`).join(';')}?overview=false`,
      { signal: ctl.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return null
    const body = await res.json() as { code?: string; routes?: Array<{ distance: number }> }
    const metres = body.code === 'Ok' ? body.routes?.[0]?.distance : undefined
    return typeof metres === 'number' ? Math.round(metres / 10) / 100 : null
  } catch {
    return null
  }
}

/**
 * What a point is called — the building or road, the locality, the town —
 * from OpenStreetMap's place search (Nominatim's public server: free, no
 * key), so a starting place is marked with a press and never typed. Null
 * when it cannot be reached or knows nothing there: the point is what is
 * recorded, and the name only says it in words for whoever reads the claim.
 */
export async function placeName(p: Point): Promise<string | null> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8_000)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${p.lat}&lon=${p.lng}`,
      { signal: ctl.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return null
    const body = await res.json() as { name?: string; display_name?: string; address?: Record<string, string> }
    const a = body.address ?? {}
    const parts = [
      body.name || a.amenity || a.building || a.road,
      a.neighbourhood || a.suburb || a.village || a.hamlet,
      a.city || a.town || a.municipality || a.county,
      a.state,
    ].map(x => (x ?? '').trim()).filter(Boolean)
    // A village named after its road, a town after its district: said once.
    const said = parts.filter((x, i) => parts.indexOf(x) === i)
    const name = said.length ? said.join(', ') : (body.display_name ?? '').trim()
    return name ? name.slice(0, 200) : null
  } catch {
    return null
  }
}

/** The road through a run of points, drawn on the map of the service that measured it. */
export const routeLink = (points: Point[]) =>
  `https://map.project-osrm.org/?${points.map(p => `loc=${p.lat},${p.lng}`).join('&')}&hl=en&alt=0&srv=0`

/** A point on OpenStreetMap, for the manager to see where a press was made. */
export const mapLink = (p: Point) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`
