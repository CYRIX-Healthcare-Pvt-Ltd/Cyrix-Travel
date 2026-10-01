import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import { roadKm, type Point } from '@/lib/geo'
import type { Tone } from '@/lib/tones'

export type TripStatus = 'open' | 'submitted' | 'approved' | 'returned'
export type StopKind = 'ticket' | 'pm' | 'meeting' | 'spare'

export interface Mode { mode: string; label: string; per_km: number | null; sort_order: number; is_active: boolean }

export interface Leg {
  id: string; trip_id: string; seq: number; mode: string
  from_lat: number; from_lng: number; from_at: string
  to_lat: number | null; to_lng: number | null; to_at: string | null
  road_km: number | null; line_km: number | null; km_source: 'route' | 'line' | null
  rate: number | null; fare: number | null; amount: number
  bill_path: string | null; bill_lat: number | null; bill_lng: number | null; bill_at: string | null
}

export interface Stop {
  id: string; trip_id: string; seq: number; kind: StopKind; ticket_no: string | null
  facility_name: string; lat: number; lng: number; reached_at: string; note: string | null
  closed_at: string | null; proof_path: string | null; proof_lat: number | null; proof_lng: number | null
  proof_at: string | null; distance_m: number | null; flagged: boolean
}

export interface Trip {
  id: string; code: string; employee_id: string; status: TripStatus
  start_kind: 'home' | 'new'; start_lat: number; start_lng: number; start_note: string | null; started_at: string
  end_lat: number | null; end_lng: number | null; ended_at: string | null
  total_km: number; total_amount: number
  submitted_at: string | null; decided_at: string | null; decision_note: string | null
}

export interface TripRow {
  id: string; code: string; employee_id: string; employee_name: string; employee_ecode: string; status: TripStatus
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
      return (data as Mode[]).map(m => num(m, ['per_km']))
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
        legs: (legs.data as Leg[]).map(l => num(l, ['road_km', 'line_km', 'rate', 'fare', 'amount'])),
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

export const useStart = () => useMove((a: { kind: 'home' | 'new'; at: Point; mode: string; note?: string }) =>
  rpc<{ id: string; code: string }>('travel_start', { p_kind: a.kind, p_lat: a.at.lat, p_lng: a.at.lng, p_mode: a.mode, p_note: a.note || null }))

export const useSetHome = () => useMove((a: { at: Point }) => rpc('travel_set_home', { p_lat: a.at.lat, p_lng: a.at.lng }))

/** What ends a leg: where, and for a fare-paid mode the fare and its bill. The road distance is worked out here. */
export interface LegEnd { at: Point; from: Point; fare?: number | null; bill?: { path: string; at: Point } | null }
const legArgs = async (e: LegEnd) => ({
  p_lat: e.at.lat, p_lng: e.at.lng,
  p_road_km: await roadKm(e.from, e.at),
  p_fare: e.fare ?? null,
  p_bill_path: e.bill?.path ?? null, p_bill_lat: e.bill?.at.lat ?? null, p_bill_lng: e.bill?.at.lng ?? null,
})

export const useChangeMode = () => useMove(async (a: { tripId: string; mode: string; end: LegEnd }) =>
  rpc('travel_change_mode', { p_trip_id: a.tripId, p_mode: a.mode, ...(await legArgs(a.end)) }))

export const useEnd = () => useMove(async (a: { tripId: string; end: LegEnd }) =>
  rpc('travel_end', { p_trip_id: a.tripId, ...(await legArgs(a.end)) }))

export const useReach = () => useMove((a: { tripId: string; kind: StopKind; facility: string; ticketNo?: string; at: Point; note?: string }) =>
  rpc<string>('travel_reach', { p_trip_id: a.tripId, p_kind: a.kind, p_facility: a.facility, p_ticket_no: a.ticketNo || null, p_lat: a.at.lat, p_lng: a.at.lng, p_note: a.note || null }))

export const useCloseStop = () => useMove((a: { stopId: string; proofPath: string; at: Point; note?: string }) =>
  rpc<{ flagged: boolean; distance_m: number | null; facility_status: string }>('travel_close_stop', { p_stop_id: a.stopId, p_proof_path: a.proofPath, p_lat: a.at.lat, p_lng: a.at.lng, p_note: a.note || null }))

export const useSubmit = () => useMove((a: { tripId: string }) => rpc('travel_submit', { p_trip_id: a.tripId }))

export const useDecide = () => useMove((a: { tripId: string; approve: boolean; note?: string }) =>
  rpc('travel_decide', { p_trip_id: a.tripId, p_approve: a.approve, p_note: a.note || null }))

export const useSetRate = () => useMove((a: { mode: string; perKm: number }) => rpc('travel_set_rate', { p_mode: a.mode, p_per_km: a.perKm }))
