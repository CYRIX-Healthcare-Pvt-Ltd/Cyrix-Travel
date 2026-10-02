import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import { lineKm, roadKm, type Point } from '@/lib/geo'
import { setModeArt } from '@/lib/modeArt'
import type { Tone } from '@/lib/tones'

export type TripStatus = 'open' | 'submitted' | 'approved' | 'returned'
export type StopKind = 'ticket' | 'pm' | 'meeting' | 'spare'

/** `art` is the drawn vehicle a mode added later borrows (te_0007); the first five are their own. */
export interface Mode { mode: string; label: string; per_km: number | null; sort_order: number; is_active: boolean; art?: string | null }

export interface Leg {
  id: string; trip_id: string; seq: number; mode: string
  from_lat: number; from_lng: number; from_at: string
  to_lat: number | null; to_lng: number | null; to_at: string | null
  road_km: number | null; line_km: number | null; km_source: 'route' | 'line' | null
  rate: number | null; fare: number | null; amount: number
  /** The engineer's own figure for a ride paid by the kilometre (te_0010): shown beside road_km, never paid on. */
  claimed_km: number | null
  bill_path: string | null; bill_lat: number | null; bill_lng: number | null; bill_at: string | null
}

export interface Stop {
  id: string; trip_id: string; seq: number; kind: StopKind; ticket_no: string | null
  facility_name: string; lat: number; lng: number; reached_at: string; note: string | null
  closed_at: string | null; proof_path: string | null; proof_lat: number | null; proof_lng: number | null
  proof_at: string | null; distance_m: number | null; flagged: boolean
}

/** `code` is the claim's TE number: null until the claim is submitted (te_0008). */
export interface Trip {
  id: string; code: string | null; employee_id: string; status: TripStatus
  start_kind: 'home' | 'new'; start_lat: number; start_lng: number; start_note: string | null; started_at: string
  end_lat: number | null; end_lng: number | null; ended_at: string | null
  /** Ended within 300 m of the engineer's saved home (te_0011): the database says so, since a manager cannot read that home. */
  ended_home?: boolean
  total_km: number; total_amount: number
  submitted_at: string | null; decided_at: string | null; decision_note: string | null
}

export interface TripRow {
  id: string; code: string | null; employee_id: string; employee_name: string; employee_ecode: string; status: TripStatus
  started_at: string; ended_at: string | null; total_km: number; total_amount: number
  submitted_at: string | null; decided_at: string | null; decided_by_name: string | null; decision_note: string | null
  stops: number; flags: number; mine: boolean; can_decide: boolean
}

export const STOP_KIND: Record<StopKind, { label: string; tone: Tone }> = {
  ticket: { label: 'Ticket visit', tone: 'indigo' },
  pm: { label: 'PM visit', tone: 'teal' },
  meeting: { label: 'Meeting', tone: 'violet' },
  spare: { label: 'Spare pickup', tone: 'orange' },
}

/** How a claim stands. A trip still on the road, and one ended but not sent, are both "open" in the database. */
export function statusLook(t: { status: TripStatus; ended_at: string | null }): { label: string; tone: Tone } {
  if (t.status === 'open') return t.ended_at ? { label: 'Not submitted', tone: 'amber' } : { label: 'On the road', tone: 'sky' }
  if (t.status === 'submitted') return { label: 'With the manager', tone: 'indigo' }
  if (t.status === 'approved') return { label: 'Approved', tone: 'green' }
  return { label: 'Sent back', tone: 'rose' }
}

/**
 * Where a ride began and where it ended, in words — "Home", "GH Thrissur".
 *
 * Since te_0009 a ride runs from one place to the next, so it can say so:
 * it began at the trip's start or at the visit the engineer left, and ended
 * at the visit it reached or where the trip ended — "Home" when the trip
 * was ended at the engineer's home. A side with no name is a change of
 * vehicle on the way, and is left null.
 */
