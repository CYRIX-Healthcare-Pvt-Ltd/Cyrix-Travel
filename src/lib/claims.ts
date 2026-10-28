import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Bus, Car, CarTaxiFront, Cog, createLucideIcon, Construction, Package, Plane, Printer, ReceiptIndianRupee, Smartphone, TrainFront, TramFront, Truck, Users, Utensils, Wrench, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { supabase, friendlyError } from './supabase'
import { hotelIn, routeIn, type HotelStay, type TicketRoute } from './ticket'
import type { VisitPhoto, VisitSetup } from './visits'

/*
  The month's claim by the day (te_0012; the user, 17 Oct 2026): the expense reimbursement Excel
  and the 2026 travel policy, as screens. A day holds its rides, tickets, one DA, a hotel night
  and other expenses, each with its bills.
*/

export type ModeCode = 'bike' | 'car' | 'bus' | 'train' | 'metro' | 'auto' | 'taxi' | 'taxi_bike' | 'flight'
/** A motorbike with its rider, drawn as the icon set draws (it has no motorbike): Rapido, Uber Moto, Ola Bike. */
const TaxiBike = createLucideIcon('TaxiBike', [
  ['circle', { cx: '5', cy: '17', r: '3', key: 'rear' }],
  ['circle', { cx: '19', cy: '17', r: '3', key: 'front' }],
  ['path', { d: 'M5 17h6l3-5h3', key: 'frame' }],
  ['path', { d: 'm19 17-3.5-8H13', key: 'fork' }],
  ['path', { d: 'M6 12h6', key: 'seat' }],
  ['circle', { cx: '10', cy: '5', r: '2', key: 'rider' }],
])

/*
  One colour per mode, never two alike (the user, 17 Oct: "avoid look alike colors for modes"),
  the same in the chips, the drawn route and the map. Red is the hospitals' pins, so no mode is red.
*/
export const MODES: Record<ModeCode, { label: string; short?: string; color: string; onDark: string; bg: string; fg: string; icon: LucideIcon; perKm: boolean }> = {
  bike:   { label: 'Bike', color: '#EF9F27', onDark: '#F6B95A', bg: '#FEF3C7', fg: '#78350F', icon: Bike, perKm: true },
  car:    { label: 'Car', color: '#2563EB', onDark: '#7AA7FF', bg: '#DBEAFE', fg: '#1E3A8A', icon: Car, perKm: true },
  bus:    { label: 'Bus', color: '#16A34A', onDark: '#4ADE80', bg: '#DCFCE7', fg: '#14532D', icon: Bus, perKm: false },
  train:  { label: 'Train', color: '#7C3AED', onDark: '#B197FC', bg: '#EDE9FE', fg: '#4C1D95', icon: TrainFront, perKm: false },
  metro:  { label: 'Metro', color: '#06B6D4', onDark: '#22D3EE', bg: '#CFFAFE', fg: '#164E63', icon: TramFront, perKm: false },
  auto:   { label: 'Auto', color: '#DB2777', onDark: '#F472B6', bg: '#FCE7F3', fg: '#831843', icon: Truck, perKm: false },
  // Uber / Taxi as a car (from MM3, by the grade's taxi rule) or a bike (any grade, bill always) — the user, 26 Oct.
  taxi:   { label: 'Uber / Taxi · Car', short: 'Taxi · Car', color: '#374151', onDark: '#B8C0CC', bg: '#E5E7EB', fg: '#111827', icon: CarTaxiFront, perKm: false },
  taxi_bike: { label: 'Uber / Taxi · Bike', short: 'Taxi · Bike', color: '#0D9488', onDark: '#2DD4BF', bg: '#CCFBF1', fg: '#134E4A', icon: TaxiBike, perKm: false },
  flight: { label: 'Flight', color: '#92400E', onDark: '#E0A46E', bg: '#FDE7D3', fg: '#7C2D12', icon: Plane, perKm: false },
}
/** A mode's colour for text and icons, its lighter shade on a dark page: with the class "mode-ink" (or "mode-fill" in a drawing). */
export const inkVars = (m: { color: string; onDark: string }) => ({ '--mc': m.color, '--mcd': m.onDark }) as CSSProperties
export const MODE_ORDER: ModeCode[] = ['bike', 'car', 'bus', 'train', 'metro', 'auto', 'taxi_bike', 'taxi', 'flight']

export const DA_KINDS = [
  { code: 'none', label: 'No DA' },
  { code: 'in_district', label: 'In district' },
  { code: 'out_district', label: 'Out of district' },
  // The ₹300 DA is out of district with a night away; ₹400 out of state with one (the user, 23 Oct).
  { code: 'out_state', label: 'Out of district, staying' },
  { code: 'out_state_stay', label: 'Out of state, staying' },
  // Inside an approved deputation, in its state: the same for every grade (te_0075, te_policy deputation_da).
  { code: 'deputation', label: 'Deputation' },
] as const
export type DaKind = typeof DA_KINDS[number]['code']

export const EXPENSE_CATEGORIES = ['Courier', 'Printing & stationery', 'Tools', 'Toll', 'Client meal', 'Team meal', 'Phone', 'Spare purchase', 'Other']
// Each kind of expense its own picture (the user, 21 Oct: "courier and phone having same icon?").
const EXPENSE_ICONS: Record<string, LucideIcon> = {
  Courier: Package, 'Printing & stationery': Printer, Tools: Wrench, Toll: Construction,
  'Client meal': Utensils, 'Team meal': Users, Phone: Smartphone, 'Spare purchase': Cog,
}
export const expenseIcon = (category: string): LucideIcon => EXPENSE_ICONS[category] ?? ReceiptIndianRupee

/** Each status as one strong hue: the claim header's stripe, and a claim row's edge. */
export const STATUS_HUE: Record<string, string> = {
  draft: '#94A3B8', with_manager: '#F59E0B', with_coordinator: '#8B5CF6', with_desk: '#0EA5E9',
  approved: '#16A34A', paid: '#0D9488', returned: '#E30613', recalled: '#F97316',
}
export const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-900' },
  with_manager: { label: 'With manager', tone: 'bg-amber-100 text-amber-900' },
  with_coordinator: { label: 'With coordinator', tone: 'bg-violet-100 text-violet-900' },
  with_desk: { label: 'With Travel Desk', tone: 'bg-sky-100 text-sky-900' },
  approved: { label: 'Approved', tone: 'bg-green-100 text-green-900' },
  paid: { label: 'Paid', tone: 'bg-teal-100 text-teal-900' },
  returned: { label: 'Sent back', tone: 'bg-cyrixRed-100 text-cyrixRed-900' },
  recalled: { label: 'Recalled · editing', tone: 'bg-orange-100 text-orange-900' },
}

