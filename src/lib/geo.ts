/** Where the phone is, and how far it is by road from one point to the next. */

export interface Point { lat: number; lng: number }

/** Asked for afresh each time: a place remembered from ten minutes ago is not where a press was made. */
export function whereAmI(): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This phone or browser does not give its location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
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
 * Road kilometres between two points, from OpenStreetMap's routing (OSRM's
 * public server: free, no key). Null when it cannot be reached — the
 * database then pays on the straight line and marks the leg so the manager
 * sees which it was. The database also refuses a figure far off the
 * straight line, so this number is a claim, not the last word.
 */
export async function roadKm(a: Point, b: Point): Promise<number | null> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 12_000)
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`,
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

/** A point on OpenStreetMap, for the manager to see where a press was made. */
export const mapLink = (p: Point) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`
