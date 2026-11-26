import { useEffect, useState } from 'react'
import { Route } from 'lucide-react'
import { km, roadsShown } from '@/lib/claims'
import { googleKnown, googleRoutes, googleRoutesOn, googleSeed, onGoogle, keepRoads, type KeptRoads, type RouteAlt } from '@/lib/googleRoutes'

/*
  Google's roads for a ride (test logins, 18 Nov): the "Other routes" button beside View on map and the boxes to pick
  the road taken, on the day's form and inside its map.
*/
type R = { from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null; map_km: number | null; route_km?: number | null; route_alts?: KeptRoads | null }

/** A ride's kept roads (te_0164) put back before anything looks for them. */
export const seedRoads = (r: R) => {
  if (r.from_lat != null && r.to_lat != null) googleSeed({ lat: r.from_lat, lng: r.from_lng! }, { lat: r.to_lat, lng: r.to_lng! }, r.route_alts)
}

/**
  Google's roads between a ride's places. ask false: only what Google already said this session, nothing asked; ask
  true (the boxes opened): Google asked if it has not been (the user, 18 Nov: "we need to max reduce the clicks").
*/
export function useRoads(ride: R, ask: boolean) {
  const [alts, setAlts] = useState<RouteAlt[] | null | undefined>(undefined)
  const at = `${ride.from_lat},${ride.from_lng};${ride.to_lat},${ride.to_lng}`
  useEffect(() => {
    let on = true
    setAlts(undefined)
    const a = { lat: ride.from_lat!, lng: ride.from_lng! }, b = { lat: ride.to_lat!, lng: ride.to_lng! }
    seedRoads(ride)
    const look = () => void (ask ? googleRoutes(a, b) : googleKnown(a, b)).then(x => { if (on) setAlts(x) })
    look()
    // Only looking: looks again when Google answers (the boxes opened elsewhere asked it).
    const off = ask ? () => {} : onGoogle(look)
    return () => { on = false; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, ask])
  return alts
}

/**
  "Other routes" beside View on map. Known roads: shown only when there is more than one. Not known (the day opened
  again later): shown, Google asked only when pressed. It also keeps route_km true to the road the ride has, when known:
  Google's own km when another road is taken, empty otherwise (a new From or To, a km of its own).
*/
export function RoadsButton({ ride, open, onOpen, onRouteKm, onKeep, onlyUnknown = false, hidden = false }: {
  ride: R; open: boolean; onOpen: () => void; onRouteKm?: (km: number | null) => void
  /** Keeps the roads on the ride without the button (everyone but the test logins, for now; the user, 18 Nov). */
  hidden?: boolean
  /** Shown only while the roads are not known (the map, where known roads show open). */
  onlyUnknown?: boolean
  /** Google's roads to keep on the ride, once known for its From and To (te_0164). */
  onKeep?: (kept: KeptRoads) => void
}) {
  const alts = useRoads(ride, false)
  useEffect(() => {
    if (!alts) return
    const a = { lat: ride.from_lat!, lng: ride.from_lng! }, b = { lat: ride.to_lat!, lng: ride.to_lng! }
    if (onKeep) {
      const k = keepRoads(a, b, alts)
      const same = ride.route_alts?.key === k.key && JSON.stringify(ride.route_alts.roads) === JSON.stringify(k.roads)
      if (!same) onKeep(k)
    }
    if (!onRouteKm) return
    const taken = alts.find(x => ride.map_km != null && Math.abs(x.km - ride.map_km) < 0.05)
    const want = taken && taken !== alts[0] ? alts[0].km : null
    if ((ride.route_km ?? null) !== want) onRouteKm(want)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alts, ride.map_km, ride.route_km])
  if (hidden || !googleRoutesOn() || alts === undefined || (alts && (onlyUnknown || (roadsShown(alts).length < 2 && !open)))) return null
  return (
    <button type="button" data-other aria-expanded={open} onClick={onOpen}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
      <Route className="h-3.5 w-3.5" /> Other routes
    </button>
  )
}

/** Google's roads as boxes (one when it has one); the one pressed is the ride's map km, Google's own km kept when it is another. */
export function RoutePick({ ride, onPick, className = 'mt-1.5', ask = true }: {
  ride: R; onPick: (km: number, own: number | null) => void; className?: string
  /** false: only roads already known, nothing asked (the map shows them open; the user, 18 Nov). */
  ask?: boolean
}) {
  const all = useRoads(ride, ask)
  const alts = all ? roadsShown(all) : all
  if (!alts?.length || (!ask && alts.length < 2)) return null
  const taken = alts.find(x => ride.map_km != null && Math.abs(x.km - ride.map_km) < 0.05) ?? null
  return (
    <div className={`grid grid-cols-1 gap-1.5 sm:grid-cols-3 ${className}`}>
      {alts.map((x, i) => {
        const on = x === taken
        return (
          <button key={i} type="button" aria-pressed={on} onClick={() => onPick(x.km, i === 0 ? null : alts[0].km)}
            className={`min-w-0 rounded-lg border px-2.5 py-1.5 text-left text-xs ${on ? 'border-teal-600 bg-teal-50 font-semibold text-teal-800' : 'border-ink-200 bg-surface text-ink-700 hover:border-teal-400'}`}>
            <span className="block">{km(x.km)} · {x.mins} min</span>
            {x.via && <span className="block truncate text-ink-500">via {x.via}</span>}
          </button>
        )
      })}
    </div>
  )
}