export function rideEnds(leg: Leg, legs: Leg[], stops: Stop[], trip: Pick<Trip, 'start_kind' | 'start_note' | 'ended_at' | 'ended_home'>): { from: string | null; to: string | null } {
  // A ride and the visit it ended at are made in one moment by the database: the same instant, to the microsecond.
  // A second's grace and no more — a wider one would take the next visit, minutes later in life but not in a test, for this one.
  const same = (a: string | null, b: string | null) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) < 1000
  const before = legs.filter(l => l.seq < leg.seq).sort((a, b) => b.seq - a.seq)[0]
  const after = legs.some(l => l.seq > leg.seq)
  const from = !before
    ? (trip.start_kind === 'home' ? 'Home' : trip.start_note ?? 'Start')
    : stops.find(s => same(s.reached_at, before.to_at))?.facility_name ?? null
  const to = stops.find(s => same(s.reached_at, leg.to_at))?.facility_name
    ?? (!after && leg.to_at && same(trip.ended_at, leg.to_at) ? (trip.ended_home ? 'Home' : 'End of trip') : null)
  return { from, to }
}

/** "Home → GH Thrissur"; a side that is a change of vehicle reads "on the way". Nothing when neither side has a name. */
export function rideLine(ends: { from: string | null; to: string | null }): string | null {
  if (!ends.from && !ends.to) return null
  return `${ends.from ?? 'on the way'} → ${ends.to ?? 'on the way'}`
}

/**
 * What a trip is called: its claim number once it has one, and until then
 * the day it was made — "Trip of 1 Oct". A trip is numbered when it is
 * submitted, so one cancelled or never sent uses no number.
 */
export const tripName = (t: { code: string | null; started_at: string }) =>
  t.code ?? `Trip of ${new Date(t.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`

