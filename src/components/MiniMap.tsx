import { useState } from 'react'
import clsx from 'clsx'
import { MapPin } from 'lucide-react'
import type { Point } from '@/lib/geo'

/**
 * A small map of one point: where the phone says it is, with a ring as wide
 * as the phone's own doubt.
 *
 * It is here so that a place is looked at before it is recorded (the user,
 * 2 Oct: "should we show the location on map in small container? so that
 * the location wont mismatch bcz if network is poor the location will be
 * inaccurate"). A reading taken indoors or on a weak signal can be hundreds
 * of metres out, and a number saying so means little; a pin on the wrong
 * side of the road is seen at once.
 *
 * Drawn from OpenStreetMap's own map tiles — nine pictures around the point,
 * shifted so the point sits in the middle — with no map library: nothing is
 * dragged or zoomed here, it is a picture to look at. The zoom is chosen so
 * the ring fits; the ring is the reading's accuracy, to scale.
 */
const TILE = 256

/** Where a point falls on the world's grid of tiles at a zoom, in tiles and fractions of one. */
function tileOf(p: Point, z: number) {
  const n = 2 ** z, rad = (p.lat * Math.PI) / 180
  return { x: ((p.lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n }
}

/** Metres to a pixel at a zoom, at this latitude. */
const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z

/** Close in for a sure reading; further out when the ring would not fit otherwise. */
function zoomFor(lat: number, accuracy: number | null | undefined) {
  if (!accuracy || !Number.isFinite(accuracy)) return 16
  for (let z = 17; z >= 12; z--) if (accuracy / metresPerPixel(lat, z) <= 62) return Math.min(z, 16)
  return 12
}

export default function MiniMap({ at, accuracy, className }: { at: Point; accuracy?: number | null; className?: string }) {
  const [failed, setFailed] = useState(false)
  const z = zoomFor(at.lat, accuracy)
  const { x, y } = tileOf(at, z)
  const tx = Math.floor(x), ty = Math.floor(y)
  // The point's place inside the middle tile, and so how far the nine are shifted to put it at the centre.
  const ox = (x - tx) * TILE, oy = (y - ty) * TILE
  const ring = accuracy && Number.isFinite(accuracy) ? Math.max(7, accuracy / metresPerPixel(at.lat, z)) : 0

  return (
    <div className={clsx('relative h-40 overflow-hidden rounded-lg border border-ink-200 bg-ink-100', className)} role="img" aria-label="Map of where you are">
      {!failed && (
        <div aria-hidden className="absolute left-1/2 top-1/2" style={{ width: TILE * 3, height: TILE * 3, transform: `translate(${-(TILE + ox)}px, ${-(TILE + oy)}px)` }}>
          {[-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => (
            <img key={`${dx},${dy}`} alt="" draggable={false} onError={() => setFailed(true)}
              src={`https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png`}
              className="absolute max-w-none select-none" style={{ left: (dx + 1) * TILE, top: (dy + 1) * TILE, width: TILE, height: TILE }} />
          )))}
        </div>
      )}
      {failed && <p className="absolute inset-x-0 top-3 px-3 text-center text-xs text-ink-500">The map could not be loaded. The pin below is still where your phone says you are.</p>}
      {ring > 0 && (
        <span aria-hidden className="absolute left-1/2 top-1/2 rounded-full border border-blue-600/60 bg-blue-500/15"
          style={{ width: ring * 2, height: ring * 2, marginLeft: -ring, marginTop: -ring }} />
      )}
      {/* The pin stands on the point: its tip, not its middle, is where the phone says. */}
      <MapPin aria-hidden className="absolute left-1/2 top-1/2 -ml-3.5 -mt-7 h-7 w-7 fill-cyrixRed-600 text-white drop-shadow" strokeWidth={1.5} />
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
        className="absolute bottom-0 right-0 rounded-tl bg-white/80 px-1 text-[10px] leading-4 text-ink-700">© OpenStreetMap</a>
    </div>
  )
}