/** The return a round-trip ticket has, kept on the going ride until it is added on its own day (te_0058). */
export interface ReturnLeg { ref: string; date: string | null; from: string; to: string; mode: ModeCode; day: string }
/** Where the ticket said the return goes, and when, as it was read off it. */
export interface SameTicket { ref: string; day: string; from: string; to: string; date: string | null; fromLat?: number; fromLng?: number; toLat?: number; toLng?: number }
export interface Ride {
  id: string; mode: ModeCode
  from_name: string | null; from_lat: number | null; from_lng: number | null
  to_name: string | null; to_lat: number | null; to_lng: number | null
  /** An end the map does not have, named by hand: learned for everyone once the day is saved (te_0071). Not stored. */
  from_named?: boolean; to_named?: boolean
  claimed_km: number | null; map_km: number | null; fare: number | null; amount?: number; note?: string | null
  /** Booked by the company (te_0042): it claims nothing, and its company cost is kept beside it. */
  company_booking?: string | null; company_amount?: number | null
  /** The return of a round-trip ticket whose fare is on another ride (te_0056): claims nothing, needs no bill. */
  same_ticket?: SameTicket | null
  /** The date its ticket is for, read off the ticket (te_0057). */
  ticket_date?: string | null
  /** A round trip's return, on the going ride, offered on its own day (te_0058). */
  return_leg?: ReturnLeg | null
  /** A bus that leaves its district or state (te_0048); null while not known. */
  inter?: boolean | null
  /** Why, and for which call centre (project): each ride its own, the next starting with the last one's (te_0060). */
  purpose?: string | null; project?: string | null
  /** Why there is no visit photo, when its purpose needs one (te_0082); '' while it is being written. */
  photo_skip?: string | null
  /** A breakdown call's ticket ID, kept in te_tickets under the ride's id (te_0060). */
  ticket_no?: string
  /** What autos usually cost a km where this one started: nearby rides, or the policy's rate (te_0051). */
  auto_norm?: { per_km: number; n: number; from: 'nearby' | 'policy' } | null
}
export interface Ticket { id: string; ticket_no: string; service_report: string | null; place: string | null }
export interface Hotel {
  id: string; name: string | null; amount: number; occupancy: 'single' | 'double'; metro: boolean
  shared_ecode?: string | null; shared_name?: string | null
  note?: string | null; company_booking?: string | null; company_amount?: number | null
}
export interface Expense { id: string; category: string; description: string | null; amount: number }
export interface Day {
  id: string; day: string; place: string | null; district: string | null; purpose: string | null
  da_kind: DaKind; da_amount: number; continues_day: string | null; remarks: string | null
  rides: Ride[]; tickets: Ticket[]; hotel: Hotel | null; expenses: Expense[]
  /** The hospital's pin, and the DA the map gave for the day's places (te_0025). */
  place_lat?: number | null; place_lng?: number | null; da_auto?: DaKind | null
  room_by?: { name: string; ecode: string; amount: number; number: string | null } | null
  /** A place of the day outside its deputation's state, as the map named it (te_0075). */
  dep_off?: string | null
}
export interface Bill {
  /** A ticket's service report is kept with the bills (te_0037). */
  id: string; owner_kind: 'ride' | 'hotel' | 'expense' | 'report'; owner_id: string; path: string; name: string | null
  ocr_amount: number | null; ocr_date: string | null; ocr_billno: string | null; twin: string | null
  /** The line and claim of the bill it looks like (te_0036). */
  twin_owner?: string | null; twin_claim?: string | null
  /** What was read off it (booking ids, PNRs), and the company booking it is (te_0042). */
  refs?: string[]; company?: CompanyBooking | null
}
/** A booking the company made (MakeMyTrip myBiz), from the Travel Desk's monthly report (te_0042). */
export interface CompanyBooking {
  booking_id: string; mode: string; pnr: string | null; travel_date: string | null; end_date: string | null
  from: string | null; to: string | null; hotel: string | null; passengers: string | null; net: number; cancelled: boolean
}
/** The company booking a ride or hotel night carries: saved on it, or read off a bill not saved yet. */
export function companyOf(bills: Bill[], line: { id: string; company_booking?: string | null; company_amount?: number | null }): { booking_id: string; net: number; card: CompanyBooking | null } | null {
  const b = bills.find(x => x.owner_id === line.id && x.company)
  if (b?.company) return { booking_id: b.company.booking_id, net: Number(b.company.net), card: b.company }
  if (line.company_booking) return { booking_id: line.company_booking, net: Number(line.company_amount ?? 0), card: null }
  return null
}
export interface Rule {
  grade: string; da_in_district: number; da_out_district: number; da_out_state: number; da_out_state_stay: number
  hotel_in_single: number; hotel_in_double: number; hotel_out_single: number; hotel_out_double: number
  bike_rate: number | null; bike_km_month: number | null; car_rate: number | null; car_km_month: number | null
  flight: boolean; taxi: boolean
}
export interface ClaimData {
  claim: {
    id: string; employee_id: string; month: string; part: number; status: string; number: string | null
    grade: string | null; designation: string | null; base_location: string | null; project: string | null; mobile: string | null
    /** What it takes from the person's advances (te_0063): worked out, not typed. */
    submitted_at: string | null; late_pct: number; advance: number
    /** The advances given of its month or before, and what the claims before it took (te_0063); null with none. */
    advance_box?: { given: number; before: number } | null
    /** The person's cost centre: their function (te_0063). */
    cost_centre?: string | null
    manager_note: string | null; coordinator_note: string | null; desk_note: string | null
    return_note: string | null; returned_at: string | null
    /** When it was paid and the transfer's UTR, given by the Travel Desk (te_0045). */
    paid_on?: string | null; paid_ref?: string | null
    name: string; ecode: string; manager: string | null; coordinator: string | null
    mine: boolean; can_edit: boolean; can_decide: boolean; is_desk: boolean; is_manager: boolean
    delete_requested_at: string | null; delete_reason: string | null
    recalls: number; last_recalled_at: string | null
    /** The date "Add a claim" started it on, while it has no saved day (te_0069). */
    picked_day?: string | null
  }
  rule: Rule
  days: Day[]
  bills: Bill[]
  km_month: { bike: number; car: number; auto: number; phone?: number }
  policy: Record<string, number | number[]>
  purposes: string[]
  office_purposes: string[]
  /** Visit photos (te_0082): the setup, the person's photos of the month, and "Photo not possible" on their other claims that month. */
  photo_setup?: VisitSetup; visit_photos?: VisitPhoto[]; photo_skips_other?: number
  history: HistoryStep[]
  /** Figures an approver changed (te_0027), oldest first. */
  adjustments?: Array<{ item_id: string; unit: string; old_value: number | null; new_value: number; old_amount: number | null; new_amount: number; reason: string; by: string | null; at: string }>
  /** Where the person moved their home while this claim was open (te_0041). */
  home_moves?: Array<{ at: string; km: number | null; first: boolean; how?: 'here' | 'map' }>
  /** How the home in use was set: by standing there, or on the map (te_0053). */
  home?: { how: 'here' | 'map'; set_at: string } | null
  /** The company's bookings for this person in the month that no bill carries (te_0042). */
  company_unlinked?: CompanyBooking[]
  /** The person's approved deputations over the month (te_0075). */
  deputations?: Array<{ state: string; from_day: string; to_day: string }>
}
/** One step of a claim's history (te_0025): who did what, when, and the note given. */
export interface HistoryStep {
  id: number; at: string; action: string; to_status: string | null; note: string | null; actor: string | null
  /** Travel Desk or Coordinator when the step was taken as one; nothing for the reporting manager (te_0044). */
  role?: string | null
}

export const money = (n: number | null | undefined) =>
  n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN')
export const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 10) / 10} km`)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`
/** A claim by its month; once sent, its number (TE-01) is what tells two of the same month apart (the user, 17 Oct). */
export const claimName = (iso: string, _part?: number | null) => monthName(iso)
/** Today as YYYY-MM-DD, on the phone's own calendar. */
export const todayIso = () => new Date().toLocaleDateString('en-CA')
/** Its person can change it now: unsent, sent back, or recalled (te_0021). */
export const editable = (status: string) => status === 'draft' || status === 'returned' || status === 'recalled'
/** "15 Oct", "15–17 Oct", "30 Sep – 2 Oct" — the days a claim covers (the user, 17 Oct). */
export function dayRange(first: string | null, last: string | null) {
  if (!first) return 'No days yet'
  const f = new Date(first + 'T00:00:00'), l = new Date((last ?? first) + 'T00:00:00')
  const dm = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (first === (last ?? first)) return dm(f)
  return f.getMonth() === l.getMonth() ? `${f.getDate()}–${dm(l)}` : `${dm(f)} – ${dm(l)}`
}
export const dayName = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
export const newId = () => crypto.randomUUID()