export const rupees = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
export const km = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`

const num = <T extends object>(row: T, keys: Array<keyof T>): T => {
  const out = { ...row }
  for (const k of keys) if (out[k] !== null && out[k] !== undefined) (out[k] as unknown) = Number(out[k])
  return out
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(friendlyError(error))
  return data as T
}

/* ------------------------------------------------------------------ reads */

export function useModes() {
  return useQuery({
    queryKey: ['travel', 'modes'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_modes').select('*').order('sort_order')
      if (error) throw new Error(friendlyError(error))
      const modes = (data as Mode[]).map(m => num(m, ['per_km']))
      setModeArt(modes)
      return modes
    },
  })
}

export function useHome(employeeId: string | undefined) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['travel', 'home', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_homes').select('lat, lng, set_at').eq('employee_id', employeeId!).maybeSingle()
      if (error) throw new Error(friendlyError(error))
      return data as (Point & { set_at: string }) | null
    },
  })
}

export function useTrips() {
  return useQuery({
    queryKey: ['travel', 'trips'],
    queryFn: async () => (await rpc<TripRow[]>('travel_trip_list')).map(t => num(t, ['total_km', 'total_amount'])),
  })
}

/** One trip with its legs and stops. */
export function useTrip(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['travel', 'trip', id],
    queryFn: async () => {
      const [trip, legs, stops] = await Promise.all([
        supabase.from('travel_trips').select('*').eq('id', id!).maybeSingle(),
        supabase.from('travel_legs').select('*').eq('trip_id', id!).order('seq'),
        supabase.from('travel_stops').select('*').eq('trip_id', id!).order('seq'),
      ])
      const err = trip.error ?? legs.error ?? stops.error
      if (err) throw new Error(friendlyError(err))
      if (!trip.data) return null
      return {
        trip: num(trip.data as Trip, ['total_km', 'total_amount']),
        legs: (legs.data as Leg[]).map(l => num(l, ['road_km', 'line_km', 'rate', 'fare', 'amount', 'claimed_km'])),
        stops: stops.data as Stop[],
      }
    },
  })
}

/* ------------------------------------------------------------------ photographs */

/** Puts a photograph taken in the app into the trip's folder; the name says what it is and which. */
export async function uploadShot(tripId: string, kind: 'bill' | 'proof', n: number, blob: Blob): Promise<string> {
  const path = `${tripId}/${kind}-${n}.jpg`
  const { error } = await supabase.storage.from('travel-proofs').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(`The photograph did not upload: ${error.message}`)
  return path
}

export function useShot(path: string | null | undefined) {
  return useQuery({
    enabled: !!path,
    queryKey: ['travel', 'shot', path],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('travel-proofs').createSignedUrl(path!, 3600)
      if (error) throw new Error(friendlyError(error))
      return data.signedUrl
    },
  })
}

/* ------------------------------------------------------------------ moves */

function useMove<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['travel'] }) })
}

/**
 * Starts a trip, and refreshes nothing: the Start card lets the vehicle ride out before the trip's
 * own screen takes over, so it says when (see StartCard).
 */
export const startTrip = (a: { kind: 'home' | 'new'; at: Point; mode: string; note?: string }) =>
  rpc<{ id: string; code: string }>('travel_start', { p_kind: a.kind, p_lat: a.at.lat, p_lng: a.at.lng, p_mode: a.mode, p_note: a.note || null })

export const useStart = () => useMove(startTrip)

export const useSetHome = () => useMove((a: { at: Point }) => rpc('travel_set_home', { p_lat: a.at.lat, p_lng: a.at.lng }))

/* ------------------------------------------------------------------ saved places */

/** A place this person starts from often, under a name of their own (te_0005). */
export interface SavedPlace extends Point { id: string; name: string; saved_at: string }

/** How near a point must be to a saved place to be called by its name: the same 300 m a facility is given. */
const PLACE_REACH_KM = 0.3

export function usePlaces() {
  return useQuery({
    queryKey: ['travel', 'places'],
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_places').select('id, name, lat, lng, saved_at').order('name')
      if (error) throw new Error(friendlyError(error))
      return data as SavedPlace[]
    },
  })
}

/**
 * The saved place a point is at, if it is at one — the nearest within reach.
 * A saved place only names where the phone is; it is never a way to start
 * from somewhere the phone is not.
 */
export function placeAt(places: SavedPlace[], p: Point): SavedPlace | null {
  let best: SavedPlace | null = null, near = PLACE_REACH_KM
  for (const s of places) { const d = lineKm(s, p); if (d <= near) { best = s; near = d } }
  return best
}

export const useSavePlace = () => useMove((a: { name: string; at: Point }) =>
  rpc<string>('travel_save_place', { p_name: a.name, p_lat: a.at.lat, p_lng: a.at.lng }))

export const useForgetPlace = () => useMove((a: { id: string }) => rpc('travel_forget_place', { p_id: a.id }))

/**
 * The stops a leg went through on its way: reached after it began and before
 * it ended. Since te_0009 reaching a place ends the leg, so a leg made now
 * goes through none — the stop is where it ends, which is not "through".
 * This is for trips made before that, whose legs ran on past their stops.
 */
export const stopsOn = (leg: Leg, stops: Stop[]): Stop[] => {
  const from = Date.parse(leg.from_at), to = leg.to_at ? Date.parse(leg.to_at) : Infinity
  return stops.filter(s => { const at = Date.parse(s.reached_at); return at >= from && at < to }).sort((a, b) => a.seq - b.seq)
}

/**
 * What ends a leg: where, the stops it went through, and for a fare-paid
 * mode the fare and its bill. The road distance is worked out here, from
 * the start through each stop to the end (te_0004).
 */
export interface LegEnd { at: Point; from: Point; via?: Point[]; fare?: number | null; bill?: { path: string; at: Point } | null }
const legArgs = async (e: LegEnd) => ({
  p_lat: e.at.lat, p_lng: e.at.lng,
  p_road_km: await roadKm([e.from, ...(e.via ?? []), e.at]),
  p_fare: e.fare ?? null,
  p_bill_path: e.bill?.path ?? null, p_bill_lat: e.bill?.at.lat ?? null, p_bill_lng: e.bill?.at.lng ?? null,
})

export const useChangeMode = () => useMove(async (a: { tripId: string; mode: string; end: LegEnd }) =>
  rpc('travel_change_mode', { p_trip_id: a.tripId, p_mode: a.mode, ...(await legArgs(a.end)) }))

export const useEnd = () => useMove(async (a: { tripId: string; end: LegEnd }) =>
  rpc('travel_end', { p_trip_id: a.tripId, ...(await legArgs(a.end)) }))

/**
 * Reaching a place. It ends the leg that brought the engineer there (te_0009),
 * so it carries what ending a leg does: the road distance, and for a fare-paid
 * ride its fare and bill.
 */
export const useReach = () => useMove(async (a: { tripId: string; kind: StopKind; facility: string; ticketNo?: string; at: Point; note?: string; end?: LegEnd | null }) =>
  rpc<string>('travel_reach', {
    ...(a.end ? await legArgs(a.end) : {}),
    p_trip_id: a.tripId, p_kind: a.kind, p_facility: a.facility, p_ticket_no: a.ticketNo || null, p_lat: a.at.lat, p_lng: a.at.lng, p_note: a.note || null,
  }))

/**
 * Setting off again after a stop: the next leg, from where the phone is, by
 * the mode chosen. On its own, refreshing nothing, for the same reason as
 * startTrip: the vehicle rides out before the screen changes.
 */
export const resumeTrip = (a: { tripId: string; at: Point; mode: string }) =>
  rpc('travel_resume', { p_trip_id: a.tripId, p_lat: a.at.lat, p_lng: a.at.lng, p_mode: a.mode })

export const useCloseStop = () => useMove((a: { stopId: string; proofPath: string | null; at: Point; note?: string }) =>
  rpc<{ flagged: boolean; distance_m: number | null; facility_status: string }>('travel_close_stop', { p_stop_id: a.stopId, p_proof_path: a.proofPath, p_lat: a.at.lat, p_lng: a.at.lng, p_note: a.note || null }))

/** Submits a claim, and answers with the number it was given (or already had, for one sent back). */
/** The engineer's own kilometres for one of their rides; null takes the figure away. */
export const useClaimKm = () => useMove((a: { legId: string; km: number | null }) => rpc('travel_claim_km', { p_leg_id: a.legId, p_km: a.km }))

/**
 * Does the engineer's figure differ enough from the one worked out to point
 * at? More than half a kilometre and more than a tenth: an odometer and a
 * map never agree to the metre, and a flag on every ride is a flag on none.
 */
export const kmDiffers = (l: { road_km: number | null; claimed_km: number | null }) =>
  l.claimed_km !== null && l.road_km !== null && Math.abs(l.claimed_km - l.road_km) > Math.max(0.5, l.road_km * 0.1)

export const useSubmit = () => useMove((a: { tripId: string }) => rpc<string | null>('travel_submit', { p_trip_id: a.tripId }))

export const useDecide = () => useMove((a: { tripId: string; approve: boolean; note?: string }) =>
  rpc('travel_decide', { p_trip_id: a.tripId, p_approve: a.approve, p_note: a.note || null }))

/** A rate pays by the kilometre; null pays on the actual fare. */
export const useSetRate = () => useMove((a: { mode: string; perKm: number | null }) => rpc('travel_set_rate', { p_mode: a.mode, p_per_km: a.perKm }))

/* ------------------------------------------------------------------ photographs: required, or not for now */

/**
 * Whether a stop needs its proof and a fare-paid leg its bill (te_0006).
 * Required unless the setting says otherwise — and while it is being read,
 * so a screen never offers to skip a photograph it may turn out to need.
 */
export function usePhotosRequired() {
  const { data } = useQuery({
    queryKey: ['travel', 'photos-required'],
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_settings').select('value').eq('key', 'photos_required').maybeSingle()
      if (error) throw new Error(friendlyError(error))
      return data ? data.value !== false : true
    },
  })
  return data ?? true
}

export const useSetPhotosRequired = () => useMove((a: { on: boolean }) => rpc('travel_set_photos_required', { p_on: a.on }))

/* ------------------------------------------------------------------ facilities, for naming a stop */

/** Facilities whose place a manager has agreed, with where they are: a stop reached at one is offered its name. */
export function useKnownFacilities() {
  return useQuery({
    queryKey: ['travel', 'facilities'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_facilities').select('name, lat, lng, status').order('name')
      if (error) throw new Error(friendlyError(error))
      return data as Array<Point & { name: string; status: 'pending' | 'approved' }>
    },
  })
}

/* ------------------------------------------------------------------ deleting a claim */

/**
 * Deletes a claim: its photographs first, while the trip they belong to is
 * still there to say who may remove them, then the trip with its legs and
 * stops. Who may is the database's rule — its engineer while the manager
 * does not hold it, or the software administrator.
 */
export const useDeleteTrip = () => useMove(async (a: { tripId: string }) => {
  const bucket = supabase.storage.from('travel-proofs')
  const { data: files } = await bucket.list(a.tripId)
  // A photograph that will not go is left behind rather than keeping the claim: nobody can open it once the trip is gone.
  if (files?.length) await bucket.remove(files.map(f => `${a.tripId}/${f.name}`))
  return rpc('travel_delete', { p_trip_id: a.tripId })
})
