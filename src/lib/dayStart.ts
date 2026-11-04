import { useQuery } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import type { VisitPhoto } from '@/lib/visits'

/*
  Start my day (te_0104; the user, 3 Nov: home marked at Edappally, the night at Vytilla, the claim from Edappally). One
  press a day before the first visit photo keeps where the phone was; the day's first ride starts there.
*/
export interface DayStart { day?: string; at: string; lat: number; lng: number; place: string | null; home_m: number | null }
/** End my day (te_0109): the same, where and when the day was ended. */
export type DayEnd = DayStart

/*
  Late night work (te_0108; the user, 4 Nov: "just add a button example visit of 3rd Nov photo and start my day"): after
  midnight, until the new day is started, late_day is the day before, whose trip may still go on. Locally,
  ?late-preview shows it to anyone, with yesterday as that day and today not started.
*/
export const latePreview = (() => {
  if (!import.meta.env.DEV) return false
  try {
    if (new URLSearchParams(window.location.search).has('late-preview')) sessionStorage.setItem('late-preview', '1')
    return sessionStorage.getItem('late-preview') === '1'
  } catch { return false }
})()
export const endPreview = (() => {
  if (!import.meta.env.DEV) return false
  try {
    if (new URLSearchParams(window.location.search).has('end-preview')) sessionStorage.setItem('end-preview', '1')
    return sessionStorage.getItem('end-preview') === '1'
  } catch { return false }
})()
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA') }

export const useMyDay = () => useQuery({
  queryKey: ['te_my_day'],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('te_my_day')
    if (error) throw new Error(friendlyError(error))
    const day = data as { required: boolean; start: DayStart | null; end?: DayEnd | null; late_day?: string | null }
    if (latePreview) return { ...day, required: true, start: null, end: null, late_day: yesterday() }
    // ?end-preview: today started at a sample spot and not ended, to see End my day.
    if (endPreview) return { ...day, required: true, start: { at: new Date().toISOString(), lat: 9.9667, lng: 76.3186, place: 'Vyttila', home_m: 0 }, end: null, late_day: null }
    return day
  },
})

/** "3 Nov" */
export const shortDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** Within this of the saved home, a start is at home. */
export const HOME_M = 500
export const startName = (s: DayStart) => (s.home_m != null && s.home_m <= HOME_M ? 'Home' : s.place ?? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`)

/*
  Time at a place (the user, 3 Nov: "this logic is good, we are giving just a calculation"): from its visit photo to
  the next, less the road time of the rides between, each at a town speed for its way of going. Null where a ride has
  no km, or a flight is between.
*/
const TOWN_KMH: Record<string, number> = { bike: 30, car: 35, auto: 25, taxi: 35, taxi_bike: 30, bus: 25, metro: 35, train: 50 }
// From 10 km, the open road (the user, 3 Nov: "if in bike, we can take like 60km, we can reach by 90 mins").
const ROAD_KMH: Record<string, number> = { bike: 40, car: 50, auto: 30, taxi: 50, taxi_bike: 40, bus: 40, metro: 35, train: 60 }
type StayRide = { id: string; mode: string; claimed_km: number | null; map_km: number | null }
export function stayMinutes(rides: StayRide[], shots: Map<string, { photo: VisitPhoto }>, rideId: string): number | null {
  const i = rides.findIndex(r => r.id === rideId), here = shots.get(rideId)
  if (i < 0 || !here) return null
  const j = rides.findIndex((r, k) => k > i && shots.has(r.id))
  if (j < 0) return null
  let road = 0
  for (const r of rides.slice(i + 1, j + 1)) {
    const km = r.map_km ?? r.claimed_km, v = (km != null && km >= 10 ? ROAD_KMH : TOWN_KMH)[r.mode]
    if (km == null || !v) return null
    road += (km / v) * 60
  }
  const gap = (Date.parse(shots.get(rides[j].id)!.photo.shot_at) - Date.parse(here.photo.shot_at)) / 60_000
  return gap - road >= 0 ? gap - road : null
}
export const stayText = (min: number) => (min >= 60 ? `~${Math.floor(min / 60)} h ${Math.round(min % 60)} m here` : `~${Math.round(min)} min here`)