/** What a ride is paid: km x the grade's rate on a bike or a car, else its fare. As the database works it out. */
export function rideAmount(r: Pick<Ride, 'mode' | 'claimed_km' | 'fare'> & { company_booking?: string | null }, rule: Rule | undefined) {
  // What the company booked is not claimed (te_0042).
  if (r.company_booking) return 0
  if (r.mode === 'bike') return (r.claimed_km ?? 0) * (rule?.bike_rate ?? 5)
  if (r.mode === 'car') return (r.claimed_km ?? 0) * (rule?.car_rate ?? 11)
  return r.fare ?? 0
}
export function dayTotal(d: Day, rule: Rule | undefined) {
  return d.rides.reduce((t, r) => t + rideAmount(r, rule), 0) + (d.da_amount ?? 0) + (d.hotel?.amount ?? 0)
    + d.expenses.reduce((t, x) => t + (x.amount ?? 0), 0)
}
export function daFor(rule: Rule | undefined, kind: DaKind, purpose: string | null, office: string[], depDa = 800) {
  if (!rule || (purpose && office.includes(purpose))) return 0
  return kind === 'in_district' ? rule.da_in_district : kind === 'out_district' ? rule.da_out_district
    : kind === 'out_state' ? rule.da_out_state : kind === 'out_state_stay' ? rule.da_out_state_stay
    : kind === 'deputation' ? depDa : 0
}
/** The hotel limit for the night: grade, single or double, in or out of state, +20% in a metropolitan city. */
export function hotelLimit(rule: Rule | undefined, h: Pick<Hotel, 'occupancy' | 'metro'>, outOfState: boolean, metroPct: number) {
  if (!rule) return null
  const base = outOfState
    ? (h.occupancy === 'double' ? rule.hotel_out_double : rule.hotel_out_single)
    : (h.occupancy === 'double' ? rule.hotel_in_double : rule.hotel_in_single)
  return h.metro ? Math.round(base * (1 + metroPct / 100)) : base
}
/** Claimed km more than the map's road km plus the tolerance (10%, set by the admins). */
export function kmOver(r: Pick<Ride, 'claimed_km' | 'map_km'>, tolerance: number) {
  if (r.claimed_km == null || r.map_km == null) return null
  const allowed = r.map_km * (1 + tolerance / 100)
  return { allowed, over: r.claimed_km > allowed + 0.05 ? r.claimed_km - allowed : 0 }
}
/**
 * Whether this ride, hotel or expense needs a bill: whatever comes to more than ₹300, and nothing else (te_0060; the
 * user, 23 Oct). A bike or car is paid by its km, checked on the map; a return on another ride's ticket has none.
 */
export function needsBill(kind: 'ride' | 'hotel' | 'expense', item: Ride | Hotel | Expense, over: number, rule?: Rule) {
  if (kind === 'hotel') return (item as Hotel).amount > over
  if (kind === 'ride') {
    const r = item as Ride
    if (r.same_ticket || MODES[r.mode].perKm) return false
    // A bike taxi's bill (the Uber or Rapido invoice) whatever the amount (te_0074).
    return r.mode === 'taxi_bike' || rideAmount(r, rule) > over
  }
  // A courier or a tool always brings its bill, whatever it cost (the user, 23 Oct).
  const x = item as Expense
  return x.amount > over || BILL_ALWAYS.includes(x.category)
}
/** The expenses whose bill is needed even under ₹300. */
export const BILL_ALWAYS = ['Courier', 'Tools']
/** A breakdown call: its ride names the ticket (te_0060). */
export const isBreakdown = (purpose: string | null | undefined) => /breakdown/i.test(purpose ?? '')
/** The km typed is not the map's (te_0060: "if any changes in km it should be added in observation"). */
/*
  The km a bike or car may claim: the map's road km, up to the tolerance more (10%, set by the admins), never less (the
  user, 27 Oct: "min should be the same as map km"). Outside it the day does not save.
*/
export function kmRange(mapKm: number, tolerance: number) {
  // To a tenth, outward, past the float noise (10 km and 10% is 11.0, not 11.1).
  const tenth = (v: number, f: (x: number) => number) => f(Math.round(v * 1e4) / 1e3) / 10
  return { lo: tenth(mapKm, Math.floor), hi: tenth(mapKm * (1 + tolerance / 100), Math.ceil) }
}
/**
 * Whether the km typed so far can still become one in the band: map 8.8 takes "8" (to 8.8) and "9", not "7"; map 10
 * takes "1" and "11", not "12" (the user, 27 Oct). "8." or "8.8" is the run of numbers it can still grow into.
 */
export function kmCanReach(typed: string, g: { lo: number; hi: number }) {
  const t = typed.trim()
  if (t === '') return true
  const overlaps = (a: number, b: number) => a <= g.hi && b > g.lo
  const [int, frac] = t.split('.')
  if (frac !== undefined) { const a = Number(`${int || '0'}.${frac || '0'}`); return overlaps(a, a + 10 ** -frac.length) }
  const n = Number(int)
  if (!Number.isFinite(n)) return false
  if (n === 0) return overlaps(0, 1)
  for (let k = 0, a = n; a <= g.hi; k++, a = n * 10 ** k) if (overlaps(a, (n + 1) * 10 ** k)) return true
  return false
}
export const kmOutside = (r: Pick<Ride, 'claimed_km' | 'map_km'>, tolerance: number) => {
  if (r.claimed_km == null || r.map_km == null) return false
  const { lo, hi } = kmRange(r.map_km, tolerance)
  return r.claimed_km < lo || r.claimed_km > hi
}
export const kmChanged = (r: Pick<Ride, 'claimed_km' | 'map_km'>) => r.claimed_km != null && r.map_km != null && Math.abs(r.claimed_km - r.map_km) > 0.05

// ---------------------------------------------------------------- maps
export interface Place { name: string; lat: number; lng: number }

/** A train or the metro goes by its tracks, not the road (the user, 23 Oct). */
export const RAIL_MODES = new Set<ModeCode>(['train', 'metro'])
/** Km along the railway or metro line, from BRouter's rail profile on OpenStreetMap; null when it finds no track. */
async function railKm(a: Place, b: Place): Promise<{ km: number; line: [number, number][] } | null> {
  try {
    const r = await fetch(`https://brouter.de/brouter?lonlats=${a.lng},${a.lat}|${b.lng},${b.lat}&profile=rail&alternativeidx=0&format=geojson`)
    if (!r.ok) return null
    const f = (await r.json()).features?.[0]
    const m = Number(f?.properties?.['track-length'])
    if (!f || !m) return null
    return { km: Math.round((m / 1000) * 10) / 10, line: f.geometry.coordinates.map(([x, y]: [number, number]) => [y, x]) }
  } catch { return null }
}
/** How a mode's km is measured: along the tracks, through the air, or by road. */
export const kmWay = (mode: ModeCode) => (RAIL_MODES.has(mode) ? 'rail' : mode === 'flight' ? 'air' : 'road')
/**
 * Km between two places: along the tracks for a train or the metro, the straight line between the airports for a
 * flight, else by road from the free OSRM router on OpenStreetMap (the same as the trip module used). A rail route not
 * found falls back to the road.
 */
export async function roadKm(a: Place, b: Place, mode?: ModeCode | null): Promise<{ km: number; line: [number, number][] } | null> {
  if (mode === 'flight') return { km: Math.round(distanceKm(a, b) * 10) / 10, line: [[a.lat, a.lng], [b.lat, b.lng]] }
  if (mode && RAIL_MODES.has(mode)) {
    const rail = await railKm(a, b)
    if (rail) return rail
  }
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
  const kept = roads.get(key)
  if (kept) return kept
  const p = hedgedRoad(`${a.lng},${a.lat};${b.lng},${b.lat}`)
  roads.set(key, p)
  void p.then(v => { if (!v) roads.delete(key) })
  return p
}

/*
  The road between two places from two public routers (the user, 27 Oct: "it took nearly 1 min to load the km"): the
  first asked, the second too if the first has not answered in 2.5 s, whichever answers first; each given 12 s. Both
  read the same map, so they give the same km. Kept for the session, so the same two places again are at once.
*/
type Road = { km: number; line: [number, number][] } | null
const roads = new Map<string, Promise<Road>>()
const ROUTERS = [
  (ll: string) => `https://routing.openstreetmap.de/routed-car/route/v1/driving/${ll}?overview=full&geometries=geojson`,
  (ll: string) => `https://router.project-osrm.org/route/v1/driving/${ll}?overview=full&geometries=geojson`,
]
async function askRouter(url: string, ms: number): Promise<Road> {
  const stop = new AbortController(), t = setTimeout(() => stop.abort(), ms)
  try {
    const j = await (await fetch(url, { signal: stop.signal })).json()
    const route = j.routes?.[0]
    if (!route) return null
    return { km: Math.round((route.distance / 1000) * 10) / 10, line: route.geometry.coordinates.map(([x, y]: [number, number]) => [y, x]) }
  } catch { return null } finally { clearTimeout(t) }
}
function hedgedRoad(ll: string): Promise<Road> {
  return new Promise(done => {
    let over = false, asked = 0, answered = 0
    const ask = (i: number) => {
      asked++
      void askRouter(ROUTERS[i](ll), 12_000).then(v => {
        answered++
        if (over) return
        if (v) { over = true; clearTimeout(slow); done(v) }
        // One that fails asks the next at once.
        else if (asked < ROUTERS.length) { clearTimeout(slow); ask(asked) }
        else if (answered === asked) { over = true; done(null) }
      })
    }
    const slow = setTimeout(() => { if (!over && asked < ROUTERS.length) ask(asked) }, 2500)
    ask(0)
  })
}

/*
  Places by name, kept to India. Photon first: it forgives spelling (the user, 17 Oct: "anjumana
  temple" finds nothing in Nominatim, where the map spells it Anchumana), and it prefers places near
  where the map is looking. Nominatim when Photon is down or finds nothing.
*/
/*
  Our facilities go by short forms — DH ALUVA, THQH PARASSALA, PHC NELLAYA — and the map knows them by
  their full names (the user, 21 Oct: "DH aluva is in our asset but in map it is district hospital").
  A short form typed is searched as its full name as well; a PHC also as a Family Health Centre, which
  many in Kerala now are. The same short forms are used in every state.
*/
const SHORT: Record<string, string[]> = {
  PHC: ['Primary Health Centre', 'Family Health Centre'], UPHC: ['Urban Primary Health Centre'],
  BPHC: ['Block Primary Health Centre'], APHC: ['Additional Primary Health Centre'], NPHC: ['New Primary Health Centre'],
  CHC: ['Community Health Centre'], UCHC: ['Urban Community Health Centre'],
  FHC: ['Family Health Centre'], UFHC: ['Urban Family Health Centre'],
  HWC: ['Health and Wellness Centre'], UHWC: ['Urban Health and Wellness Centre'],
  THQH: ['Taluk Headquarters Hospital'], THQ: ['Taluk Headquarters Hospital'],
  // Kerala's TH and MCH are a Taluk Hospital and a Medical College Hospital; Andhra's a Teaching Hospital and a Mother and Child Hospital.
  TH: ['Taluk Hospital', 'Teaching Hospital'],
  DH: ['District Hospital'], DHH: ['District Headquarters Hospital'], DWH: ['District Women Hospital'],
  SDH: ['Sub District Hospital'], GH: ['General Hospital'], AH: ['Area Hospital'],
  MCH: ['Medical College Hospital', 'Mother and Child Hospital'], GMC: ['Government Medical College'], GMCH: ['Government Medical College Hospital'],
  GMHC: ['Government Mental Health Centre'], WCH: ['Women and Children Hospital'], 'W&C': ['Women and Children Hospital'],
}
// Words in our names that the map never has: "24X7 PHC", "AAM-UHWC".
const NOISE = new Set(['24X7', 'AAM'])
const words = (q: string) => q.trim().split(/[\s-]+/).filter(Boolean)
/** The query with its short forms written out: none when it has none, two when a PHC may be either. */
export function expandShort(q: string): string[] {
  const ws = words(q)
  if (!ws.some(w => SHORT[w.toUpperCase()])) return []
  const kept = ws.filter(w => !NOISE.has(w.toUpperCase()))
  const variant = (i: number) => kept.map(w => { const o = SHORT[w.toUpperCase()]; return o ? o[Math.min(i, o.length - 1)] : w }).join(' ')
  return [...new Set([variant(0), variant(1)])]
}
// A search that is slow gives up after 5 s and the next one is tried (the public map search throttles at times).
async function timed(url: string, init?: RequestInit, ms = 5000) {
  const ctl = new AbortController(), t = window.setTimeout(() => ctl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctl.signal }) } finally { window.clearTimeout(t) }
}
/*
  A ticket's place on the map (the user, 21 Oct): an airport for a flight, a station for a train, the area
  or bus stand for a bus — the map says what kind each result is, so a university named like an airport or
  a spa in Madiwala is passed over. The plainer query is tried when the first finds nothing of the kind.
*/
// A city's old and new names, as tickets and the map write them differently.
const CITY_ALIAS: Record<string, string[]> = {
  kochi: ['cochin', 'ernakulam'], cochin: ['kochi'], bengaluru: ['bangalore'], bangalore: ['bengaluru'], thiruvananthapuram: ['trivandrum'], trivandrum: ['thiruvananthapuram'],
  mumbai: ['bombay'], chennai: ['madras'], kolkata: ['calcutta'], mysuru: ['mysore'], kozhikode: ['calicut'], calicut: ['kozhikode'], visakhapatnam: ['vizag'], vizag: ['visakhapatnam'],
  gurugram: ['gurgaon'], pune: ['poona'], vijayawada: ['gannavaram'], hyderabad: ['shamshabad'], mangaluru: ['mangalore'], mangalore: ['mangaluru'],
}
/**
 * A ticket's place. An airport is looked for across India, never near home — "Vijayawada Airport" near a Kochi
 * home came back as Cochin airport (the user, 22 Oct) — and one in the ticket's city, under any of its names, is
 * taken before another of the right kind.
 */
export async function lookupPlace(queries: string[], want: 'airport' | 'station' | 'area' | 'any', near?: { lat: number; lng: number }, city?: string): Promise<Place | null> {
  if (want === 'airport') near = undefined
  const names = city ? [city.toLowerCase(), ...(CITY_ALIAS[city.toLowerCase()] ?? [])] : []
  const inCity = (p: Record<string, string>) => !names.length || names.some(n => [p.name, p.city, p.district, p.county, p.state].some(v => (v ?? '').toLowerCase().includes(n)))
  const fits = (k: string, v: string) => want === 'any' ? true
    : want === 'airport' ? v === 'aerodrome'
    : want === 'station' ? k === 'railway' || v === 'station' || v === 'train_station'
    : ['bus_station', 'bus_stop', 'quarter', 'suburb', 'neighbourhood', 'city', 'town', 'village', 'locality', 'hamlet', 'district', 'county'].includes(v)
  for (const q of queries) {
    try {
      const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '&bbox=68.1,6.5,97.4,35.7'
      const r = await timed(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`)
      const j = await r.json() as { features: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
      const kind = j.features.filter(x => (x.properties.countrycode ?? '').toUpperCase() === 'IN' && fits(x.properties.osm_key ?? '', x.properties.osm_value ?? ''))
      const f = kind.find(x => inCity(x.properties)) ?? (names.length ? undefined : kind[0])
      if (f) {
        const p = f.properties, parts = [p.name ?? p.street, p.city ?? p.district ?? p.county, p.state].filter(Boolean)
        // "Madiwala, Madiwala": a name said once.
        const name = parts.filter((x, i) => parts.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 3).join(', ')
        return { name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
      }
    } catch { /* the next query */ }
  }
  return null
}
type Found = Place & { road?: boolean }
/*
  A city, district or state as it is typed (te_0063; the user, 24 Oct: "in advance map not needed, when typing city
  or district or state name it should automatically come"): India's towns, cities, districts and states, each with
  its state, villages and suburbs left out.
*/
export interface Area extends Place { state: string; kind: 'city' | 'district' | 'state' }
export async function searchAreas(q: string): Promise<Area[]> {
  const r = await timed(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15&lang=en&bbox=68.1,6.5,97.4,35.7&layer=city&layer=county&layer=state&layer=district`)
  const j = await r.json() as { features: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
  const out: Area[] = []
  for (const f of j.features) {
    const p = f.properties
    if ((p.countrycode ?? '').toUpperCase() !== 'IN' || !p.name) continue
    const kind = p.type === 'state' || p.osm_value === 'state' ? 'state'
      : p.type === 'county' || p.osm_value === 'county' ? 'district'
      : ['city', 'town'].includes(p.osm_value) ? 'city' : null
    if (!kind) continue
    const state = kind === 'state' ? p.name : p.state
    if (!state) continue
    const name = kind === 'state' ? p.name : kind === 'district' && !/district/i.test(p.name) ? `${p.name} district, ${state}` : `${p.name}, ${state}`
    if (out.some(x => x.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ name, state, kind, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] })
  }
  return out.slice(0, 8)
}
/** What a typed name means (the user: "if i want to just enter uttar pradesh, it should save"): the one named so, else the first found. */
export function bestArea(list: Area[], typed: string): Area | null {
  const t = typed.trim().toLowerCase()
  return list.find(a => a.name.toLowerCase() === t || a.name.split(',')[0].toLowerCase() === t || a.name.split(',')[0].toLowerCase() === `${t} district`) ?? list[0] ?? null
}
async function photon(q: string, near?: { lat: number; lng: number }, tag?: string): Promise<Found[]> {
  // Near the engineer when the map knows where they are; otherwise anywhere in India. A tag asks for one kind only.
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '&bbox=68.1,6.5,97.4,35.7'
  const r = await timed(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en${bias}${tag ? `&osm_tag=${tag}` : ''}`)
  const j = await r.json() as { features: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
  return j.features.filter(f => (f.properties.countrycode ?? '').toUpperCase() === 'IN').map(f => {
    const p = f.properties
    const where = [p.street && p.street !== p.name ? p.street : null, p.city ?? p.district ?? p.county, p.state].filter(Boolean)
    return { name: [p.name ?? p.street, ...where].filter(Boolean).slice(0, 3).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], road: p.osm_key === 'highway' }
  }).filter(x => x.name)
}
/*
  The kind of place a search names, asked for as that kind too (the user, 22 Oct: "airport" found three stretches
  of Airport Road and not Cochin International Airport).
*/
/** The nearest places of one kind around a spot (Photon's reverse with a tag), each checked to be that kind. */
async function photonNear(near: { lat: number; lng: number }, tag: string): Promise<Found[]> {
  const r = await timed(`https://photon.komoot.io/reverse?lat=${near.lat}&lon=${near.lng}&osm_tag=${tag}&limit=6&radius=60&lang=en`)
  const j = await r.json() as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
  const [k, v] = tag.split(':')
  return (j.features ?? []).filter(f => f.properties.osm_key === k && f.properties.osm_value === v && (f.properties.countrycode ?? '').toUpperCase() === 'IN').map(f => {
    const p = f.properties
    return { name: [p.name, p.city ?? p.district ?? p.county, p.state].filter(Boolean).slice(0, 3).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
  }).filter(x => x.name)
}
const KIND_TAGS: Array<[RegExp, string]> = [
  [/\bair\s*port\b/i, 'aeroway:aerodrome'],
  [/\b(?:railway|train)?\s*station\b|\brailway\b/i, 'railway:station'],
  [/\bbus\s*(?:stand|station|stop)\b|\bksrtc\b/i, 'amenity:bus_station'],
  [/\bhospital\b|\bmedical college\b/i, 'amenity:hospital'],
  [/\bhotel\b|\blodge\b|\bresidency\b/i, 'tourism:hotel'],
]
export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  if (q.trim().length < 3) return []
  const full = expandShort(q)
  try {
    // The written-out names first, then what was typed; the same spot once.
    // The name without "Hotel" or "Lodge" too: the map often has the building by its own name (the user, 22 Oct:
    // "Hotel Raj Towers" is on the map as "Raj Towers", Vijayawada).
    const bare = q.replace(/\b(?:hotel|hotels|lodge|inn|resort|residency|guest\s*house|the)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    const asks = [...new Set([...full, q, ...(bare.length >= 3 && bare.toLowerCase() !== q.trim().toLowerCase() ? [bare] : [])])]
    const kinds = KIND_TAGS.filter(([re]) => re.test(q))
    // Only the kind typed ("airport", "railway station"): the nearest of that kind where the map is looking;
    // with a name ("Vijayawada airport"): that kind searched by the name.
    const onlyKind = kinds.length > 0 && kinds.reduce((t, [re]) => t.replace(re, ' '), q).replace(/[^a-z]/gi, '').length < 3
    const lists = await Promise.all([
      ...kinds.map(([, t]) => (onlyKind && near ? photonNear(near, t) : photon(q, near, t)).catch(() => [] as Found[])),
      ...asks.map(x => photon(x, near).catch(() => [] as Found[])),
    ])
    const out: Found[] = []
    const seen = new Set<string>()
    // The map often holds one hospital twice (its building and its point): the same name within half a km is one.
    for (const p of lists.flat()) {
      const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`, nm = p.name.split(",")[0].trim().toLowerCase()
      // A road once, however many stretches the map keeps of it.
      if (seen.has(k) || out.some(o => o.name.split(",")[0].trim().toLowerCase() === nm && distanceKm(o, p) < (p.road ? 5 : 0.5))) continue
      seen.add(k); out.push(p)
    }
    // A place carrying the typed name (Aluva, Nellaya) above one the search only guessed at.
    const named = words(q).filter(w => !SHORT[w.toUpperCase()] && !NOISE.has(w.toUpperCase()) && w.length >= 3).map(w => w.toLowerCase())
    const hits = (p: Place) => named.filter(w => p.name.toLowerCase().includes(w)).length
    // Where the map is looking first: a place over 100 km away goes below every one near it.
    const far = (p: Place) => (near && distanceKm(near, p) > 100 ? 1 : 0)
    // A place before a road of the same words.
    const ranked = out.map((p, i) => ({ p, i, h: hits(p), f: far(p), rd: p.road ? 1 : 0 })).sort((x, y) => x.f - y.f || x.rd - y.rd || y.h - x.h || x.i - y.i).map(({ p }) => ({ name: p.name, lat: p.lat, lng: p.lng }))
    if (ranked.length) return ranked.slice(0, 8)
  } catch { /* fall through to Nominatim */ }
  try {
    const r = await timed(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=6&q=${encodeURIComponent(full[0] ?? q)}`, { headers: { 'Accept-Language': 'en' } }, 6000)
    const j = await r.json() as Array<{ display_name: string; lat: string; lon: string; name?: string }>
    return j.map(p => ({ name: shortName(p.display_name), lat: Number(p.lat), lng: Number(p.lon) }))
  } catch { return [] }
}
/** A place our engineers have serviced (te_0038), offered before the map's own: its pin is where the ride went. */
export interface Learned extends Place { id: string; short: string; district: string | null; visits: number }
export async function findLearned(q: string, near?: { lat: number; lng: number }): Promise<Learned[]> {
  if (q.trim().length < 3) return []
  const { data, error } = await supabase.rpc('te_find_places', { p_q: q, p_lat: near?.lat ?? null, p_lng: near?.lng ?? null })
  if (error) return []
  return ((data ?? []) as Array<{ id: string; name: string; full_name: string; lat: number; lng: number; district: string | null; visits: number }>)
    .map(x => ({ id: x.id, name: x.full_name, short: x.name, lat: x.lat, lng: x.lng, district: x.district, visits: x.visits }))
}
/*
  Names for a spot being named (te_0071; the user, 26 Oct: "on name type can we show suggestion? like in chrome"):
  what the map calls the places within 2 km of it, nearest first — with nothing typed, those within 300 m. One
  Photon call a pause in typing; roads and towns left out.
*/
export async function namesNear(q: string, at: { lat: number; lng: number }): Promise<Array<{ name: string; km: number }>> {
  try {
    const r = await timed(q.trim().length >= 2
      ? `https://photon.komoot.io/api/?q=${encodeURIComponent(q.trim())}&lat=${at.lat}&lon=${at.lng}&limit=10&lang=en`
      : `https://photon.komoot.io/reverse?lat=${at.lat}&lon=${at.lng}&limit=8&radius=0.3&lang=en`)
    const j = await r.json() as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> }
    const out: Array<{ name: string; km: number }> = []
    for (const f of j.features ?? []) {
      const p = f.properties
      if (!p.name || p.osm_key === 'highway' || p.osm_key === 'place' || (p.countrycode ?? '').toUpperCase() !== 'IN') continue
      const km = distanceKm(at, { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] })
      if (km > 2 || out.some(o => o.name.toLowerCase() === p.name.toLowerCase())) continue
      out.push({ name: p.name, km })
    }
    return out.sort((a, b) => a.km - b.km).slice(0, 6)
  } catch { return [] }
}
export async function nameOf(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } })
    const j = await r.json() as { display_name?: string }
    return j.display_name ? shortName(j.display_name) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}` }
}
const shortName = (s: string) => s.split(',').slice(0, 3).map(x => x.trim()).join(', ')
/** The district and state of a point, from OpenStreetMap's address; asked once per spot. */
const areas = new Map<string, Promise<{ district: string | null; state: string | null }>>()
export function areaOf(lat: number, lng: number) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
  if (!areas.has(key)) areas.set(key, (async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } })
      const a = ((await r.json()) as { address?: Record<string, string> }).address ?? {}
      const d = a.state_district ?? a.county ?? a.city_district ?? a.city ?? null
      return { district: d ? d.replace(/\s+district$/i, '').trim() : null, state: a.state ?? null }
    } catch { areas.delete(key); return { district: null, state: null } }
  })())
  return areas.get(key)!
}
/** The district of a point (the user, 17 Oct: "district will be autofetched"). */
export const districtOf = async (lat: number, lng: number) => (await areaOf(lat, lng)).district

/*
  The DA the day's places give (the user, 18 Oct: "if any change in district or state, can we
  automatically change daily allowance?"): every place of the day against where the person starts
  from — home, else the first ride's start. Another state is out of state (staying, with a hotel
  night); another district is out of district; else in district.
*/
export async function autoDa(from: Place | null, places: Place[], stay: boolean): Promise<DaKind | null> {
  const start = from ?? places[0]
  if (!start || !places.length) return null
  const base = await areaOf(start.lat, start.lng)
  const same = (x: string | null, y: string | null) => !x || !y || x.toLowerCase() === y.toLowerCase()
  // Out of district, staying is ₹300; out of state, staying ₹400; away for the day without a night, out of district (te_0060).
  let state = false, district = false
  for (const p of places) {
    const a = await areaOf(p.lat, p.lng)
    if (!same(a.state, base.state)) state = true
    else if (!same(a.district, base.district)) district = true
  }
  if (state) return stay ? 'out_state_stay' : 'out_district'
  if (district) return stay ? 'out_state' : 'out_district'
  return 'in_district'
}
export const DA_RANK: Record<DaKind, number> = { none: 0, in_district: 1, out_district: 2, out_state: 3, out_state_stay: 4, deputation: 5 }

/** Straight-line km between two points. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
/*
  The places a day's rides went to and came from, home left out: what its tickets' hospitals are
  chosen from (the user, 21 Oct: "ticket attended, hospital in that should match hospital in claim
  ride"), and what the day's place is made of now that it is not typed (the user, 21 Oct: "what if
  I went to 2-3 hospitals?").
*/
const placeKey = (s: string | null | undefined) => (s ?? '').split(',')[0].trim().toLowerCase()
export function visitedPlaces(rides: Ride[]): string[] {
  const seen = new Map<string, string>()
  for (const r of rides) for (const n of [r.from_name, r.to_name]) {
    const k = placeKey(n)
    if (k && k !== 'home' && !seen.has(k)) seen.set(k, n!.split(',')[0].trim())
  }
  return [...seen.values()]
}
/** Null with no hospital named; otherwise whether one of the day's rides went there. */
export function ticketVisited(t: Pick<Ticket, 'place'>, rides: Ride[]): boolean | null {
  if (!placeKey(t.place)) return null
  return visitedPlaces(rides).some(p => placeKey(p) === placeKey(t.place))
}

// ---------------------------------------------------------------- bills
export async function sha256(file: Blob) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** A 64-bit picture fingerprint (difference hash): the same bill photographed again comes out nearly the same. */
export async function dhash(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const img = await createImageBitmap(file)
    const c = document.createElement('canvas'); c.width = 9; c.height = 8
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 9, 8)
    const px = g.getImageData(0, 0, 9, 8).data
    let bits = 0n
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4, j = i + 4
      const a = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11
      const b = px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11
      bits = (bits << 1n) | (a > b ? 1n : 0n)
    }
    // As a signed 64-bit number, which is what Postgres's bigint holds.
    return BigInt.asIntN(64, bits).toString()
  } catch { return null }
}
/*
  The finer picture fingerprint (te_0032): a 17 × 16 difference hash, 256 bits as hex. The 9 × 8 one
  called any two white slips with black lines alike; at this size a resized or re-saved copy of the same
  photo came 7 bits apart and different receipts 18 to 28, so 12 or less is the same picture.
*/
export async function dhash256(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const img = await createImageBitmap(file)
    const c = document.createElement('canvas'); c.width = 17; c.height = 16
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 17, 16)
    const px = g.getImageData(0, 0, 17, 16).data
    let hex = '', nibble = 0, n = 0
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 17 + x) * 4, j = i + 4
      const a = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11, b = px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11
      nibble = (nibble << 1) | (a > b ? 1 : 0)
      if (++n === 4) { hex += nibble.toString(16); nibble = 0; n = 0 }
    }
    return hex
  } catch { return null }
}

/*
  The amount (and, kept for the duplicate check, the bill number) read off a bill photo with the free reader in the phone
  (Tesseract; the user, 17 Oct). It is a guess the person checks, and it is shown on the bill for the
  approvers (18 Oct). The amount: the largest figure on a line that says total, else on a line that
  says amount, fare or paid, else the largest figure written with paise. The rupee sign comes out as
  ¥, % or =, which does not matter: only the figures are read.
*/
/*
  The booking ids and PNRs on a ticket (te_0042; the user, 21 Oct): MakeMyTrip's are N and a letter, then
  digits and letters — NF… a flight, NH… a hotel, NU… a bus, NR… a train. They are matched against the
  company's bookings, so a ticket the company paid for is not claimed again.
*/
export function refsIn(text: string): string[] {
  const t = text.toUpperCase()
  const ids = [...t.matchAll(/\bN[A-Z][A-Z0-9]{12,20}\b/g)].map(m => m[0])
  const pnr = [...t.matchAll(/PNR\s*(?:NO\.?|NUMBER)?\s*[:-]?\s*([A-Z0-9]{5,12})/g)].map(m => m[1])
  return [...new Set([...ids, ...pnr])]
}
// A PDF ticket's own text, its first pages, line by line (the reader is loaded only when a PDF comes).
async function pdfText(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  let text = ''
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const c = await (await doc.getPage(p)).getTextContent()
    let line = '', lastY: number | null = null
    for (const it of c.items as Array<{ str?: string; transform?: number[] }>) {
      const y = it.transform?.[5] ?? 0
      if (lastY !== null && Math.abs(y - lastY) > 2) { text += line.trim() + '\n'; line = '' }
      line += (it.str ?? '') + ' '; lastY = y
    }
    text += line.trim() + '\n'
  }
  return text
}
export async function readBill(file: Blob): Promise<{ amount: number | null; date: string | null; billno: string | null; refs: string[]; route?: TicketRoute | null; stay?: HotelStay | null }> {
  let raw = ''
  if (file.type === 'application/pdf') raw = await pdfText(file).catch(() => '')
  // A photo is read word by word, each with how sure the reader is of it (0–100), letter by letter.
  let words: OcrWord[] | null = null
  let upi: number | null = null
  if (file.type.startsWith('image/')) {
    const { createWorker, PSM } = await import('tesseract.js')
    const worker = await createWorker('eng')
    try {
      const img = await shrink(file)
      const { data } = await worker.recognize(img, {}, { text: true, blocks: true })
      raw = data.text
      words = ocrWords(data.words)
      if (PAYMENT_SCREEN.test(raw)) {
        upi = upiAmount(words)
        // Read as one block of text, the screen's big amount is passed over; read again for text anywhere.
        if (upi == null) {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
          upi = upiAmount(ocrWords((await worker.recognize(img, {}, { text: true, blocks: true })).data.words))
        }
      }
    } finally { void worker.terminate() }
  }
  if (!raw.trim()) return { amount: null, date: null, billno: null, refs: [] }
  const refs = refsIn(raw)
  // Where a ticket goes, and a voucher's hotel (the user, 21 Oct).
  const route = routeIn(raw), stay = hotelIn(raw)
  const text = raw.replace(/[Oo](?=\d)/g, '0').replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  const lines = text.split('\n')
  const figs = (s: string) => [...s.matchAll(/(\d{1,6}(?:\.\d{1,2})?)(?![\d/:])/g)].map(m => Number(m[1])).filter(n => n > 0 && n < 200000)
  let amount: number | null = upi
  if (amount == null) for (const l of lines) if (/total|grand|net\s*(amt|amount|payable)/i.test(l)) { const n = figs(l); if (n.length) amount = Math.max(amount ?? 0, ...n) }
  if (amount == null) for (const l of lines) if (/amount|amt|fare|paid|payable|rs\.?|inr|₹/i.test(l)) { const n = figs(l); if (n.length) amount = Math.max(amount ?? 0, ...n) }
  if (amount == null) {
    const paise = [...text.matchAll(/(\d{1,6})\.(\d{2})(?!\d)/g)].map(m => Number(m[1] + '.' + m[2])).filter(n => n > 0 && n < 200000)
    if (paise.length) amount = Math.max(...paise)
  }
  // A UPI payment's own number (its UPI transaction ID or UTR, 12 digits), else the bill's.
  const um = PAYMENT_SCREEN.test(raw) ? text.match(/(?:UPI\s*(?:transaction|txn|ref(?:erence)?)\s*(?:id|no\.?|number)?|UTR(?:\s*no\.?)?)\s*[:.-]?\s*(\d{12})(?!\d)/i) : null
  const bm = um ?? text.match(/(?:bill|invoice|ticket|receipt|txn|no)\s*(?:no\.?|number|#)?\s*[:.-]?\s*([A-Z0-9-]{4,})/i)
  // No date: the person enters the day, and the bill's own date is not needed (the user, 19 Oct).
  /*
    A photo's amount and bill number are used only when the words that hold them were read surely (the
    user, 21 Oct: "bill reader confidence fix"): a handwritten or blurred figure read wrongly would fill a
    wrong amount and tell the approver the bill differs when it does not. Unsure, it counts as not read,
    and the person types the amount. A PDF's text is exact and always used.
  */
  const sure = (value: string | number | null) => {
    if (value == null || !words) return value != null
    if (value === upi) return true
    const want = String(value).replace(/\.0+$/, '').replace(/[^0-9A-Z]/gi, '').toUpperCase()
    if (!want) return false
    const hits = words.filter(w => { const t = w.text.replace(/[^0-9A-Z]/gi, '').toUpperCase(); return t.length > 0 && (t === want || t.includes(want)) })
    // A figure is judged by its own digits: a ₹ read as R or ¥ beside it does not make it unsure.
    return hits.length > 0 && Math.max(...hits.map(w => (/^\d+$/.test(want) ? digitsSure(w) : w.confidence))) >= SURE
  }
  const billno = refs.find(x => /^N[A-Z]/.test(x)) ?? (bm ? bm[1] : null)
  return { amount: sure(amount) ? amount : null, date: null, billno: billno && (/^N[A-Z]/.test(billno) || sure(billno)) ? billno : null, refs, route, stay }
}
/** How sure the reader must be of a photo's figure (0–100) for it to be used. */
const SURE = 80
type OcrWord = { text: string; confidence: number; h: number; symbols: Array<{ text: string; confidence: number; h: number }> }
const ocrWords = (list: Array<{ text: string; confidence: number; bbox: { y0: number; y1: number }; symbols?: Array<{ text: string; confidence: number; bbox: { y0: number; y1: number } }> }> | undefined): OcrWord[] =>
  (list ?? []).map(w => ({ text: w.text, confidence: w.confidence, h: w.bbox.y1 - w.bbox.y0, symbols: (w.symbols ?? []).map(x => ({ text: x.text, confidence: x.confidence, h: x.bbox.y1 - x.bbox.y0 })) }))
const digitsSure = (w: OcrWord) => { const d = w.symbols.filter(x => /\d/.test(x.text)); return d.length ? Math.min(...d.map(x => x.confidence)) : w.confidence }
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0 }
/*
  A UPI payment screen — Google Pay, PhonePe, Paytm, BHIM (the user, 26 Oct: a Google Pay screenshot's amount was not
  read at the demo). Its amount is the biggest figure on it, with a smaller ₹ before it ("the rupee sign is small size
  comparing the numbers isnt? so why taking that?"): the reader takes that ₹ for a letter or a digit, and read ₹30 as
  "R30", "x30" and "230". What is not a number before the digits is dropped ("what if we can avoid the text that is
  not a number?"), and so is a first digit much shorter than the rest — the ₹ read as a 2.
*/
const PAYMENT_SCREEN = /\bUPI\b|\bUTR\b|transaction\s*id|google\s*pay|\bG\s?Pay\b|phone\s*pe|paytm|\bBHIM\b|paid\s+(?:to|successfully)|payment\s+(?:of|successful)|money\s+sent/i
// What the reader makes of a ₹ (or Rs, INR); a +91, a # or a masked account's XXXX before digits is not a sign.
const RUPEE = /^(?:[₹RZFXT%¥&=<€£$]|rs\.?|inr)$/i
function figureOf(w: OcrWord): { value: number; h: number; sure: number; signed: boolean } | null {
  let sy = w.symbols.length ? w.symbols : [...w.text].map(t => ({ text: t, confidence: w.confidence, h: w.h }))
  while (sy.length && /[,.)\]]/.test(sy[sy.length - 1].text)) sy = sy.slice(0, -1)
  const first = sy.findIndex(x => /\d/.test(x.text))
  if (first < 0) return null
  const sign = sy.slice(0, first).map(x => x.text).join('')
  if (sign && !RUPEE.test(sign)) return null
  sy = sy.slice(first)
  let signed = sign !== ''
  const digitH = (xs: typeof sy) => xs.filter(x => /\d/.test(x.text)).map(x => x.h)
  // A ₹ read as a digit is a 2 or a 7 by its shape; a short 0 is a masked number's dot (PhonePe's "•3247").
  if (digitH(sy).length >= 2 && /^[27]$/.test(sy[0].text) && sy[0].h < 0.8 * median(digitH(sy.slice(1)))) { sy = sy.slice(1); signed = true }
  const body = sy.map(x => x.text).join('')
  if (!/^(?:\d{1,3}(?:,\d{2,3})+|\d{1,6})(?:\.\d{1,2})?$/.test(body)) return null
  const d = sy.filter(x => /\d/.test(x.text))
  return { value: Number(body.replace(/,/g, '')), h: median(d.map(x => x.h)), sure: Math.min(...d.map(x => x.confidence)), signed }
}
/*
  The screen's amount: the one figure clearly bigger than everything else on it (Google Pay, Paytm), read surely; else,
  where the amount is no bigger than the rest (PhonePe's details), the figures with a ₹ before them, when they agree.
  A lone digit with no ₹ is an icon read as one (PhonePe's arrow became a big "8"), never the amount. Anything unsure,
  or the big figure and the ₹ figures disagreeing, is not read, and the person types it.
*/
function upiAmount(words: OcrWord[]): number | null {
  // Google Pay's "Payment of ₹7 completed" holds the amount even when its ₹ is not read at all.
  const figs = words.map((w, i) => { const f = figureOf(w); return f && /^payment$/i.test(words[i - 2]?.text ?? '') && /^of$/i.test(words[i - 1]?.text ?? '') ? { ...f, signed: true } : f })
    .filter((x): x is NonNullable<typeof x> => !!x && x.value > 0 && x.value < 200000 && (x.signed || x.value >= 10))
  if (!figs.length) return null
  const text = median(words.filter(w => w.text.length >= 2).map(w => w.h))
  const top = figs.reduce((a, b) => (b.h > a.h ? b : a))
  const isBig = top.h >= 1.8 * text
  const signed = [...new Set(figs.filter(x => x.signed && x.sure >= SURE && !(isBig && x === top)).map(x => x.value))]
  if (signed.length > 1) return null
  if (!isBig) return signed[0] ?? null
  const big = top.sure >= SURE && !figs.some(x => x.h >= 0.8 * top.h && x.value !== top.value) ? top.value : null
  return big != null && (signed.length === 0 || signed[0] === big) ? big : null
}
/** A phone photo made no wider than 2000px first: read as well, and many times faster. */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const img = await createImageBitmap(file)
    const k = Math.min(1, 2000 / Math.max(img.width, img.height))
    if (k === 1) return file
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>(res => c.toBlob(b => res(b ?? file), 'image/jpeg', 0.92))
  } catch { return file }
}
/** The amount read off the last bill of a ride, hotel night or expense that could be read. */
export function billRead(bills: Bill[], ownerId: string): number | null {
  const read = bills.filter(b => b.owner_id === ownerId && b.ocr_amount != null)
  return read.length ? Number(read[read.length - 1].ocr_amount) : null
}
/** A mode the grade's policy does not give (a car below MM3, a flight, a taxi…): it needs prior approval. */
export function outOfPolicy(mode: ModeCode, rule: Rule | undefined) {
  return !!rule && ((mode === 'car' && !rule.car_rate) || (mode === 'bike' && !rule.bike_rate) || (mode === 'flight' && !rule.flight) || (mode === 'taxi' && !rule.taxi))
}
/** What the red mark on such a ride means, said when it is pressed. */
export const policyNote = (mode: string, grade: string | null | undefined) =>
  `${mode} is not in ${grade ? `grade ${grade}'s` : 'this grade’s'} travel policy, so it needs the manager's prior approval.`

/** A bill into the private bucket, then recorded; the same file twice is refused by the database. */
export async function uploadBill(claimId: string, kind: Bill['owner_kind'], ownerId: string, file: File, read: { amount: number | null; date: string | null; billno: string | null; refs?: string[] }) {
  const [hash, ph, ph2] = await Promise.all([sha256(file), dhash(file), dhash256(file)])
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${claimId}/${newId()}.${ext}`
  const { data: dupe } = await supabase.rpc('te_bill_used', { p_sha256: hash })
  if (dupe) throw new Error(`Same bill as ${dupe}`)
  const { error: up } = await supabase.storage.from('te-bills').upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (up) throw new Error(friendlyError(up))
  const { error } = await supabase.rpc('te_add_bill', {
    p_claim: claimId, p_kind: kind, p_owner: ownerId, p_path: path, p_name: file.name, p_sha256: hash,
    p_phash: ph, p_phash2: ph2, p_amount: read.amount, p_date: read.date, p_billno: read.billno, p_refs: read.refs ?? [],
  })
  if (error) { await supabase.storage.from('te-bills').remove([path]); throw new Error(friendlyError(error)) }
}
/** A ticket's service report, a PDF or a photo (te_0037): kept like a bill, never read for an amount. */
export async function uploadReport(claimId: string, ticketId: string, file: File) {
  const hash = await sha256(file)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${claimId}/${newId()}.${ext}`
  const { data: dupe } = await supabase.rpc('te_bill_used', { p_sha256: hash })
  if (dupe) throw new Error(`Same file as ${dupe}`)
  const { error: up } = await supabase.storage.from('te-bills').upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (up) throw new Error(friendlyError(up))
  const { error } = await supabase.rpc('te_add_bill', {
    p_claim: claimId, p_kind: 'report', p_owner: ticketId, p_path: path, p_name: file.name, p_sha256: hash,
    p_phash: null, p_phash2: null, p_amount: null, p_date: null, p_billno: null,
  })
  if (error) { await supabase.storage.from('te-bills').remove([path]); throw new Error(friendlyError(error)) }
}
export async function billUrl(path: string) {
  const { data } = await supabase.storage.from('te-bills').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

// ---------------------------------------------------------------- data
const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendlyError(error))
  return data as T
}
export const useMyClaims = () => useQuery({
  queryKey: ['te_my_claims'],
  queryFn: () => rpc<Array<{ id: string; month: string; part: number; status: string; number: string | null; total: number; days: number; first_day: string | null; last_day: string | null; km: number; modes: ModeCode[]; tickets: number; bills_missing: number; submitted_at: string | null; returned_at: string | null; places: string[]; find: string; deputation: string | null }>>('te_my_claims'),
})
export const useClaim = (id: string | undefined) => useQuery({
  queryKey: ['te_claim', id], enabled: !!id,
  queryFn: () => rpc<ClaimData>('te_claim', { p_claim: id }),
})
export const useInbox = (enabled = true) => useQuery({
  queryKey: ['te_inbox'], enabled,
  queryFn: () => rpc<Array<{ id: string; month: string; part: number; status: string; number: string | null; total: number; name: string; ecode: string; submitted_at: string | null; waiting: boolean; days: number; first_day: string | null; last_day: string | null; km: number; modes: ModeCode[]; tickets: number; places: string[]; find: string; deputation: string | null; employee_id: string; cost_centre: string | null; route_from: string | null; route_to: string | null; travel: number; da: number; hotel: number; other: number }>>('te_inbox'),
})
export interface Summary {
  mine: { claimed: number; sent_back: number; pending: number; approved: number; paid: number; claims: number
    travel: number; da: number; hotel: number; other: number; days: number; tickets: number; km: number
    bike_km: number; car_km: number; auto: number; phone: number }
  limits: { grade: string | null; bike_km: number | null; car_km: number | null; auto: number; phone: number }
  scope: 'team' | 'all'
  team: Array<{ ecode: string; name: string; claims: number; claimed: number; pending: number; approved: number; paid: number; waiting: number }>
}
export const useSummary = (from: string | null, to: string | null) => useQuery({
  queryKey: ['te_summary', from, to],
  queryFn: () => rpc<Summary>('te_summary', { p_from: from, p_to: to }),
})
export function useClaimAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fn, args }: { fn: string; args: Record<string, unknown> }) => rpc<unknown>(fn, args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['te_summary'] }); void qc.invalidateQueries({ queryKey: ['te_claim'] }); void qc.invalidateQueries({ queryKey: ['te_my_claims'] }); void qc.invalidateQueries({ queryKey: ['te_inbox'] }) },
  })
}
export { rpc }
