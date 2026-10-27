import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BedDouble, Building2, CalendarDays, Map as MapIcon, MapPin, Plus, RotateCcw, ReceiptIndianRupee, Route, ScanLine, Sparkles, Ticket as TicketIcon, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PlacePicker from '@/components/PlacePicker'
import RouteMap from '@/components/RouteMap'
import BillButton from '@/components/BillButton'
import ReportButton from '@/components/ReportButton'
import ModePicker from '@/components/ModePicker'
import { useAsk } from '@/components/Ask'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'
import Budget, { advanceLine, advanceTakes, budgetLines, dayUse, monthLong } from '@/components/Budget'
import { Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { hotelQueries, ticketQueries, type HotelStay, type TicketRoute } from '@/lib/ticket'
import { useAuth } from '@/contexts/AuthContext'
import {
  DA_KINDS, EXPENSE_CATEGORIES, kmWay, autoDa, districtOf, MODES, daFor, hotelLimit, isBreakdown, km, kmCanReach, kmChanged, kmOutside, kmRange, money, monthName, needsBill, newId,
  areaOf, billRead, companyOf, dayTotal, distanceKm, lookupPlace, outOfPolicy, rideAmount, roadKm, visitedPlaces, type ClaimData, type ReturnLeg, type Day, type DaKind, type ModeCode, type Place, type Ride,
} from '@/lib/claims'
import { depOn, sameState } from '@/lib/deputation'

/*
  One day of the claim (the user, 17 Oct: day cards): when, why, the rides with their places picked
  on the map, the tickets attended, the DA, a hotel night and other expenses, each with its bills.
  Saved as a whole with te_save_day.
*/
export function blankDay(day: string): Day {
  // No DA until the day's places decide it, or the person chooses one (the user, 21 Oct): none claimed unnoticed.
  return { id: newId(), day, place: '', district: '', purpose: null, da_kind: 'none', da_amount: 0, continues_day: null, remarks: '', rides: [], tickets: [], hotel: null, expenses: [] }
}
// A flight, a train and a hotel night always say why (the user, 21 Oct: "remarks mandatory").
const REMARKS_NEEDED = new Set(['flight', 'train'])
// A ticket that says where it goes (the user, 21 Oct).
const TICKETED = new Set(['flight', 'train', 'bus'])
const placeKey = (s: string | null | undefined) => (s ?? '').split(',')[0].trim().toLowerCase()
// The next ride starts with the last one's purpose and call centre (te_0060; the user, 23 Oct).
const blankRide = (from?: Place | null, carry?: Pick<Ride, 'purpose' | 'project'> | null): Ride => ({
  id: newId(), mode: 'bike', from_name: from?.name ?? null, from_lat: from?.lat ?? null, from_lng: from?.lng ?? null,
  to_name: null, to_lat: null, to_lng: null, claimed_km: null, map_km: null, fare: null,
  purpose: carry?.purpose ?? null, project: carry?.project ?? null, ticket_no: '',
})
/** A breakdown ride's ticket ID, from the ticket kept under the ride's id (te_0060). */
const withTickets = (day: Day): Day => ({ ...day, rides: day.rides.map(r => ({ ...r, ticket_no: r.ticket_no ?? day.tickets.find(t => t.id === r.id)?.ticket_no ?? '' })) })

/*
  An amount a bill can fill says so (the user, 26 Oct: management wants people to know attaching a bill fills it in):
  empty, a scan mark at its end; filled with what the bill reads, a spark. Its input leaves room with pr-7.
*/
function BillHint({ value, read }: { value: number | null | undefined; read: number | null }) {
  const at = 'pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-700'
  if (!value) return <ScanLine className={`bill-scan ${at}`} aria-hidden />
  return read != null && Math.abs(read - value) <= 1 ? <Sparkles className={`bill-spark ${at}`} aria-label="Read from the bill" /> : null
}

/*
  What is typed is kept in this browser until it is saved, so going back and coming again finds it as
  it was (the user, 21 Oct: "when I go back and click edit, purpose, project, all are gone, need to save
  then back"). One copy for a day already on the claim, one for a day not saved yet.
*/
type Kept = { day: Day; hdr: { project: string; base: string; mobile: string } }
const keptKey = (claim: string, day: string | null) => `te-form:${claim}:${day ?? 'new'}`
function readKept(key: string): Kept | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as Kept) : null } catch { return null }
}
function writeKept(key: string, k: Kept | null) {
  try { if (k) localStorage.setItem(key, JSON.stringify(k)); else localStorage.removeItem(key) } catch { /* a private window keeps nothing */ }
}

export default function DayEditor({ data, initial: raw, chosen = false, onClose }: {
  data: ClaimData; initial: Day
  /** Opened on a date picked from the calendar: a kept new day takes that date. */
  chosen?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const initial = useMemo(() => withTickets(raw), [raw])
  const { employee } = useAuth()
  const ask = useAsk()
  const saved = data.days.some(x => x.id === initial.id)
  const key = keptKey(data.claim.id, saved ? initial.id : null)
  const header = { project: data.claim.project ?? '', base: data.claim.base_location ?? '', mobile: data.claim.mobile ?? '' }
  const [kept] = useState(() => readKept(key))
  const start: Day = kept ? { ...kept.day, ...(chosen && !saved ? { day: initial.day } : {}) } : initial
  const [d, setD] = useState<Day>(start)
  const [picking, setPicking] = useState<{ ride: string; end: 'from' | 'to' } | null>(null)
  // One ride on the map, from its own card (the user, 21 Oct: "option to view in map in each mode").
  const [mapRide, setMapRide] = useState<Ride | null>(null)
  // The claim's details, kept in the form with everything else (the user, 17 Oct).
  const [hdr, setHdr] = useState(kept?.hdr ?? header)
  const changed = JSON.stringify({ ...d, id: initial.id }) !== JSON.stringify(initial) || JSON.stringify(hdr) !== JSON.stringify(header)
  useEffect(() => { writeKept(key, changed ? { day: d, hdr } : null) }, [key, changed, d, hdr])
  // Back to how it was saved, or an empty form for a new day.
  const undo = async () => {
    if (!(await ask.confirm({ title: 'Undo your changes?', body: saved ? 'The day goes back to how it was saved.' : 'The form is cleared.', yes: 'Undo', danger: true }))) return
    // The bills attached to rides that go with the undo go too, or they would stand as "the same bill" next time.
    await dropBills(d.rides.filter(r => !initial.rides.some(x => x.id === r.id)).map(r => r.id))
    writeKept(key, null); setD(initial); setHdr(header); setErr(null)
  }
  /*
    A bill is stored the moment it is attached; a ride taken off the form takes its bills with it (the user, 22 Oct:
    removed the ride, attached the ticket again, and it was refused as the same bill).
  */
  const dropBills = async (owners: string[]) => {
    const gone = data.bills.filter(b => owners.includes(b.owner_id))
    for (const b of gone) {
      const { data: path } = await supabase.rpc('te_remove_bill', { p_bill: b.id })
      if (path) await supabase.storage.from('te-bills').remove([path as string])
    }
    if (gone.length) refresh()
  }
  const removeRide = async (id: string) => {
    const n = data.bills.filter(b => b.owner_id === id).length
    if (n && !(await ask.confirm({ title: 'Remove this ride?', body: `Its ${n === 1 ? 'bill comes' : n + ' bills come'} off too.`, yes: 'Remove', danger: true }))) return
    await dropBills([id])
    set({ rides: latest.current.rides.filter(x => x.id !== id) })
  }
  const [projects, setProjects] = useState<string[]>([])
  useEffect(() => { void supabase.rpc('te_projects').then(({ data: p }) => setProjects(((p ?? []) as Array<{ label: string }>).map(x => x.label))) }, [])
  const [busy, setBusy] = useState(false)
  const [dating, setDating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [home, setHome] = useState<Place | null>(null)
  const [homeReady, setHomeReady] = useState(false)
  const [who, setWho] = useState<Array<{ ecode: string; full_name: string }>>([])
  const nav = useNavigate()
  /*
    Discard (the user, 19 Oct: "when I'm clicking Add a claim the old draft is showing, which is good, still
    need a discard, so that I can start from fresh"): the draft and its bills go — from My claims too — and the
    person is back on My claims with nothing left behind; Add a claim starts a new one (the user, 22 Oct: a fresh
    empty draft opening in its place looked as if the discard had not happened). Only an unsent draft.
  */
  const discard = async () => {
    const n = data.days.length
    if (!(await ask.confirm({ title: `Discard the ${monthName(c.month)} draft?`, body: n ? `Its ${n} day${n > 1 ? 's' : ''} and bills are deleted.` : 'The draft is deleted.', yes: 'Discard', danger: true }))) return
    setBusy(true); setErr(null)
    try {
      const paths = data.bills.map(b => b.path)
      if (paths.length) await supabase.storage.from('te-bills').remove(paths)
      const { error: de } = await supabase.rpc('te_delete_claim', { p_claim: c.id })
      if (de) throw de
      writeKept(key, null); writeKept(keptKey(c.id, null), null)
      void qc.invalidateQueries({ queryKey: ['te_my_claims'] }); void qc.invalidateQueries({ queryKey: ['te_summary'] })
      nav('/claims', { replace: true })
    } catch (e) { setErr(friendlyError(e as never)) } finally { setBusy(false) }
  }
  const c = data.claim, rule = data.rule
  // The km box being typed in: under the map's km is not called out until it is left (8 on the way to 8.8).
  const [typingKm, setTypingKm] = useState<string | null>(null)
  const over = Number(data.policy.bill_over ?? 300), metroPct = Number(data.policy.metro_extra_pct ?? 20), tol = Number(data.policy.km_tolerance_pct ?? 10)
  const outOfState = d.da_kind === 'out_state_stay'
  // The day's purpose for its DA: a ride that gives DA, else the first (an office day has none).
  const dayPurpose = d.rides.find(r => r.purpose && !data.office_purposes.includes(r.purpose))?.purpose ?? d.rides.find(r => r.purpose)?.purpose ?? d.purpose
  // The approved deputation the day is inside (te_0075): its DA, the same for every grade.
  const dep = depOn(data.deputations, d.day), depDa = Number(data.policy.deputation_da ?? 800)
  const da = daFor(rule, d.da_kind, dayPurpose, data.office_purposes, depDa)
  /*
    Where a new ride's purpose and call centre come from: the last ride of this day, else of the latest earlier day.
    A day's first ride starts on the person's own cost centre (te_0063; the user, 24 Oct: "on add claim, we need
    defaulty show his cost centre only"), else the earlier day's, else the claim's project.
  */
  const carry = (): Pick<Ride, 'purpose' | 'project'> => {
    const last = latest.current.rides[latest.current.rides.length - 1]
    if (last) return { purpose: last.purpose ?? null, project: last.project ?? null }
    const before = [...data.days].filter(x => x.id !== initial.id && x.day < latest.current.day && x.rides.length).sort((a, b) => a.day.localeCompare(b.day)).pop()
    const r = before?.rides[before.rides.length - 1]
    return { purpose: r?.purpose ?? null, project: c.cost_centre || r?.project || c.project || null }
  }
  /*
    The km box takes the map's km as soon as the map has the road (te_0060; the user, 23 Oct). Typed otherwise, it is
    kept — and the approver sees the change. A km the map put in follows the map when the places change.
  */
  const autoKm = useRef(new Map<string, number>())
  const kmKey = d.rides.map(r => `${r.id}:${r.mode}:${r.map_km ?? ''}`).join('|')
  useEffect(() => {
    for (const r of latest.current.rides) {
      if (!MODES[r.mode].perKm || r.map_km == null) continue
      const was = autoKm.current.get(r.id)
      if (r.claimed_km == null || (was != null && r.claimed_km === was)) {
        autoKm.current.set(r.id, r.map_km)
        if (r.claimed_km !== r.map_km) setRide(r.id, { claimed_km: r.map_km })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmKey])
  const set = (p: Partial<Day>) => setD(x => ({ ...x, ...p }))
  const setRide = (id: string, p: Partial<Ride>) => setD(x => ({ ...x, rides: x.rides.map(r => (r.id === id ? { ...r, ...p } : r)) }))
  const refresh = () => void qc.invalidateQueries({ queryKey: ['te_claim', c.id] })
  const firstDay = c.month.slice(0, 8) + '01'
  const monthEnd = new Date(new Date(c.month + 'T00:00:00').getFullYear(), new Date(c.month + 'T00:00:00').getMonth() + 1, 0).toLocaleDateString('en-CA')
  // Never a future date (the user, 17 Oct).
  const today = new Date().toLocaleDateString('en-CA')
  const lastDay = monthEnd < today ? monthEnd : today

  useEffect(() => {
    if (!employee) return
    void supabase.from('travel_homes').select('lat, lng').eq('employee_id', employee.id).maybeSingle()
      .then(({ data: h }) => { if (h) setHome({ name: 'Home', lat: h.lat, lng: h.lng }); setHomeReady(true) })
  }, [employee])

  // The hotel of the night, found from its voucher: one tap for the ride to it, or from it (the user, 21 Oct).
  const [stayAt, setStayAt] = useState<(Place & { label: string }) | null>(null)
  // Home, the hotel, then places already used this month.
  const quick = useMemo(() => {
    const seen = new Map<string, Place & { home?: boolean; stay?: boolean; label?: string }>()
    if (home) seen.set('Home', { ...home, home: true })
    if (stayAt) seen.set('@stay', { ...stayAt, stay: true })
    for (const day of [...data.days, d]) for (const r of day.rides) {
      if (r.from_name && r.from_lat != null && !seen.has(r.from_name)) seen.set(r.from_name, { name: r.from_name, lat: r.from_lat, lng: r.from_lng! })
      if (r.to_name && r.to_lat != null && !seen.has(r.to_name)) seen.set(r.to_name, { name: r.to_name, lat: r.to_lat, lng: r.to_lng! })
    }
    return [...seen.values()].slice(0, 10).map(p => ({ ...p, label: p.label ?? p.name.split(',')[0] }))
  }, [home, stayAt, data.days, d])

  /*
    The DA follows the day's places (the user, 18 Oct): worked out again whenever a place or the hotel
    night changes, and set. The person can still choose another; a day already saved keeps its choice
    until its places change.
  */
  const [auto, setAuto] = useState<DaKind | null>(start.da_auto ?? null)
  // A place of the day outside the deputation's state ("Bengaluru, Karnataka"): the approvers' red observation.
  const [off, setOff] = useState<string | null>(start.dep_off ?? null)
  const stops = useMemo(() => {
    const ps: Place[] = []
    for (const r of d.rides) {
      if (r.from_lat != null) ps.push({ name: '', lat: r.from_lat, lng: r.from_lng! })
      if (r.to_lat != null) ps.push({ name: '', lat: r.to_lat, lng: r.to_lng! })
    }
    return ps
  }, [d.rides])
  const stay = !!(d.hotel || d.room_by)
  const stopsKey = stops.map(p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|') + (stay ? '|stay' : '')
  const depKey = dep ? `|dep:${dep.state}:${dep.from_day}:${dep.to_day}` : ''
  const applied = useRef(saved || kept ? stopsKey + depKey : '')
  useEffect(() => {
    if (!stops.length || !homeReady) return
    let live = true
    void (async () => {
      let k = await autoDa(home, stops, stay), outside: string | null = null
      // Inside a deputation, every place in its state gives the deputation DA (the user, 26 Oct: "if the claim is from
      // that state only we can claim in deputation"); one in another state is kept, and the day takes the usual DA.
      if (dep) {
        for (const p of stops) {
          const a = await areaOf(p.lat, p.lng)
          if (!sameState(a.state, dep.state)) { outside = [a.district, a.state].filter(Boolean).join(', '); break }
        }
        if (!outside) k = 'deputation'
      }
      if (!live || !k) return
      setAuto(k); setOff(outside)
      if (applied.current !== stopsKey + depKey) { applied.current = stopsKey + depKey; set({ da_kind: k }) }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, homeReady, depKey])
  // A new day inside a deputation with no rides yet is a day at the site; a day moved out of it loses that DA.
  useEffect(() => {
    if (dep && !saved && !kept && !stops.length && d.da_kind === 'none') set({ da_kind: 'deputation' })
    if (!dep && d.da_kind === 'deputation') { set({ da_kind: auto && auto !== 'deputation' ? auto : 'none' }); setOff(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey])
  // The hospitals a ticket is chosen from: where the day's rides went (the user, 21 Oct).
  const visited = visitedPlaces(d.rides)
  // The month's budget with this day as it is now in the form: saved use, less this day as saved, plus this day now.
  const was = dayUse(data.days.find(x => x.id === initial.id)), now = dayUse(d), km0 = data.km_month
  // The claim as it would be with this day as it is now, for the Advance meter: what it pays, less the late cut.
  const claimNow = data.days.filter(x => x.id !== initial.id).reduce((t, x) => t + dayTotal({ ...x, hotel: x.room_by ? null : x.hotel }, rule), 0)
    + dayTotal({ ...d, hotel: d.room_by ? null : d.hotel }, rule)
  const adv = advanceLine(c.advance_box, advanceTakes(c.advance_box, claimNow - Math.round(claimNow * (c.late_pct / 100))))
  const budget = [...budgetLines(rule, data.policy, {
    bike: km0.bike - was.bike + now.bike, car: km0.car - was.car + now.car,
    auto: km0.auto - was.auto + now.auto, phone: (km0.phone ?? 0) - was.phone + now.phone,
  }), ...(adv ? [adv] : [])]

  // Road km once both ends of a ride are picked.
  /*
    The next ride starts where this one now ends (the user, 22 Oct: the flight's end put right to Vijayawada, but the
    ride after it still started at Cochin, and its hotel was searched near home): its From follows this ride's To
    when it was still the old To, or empty, and its road is worked out again.
  */
  const chainNext = async (rideId: string, was: { lat: number | null; lng: number | null }, p: Place) => {
    const rides = latest.current.rides, i = rides.findIndex(x => x.id === rideId), nx = rides[i + 1]
    if (!nx) return
    const same = nx.from_lat == null || (was.lat != null && Math.abs(nx.from_lat - was.lat) < 1e-5 && Math.abs((nx.from_lng ?? 0) - (was.lng ?? 0)) < 1e-5)
    if (!same || (nx.from_lat === p.lat && nx.from_lng === p.lng)) return
    setRide(nx.id, { from_name: p.name, from_lat: p.lat, from_lng: p.lng, map_km: null })
    if (nx.to_lat != null) setRide(nx.id, { map_km: (await roadKm(p, { name: '', lat: nx.to_lat, lng: nx.to_lng! }, nx.mode))?.km ?? null })
  }
  const placed = async (rideId: string, end: 'from' | 'to', p: Place, named = false) => {
    setPicking(null)
    const r = d.rides.find(x => x.id === rideId)!
    if (end === 'to') void chainNext(rideId, { lat: r.to_lat, lng: r.to_lng }, p)
    const next = end === 'from'
      ? { ...r, from_name: p.name, from_lat: p.lat, from_lng: p.lng, from_named: named }
      : { ...r, to_name: p.name, to_lat: p.lat, to_lng: p.lng, to_named: named }
    setRide(rideId, { ...next, map_km: null })
    if (next.from_lat != null && next.to_lat != null) {
      const road = await roadKm({ name: '', lat: next.from_lat, lng: next.from_lng! }, { name: '', lat: next.to_lat, lng: next.to_lng! }, next.mode)
      setRide(rideId, { map_km: road?.km ?? null })
    }
  }

  /*
    A flight, train or bus ticket fills the ride's From and To (the user, 21 Oct: "from and to is there, so
    can we auto fetch"): only an end not picked yet, or a From still at Home — what the engineer picked stays.
  */
  const latest = useRef(d); latest.current = d
  const fillFromTicket = async (rideId: string, route: TicketRoute, mode?: ModeCode | null, refs: string[] = []) => {
    const r0 = latest.current.rides.find(x => x.id === rideId)
    if (!r0) return
    // The mode the ticket showed, set a moment ago, is not in the form's state yet.
    const as = mode ?? r0.mode
    if (!TICKETED.has(as)) return
    // The date the ticket is for, kept on the ride so a ticket for another day shows (te_0057; the user, 22 Oct).
    const tdate = route.journeys?.[0]?.date ?? null
    if (tdate) setRide(rideId, { ticket_date: tdate })
    // A round trip: its return kept on this ride, offered on its own day when the engineer gets there (te_0058).
    if ((route.journeys?.length ?? 0) > 1) {
      const j = route.journeys![1]
      setRide(rideId, { return_leg: { ref: refs.find(x => /^N[A-Z]/.test(x)) ?? refs[0] ?? 'the same booking', date: j.date, from: j.cityFrom, to: j.cityTo, mode: as, day: d.day } })
    }
    const q = ticketQueries(as, route)
    if (!q) return
    const near = home ?? undefined
    const wantFrom = r0.from_lat == null || placeKey(r0.from_name) === 'home', wantTo = r0.to_lat == null
    const fromCity = route.journeys?.[0]?.cityFrom ?? route.cityFrom ?? route.from, toCity = route.journeys?.[0]?.cityTo ?? route.cityTo ?? route.to
    let [pf, pt] = await Promise.all([wantFrom && q.from.length ? lookupPlace(q.from, q.want, near, fromCity) : null, wantTo && q.to.length ? lookupPlace(q.to, q.want, near, toCity) : null])
    // A ride does not end where it starts: an end found next to the start is left for the engineer to pick.
    const start = pf ?? (r0.from_lat != null ? { lat: r0.from_lat, lng: r0.from_lng! } : null)
    if (pt && start && distanceKm(start, pt) < 20) pt = null
    if (!pf && !pt) return
    const r1 = latest.current.rides.find(x => x.id === rideId)
    if (!r1) return
    if (pt) void chainNext(rideId, { lat: r1.to_lat, lng: r1.to_lng }, pt)
    const next = { ...r1, ...(pf ? { from_name: pf.name, from_lat: pf.lat, from_lng: pf.lng } : {}), ...(pt ? { to_name: pt.name, to_lat: pt.lat, to_lng: pt.lng } : {}), map_km: null }
    setRide(rideId, next)
    if (next.from_lat != null && next.to_lat != null) {
      const road = await roadKm({ name: '', lat: next.from_lat, lng: next.from_lng! }, { name: '', lat: next.to_lat, lng: next.to_lng! }, as)
      setRide(rideId, { map_km: road?.km ?? null })
    }
  }
  /*
    A ride turned into a train, the metro or a flight, or back, has its km worked out again on the tracks, through the
    air or by road (the user, 23 Oct: "if train or metro, can we get their respective mode km?", "what about flight?").
  */
  const railKey = d.rides.map(r => `${r.id}:${kmWay(r.mode)}`).join('|')
  const railWas = useRef(railKey)
  useEffect(() => {
    const before = new Map(railWas.current.split('|').map(x => x.split(':') as [string, string]))
    railWas.current = railKey
    for (const r of latest.current.rides) {
      const now = kmWay(r.mode)
      if (!before.has(r.id) || before.get(r.id) === now || r.from_lat == null || r.to_lat == null) continue
      void roadKm({ name: '', lat: r.from_lat, lng: r.from_lng! }, { name: '', lat: r.to_lat, lng: r.to_lng! }, r.mode)
        .then(road => { const r1 = latest.current.rides.find(x => x.id === r.id); if (r1 && r1.mode === r.mode) setRide(r.id, { map_km: road?.km ?? null }) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railKey])
  /*
    The return of a round-trip ticket (te_0056, te_0058; the user, 22 Oct: Kochi to Vijayawada on 7 Aug and back on
    9 Aug, one booking, one fare): its fare stays on the going ride, and the return, added with one tap on its own day
    whenever the engineer adds that day, is a ride that claims ₹0 and needs no bill, marked with what the ticket said.
  */
  const [adding, setAdding] = useState<string | null>(null)
  const addReturn = async (leg: ReturnLeg) => {
    setAdding(leg.ref)
    const as = leg.mode, j = { cityFrom: leg.from, cityTo: leg.to, date: leg.date }, ref = leg.ref
    const here = new Date(leg.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const q = ticketQueries(as, { cityFrom: j.cityFrom, cityTo: j.cityTo })
    const [pf, pt0] = q ? await Promise.all([lookupPlace(q.from, q.want, home ?? undefined, j.cityFrom), lookupPlace(q.to, q.want, home ?? undefined, j.cityTo)]) : [null, null]
    const pt = pt0 && pf && distanceKm(pf, pt0) < 20 ? null : pt0
    const ride: Ride = {
      ...blankRide(null, carry()), mode: as,
      from_name: pf?.name ?? null, from_lat: pf?.lat ?? null, from_lng: pf?.lng ?? null,
      to_name: pt?.name ?? null, to_lat: pt?.lat ?? null, to_lng: pt?.lng ?? null,
      fare: 0, note: `On the ${here} ticket · ${ref}`, ticket_date: j.date,
      same_ticket: { ref, day: leg.day, from: j.cityFrom, to: j.cityTo, date: j.date, fromLat: pf?.lat, fromLng: pf?.lng, toLat: pt?.lat, toLng: pt?.lng },
    }
    if (pf && pt) ride.map_km = (await roadKm(pf, pt, as))?.km ?? null
    setD(x => ({ ...x, rides: [...x.rides, ride] }))
    setAdding(null)
  }
  // Returns on tickets whose return is this day, not yet added anywhere on the claim.
  const everyRide = [...data.days.filter(x => x.id !== initial.id).flatMap(x => x.rides.map(r => ({ r, day: x.day }))), ...d.rides.map(r => ({ r, day: d.day }))]
  const returnsHere = everyRide.filter(({ r }) => r.return_leg?.date === d.day && !everyRide.some(o => o.r.same_ticket?.ref === r.return_leg!.ref))
  const returnAdded = (leg: ReturnLeg) => everyRide.some(o => o.r.same_ticket?.ref === leg.ref)
  // A ride entered by hand that is a ticket's return, found by attaching that ticket: linked, not a second bill (te_0059).
  const linkReturn = (rideId: string, refs: string[]) => {
    const go = everyRide.find(({ r }) => r.id !== rideId && r.return_leg && refs.includes(r.return_leg.ref))
    if (!go) return false
    const leg = go.r.return_leg!, here = new Date(leg.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const r0 = latest.current.rides.find(x => x.id === rideId)
    setRide(rideId, { mode: leg.mode, claimed_km: null, fare: 0, ticket_date: leg.date, note: r0?.note?.trim() || `On the ${here} ticket · ${leg.ref}`, same_ticket: { ref: leg.ref, day: leg.day, from: leg.from, to: leg.to, date: leg.date } })
    void ask.alert('Linked to your ticket', `This is the return on your ${here} ticket. It claims ₹0 and needs no bill of its own.`)
    return true
  }
  /*
    Whether each bus ride leaves its district or state, from the map, once both its places are known (te_0048;
    the user, 21 Oct): within the district its ticket is not needed.
  */
  const busKey = d.rides.filter(r => r.mode === 'bus' && r.from_lat != null && r.to_lat != null)
    .map(r => `${r.id}:${r.from_lat!.toFixed(3)},${r.from_lng!.toFixed(3)},${r.to_lat!.toFixed(3)},${r.to_lng!.toFixed(3)}`).join('|')
  useEffect(() => {
    let live = true
    void (async () => {
      for (const r of latest.current.rides) {
        if (r.mode !== 'bus' || r.from_lat == null || r.to_lat == null) continue
        const [a, b] = await Promise.all([areaOf(r.from_lat, r.from_lng!), areaOf(r.to_lat, r.to_lng!)])
        const same = (x: string | null, y: string | null) => !!x && !!y && x.toLowerCase() === y.toLowerCase()
        const inter = !a.district || !b.district ? null : !(same(a.district, b.district) && same(a.state, b.state))
        if (live && r.inter !== inter) setRide(r.id, { inter })
      }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busKey])
  const fillFromVoucher = async (stay: HotelStay) => {
    if (stay.name && latest.current.hotel && !latest.current.hotel.name?.trim()) setD(x => (x.hotel ? { ...x, hotel: { ...x.hotel, name: stay.name! } } : x))
    const p = await lookupPlace(hotelQueries(stay), 'any', home ?? undefined)
    if (p) setStayAt({ ...p, label: (stay.name ?? p.name).split(',')[0] })
  }

  const findPeople = async (q: string) => {
    if (q.trim().length < 2) { setWho([]); return }
    const { data: ppl } = await supabase.rpc('te_people', { p_q: q })
    setWho((ppl ?? []) as Array<{ ecode: string; full_name: string }>)
  }

  /*
    What still stands between the day and Save, in the order of the form, each with the line it belongs to (the user,
    23 Oct: a courier saved without its bill showed up only as the approver's "no invoice"; "the engineer should see
    what to do to save it"). Save is greyed while any is left; the first is said beside it, a press goes there.
  */
  const billed = new Set(data.bills.map(b => b.owner_id))
  const blockers: Array<{ text: string; to: string }> = []
  if (!d.day) blockers.push({ text: 'Choose the date', to: 'day-date' })
  else if (d.day > lastDay) blockers.push({ text: 'A future date cannot be claimed', to: 'day-date' })
  for (const [i, r] of d.rides.entries()) {
    const n = `ride ${i + 1}`, to = 'ride-' + r.id, m = MODES[r.mode]
    if (r.from_lat == null || r.to_lat == null) blockers.push({ text: `Pick the from and to of ${n} on the map`, to })
    if (m.perKm && !r.claimed_km) blockers.push({ text: `Type the km of ${n}`, to })
    // The band itself is not shown, or everyone types its top (the user, 26 Oct: "dont show them this").
    else if (m.perKm && kmOutside(r, tol)) blockers.push({ text: `The km of ${n} does not match the map (${km(r.map_km)})`, to })
    if (!m.perKm && r.fare == null) blockers.push({ text: `Type the fare of ${n}`, to })
    if (!r.purpose) blockers.push({ text: `Choose the purpose of ${n}`, to })
    if (!r.project) blockers.push({ text: `Choose the call centre of ${n}`, to })
    if (isBreakdown(r.purpose) && !r.ticket_no?.trim()) blockers.push({ text: `Enter the ticket ID of ${n}`, to })
    if (REMARKS_NEEDED.has(r.mode) && !r.note?.trim()) blockers.push({ text: `Write the remarks of ${n} (${m.label.toLowerCase()})`, to })
    if (needsBill('ride', r, over, rule) && !billed.has(r.id)) blockers.push({ text: `Attach the bill of ${n} · ${money(rideAmount(r, rule))}`, to })
  }
  if (d.hotel && !d.room_by && (d.hotel.amount > 0 || companyOf(data.bills, d.hotel))) {
    const to = 'hotel-' + d.hotel.id
    if (!d.hotel.note?.trim()) blockers.push({ text: 'Write the remarks of the hotel night', to })
    if (needsBill('hotel', d.hotel, over) && !billed.has(d.hotel.id)) blockers.push({ text: `Attach the hotel bill · ${money(d.hotel.amount)}`, to })
  }
  for (const x of d.expenses) {
    const to = 'exp-' + x.id
    if (!x.amount) { blockers.push({ text: `Type the amount of the ${x.category.toLowerCase()} expense`, to }); continue }
    if (needsBill('expense', x, over) && !billed.has(x.id)) blockers.push({ text: `Attach the bill for ${x.category} · ${money(x.amount)}`, to })
  }
  const goTo = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-amber-400'); window.setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1800)
  }

  const save = async () => {
    setErr(null)
    if (blockers.length) {
      await ask.alert('To save, still needed', blockers.map(b => `• ${b.text}`).join('\n'), 'warn')
      goTo(blockers[0].to)
      return
    }
    let joined = d.continues_day
    if (joined) { const n = new Date(joined + 'T00:00:00'); n.setDate(n.getDate() + 1); if (n.toLocaleDateString('en-CA') !== d.day) joined = null }
    setBusy(true)
    /*
      The day's place is where its rides went, and its district theirs (the user, 21 Oct: "what if I went
      to 2-3 hospitals? … that we are showing in trip also, so that field needed there?").
    */
    const ends = d.rides.filter(r => r.to_lat != null && placeKey(r.to_name) !== 'home')
    const distOf = new Map(await Promise.all(ends.map(async r => [r.id, await districtOf(r.to_lat!, r.to_lng!).catch(() => null)] as const)))
    const dists = [...new Set([...distOf.values()].filter(Boolean))]
    // A breakdown ride's ticket, under the ride's id, with its hospital and district (te_0038, te_0060); a ticket from before stays.
    const rideIds = new Set(d.rides.map(r => r.id))
    const tickets = [
      ...d.rides.filter(r => isBreakdown(r.purpose) && r.ticket_no?.trim()).map(r => ({
        id: r.id, ticket_no: r.ticket_no!.trim(), service_report: null, place: (r.to_name ?? '').split(',')[0].trim() || null, district: distOf.get(r.id) ?? null,
      })),
      ...d.tickets.filter(t => !rideIds.has(t.id)).map(t => { const r = ends.find(x => placeKey(x.to_name) === placeKey(t.place)); return { ...t, district: r ? distOf.get(r.id) ?? null : null } }),
    ]
    // The claim's project, for its sheet: the first ride's call centre.
    const firstProject = d.rides.find(r => r.project)?.project ?? hdr.project
    const place = visited.length ? visited.join(' · ') : d.place
    const district = dists.length ? dists.join(', ') : d.district
    if (firstProject !== (c.project ?? '') || hdr.base !== (c.base_location ?? '') || hdr.mobile !== (c.mobile ?? '')) {
      const { error: he } = await supabase.rpc('te_set_header', { p_claim: c.id, p_project: firstProject, p_base: hdr.base, p_mobile: hdr.mobile })
      if (he) { setBusy(false); setErr(friendlyError(he)); return }
    }
    const { error } = await supabase.rpc('te_save_day', {
      p_claim: c.id,
      p_day: {
        ...d,
        purpose: dayPurpose ?? null,
        place, district, place_lat: null, place_lng: null, tickets,
        continues_day: joined,
        da_auto: auto,
        dep_off: dep ? off : null,
        hotel: d.hotel && (d.hotel.amount > 0 || companyOf(data.bills, d.hotel)) ? { ...d.hotel, shared_ecode: d.hotel.occupancy === 'double' ? d.hotel.shared_ecode ?? null : null } : null,
      },
    })
    if (error) { setBusy(false); setErr(friendlyError(error)); return }
    // Places the map does not have, named by hand on this day: offered to everyone from now on (te_0071; the user,
    // 26 Oct: "not only location with ticket"). The day is saved whatever this says.
    const named = d.rides.flatMap(r => [
      r.from_named && r.from_lat != null ? { name: r.from_name, lat: r.from_lat, lng: r.from_lng, district: null } : null,
      r.to_named && r.to_lat != null ? { name: r.to_name, lat: r.to_lat, lng: r.to_lng, district: distOf.get(r.id) ?? null } : null,
    ]).filter(Boolean)
    if (named.length) await supabase.rpc('te_learn_named_places', { p_day: d.id, p_places: named }).then(() => undefined, () => undefined)
    setBusy(false)
    writeKept(key, null)
    refresh(); void qc.invalidateQueries({ queryKey: ['te_my_claims'] })
    onClose()
  }

  const ride = picking ? d.rides.find(r => r.id === picking.ride) : null
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <div>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="h-4 w-4" /> {c.number ? `Back to ${c.number}` : `Back to the ${monthName(c.month)} claim`}</button>
          <span className="flex items-center gap-4">
            {changed && <button type="button" disabled={busy} onClick={() => void undo()} className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:underline"><RotateCcw className="h-4 w-4" /> Undo changes</button>}
            {c.status === 'draft' && <button type="button" disabled={busy} onClick={() => void discard()} className="inline-flex items-center gap-1 text-sm font-medium text-cyrixRed-700 hover:underline"><Trash2 className="h-4 w-4" /> Discard draft</button>}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">{saved ? 'Edit claim' : 'Add a claim'}</h1>
      </div>
      <Budget title={`Left in ${monthLong(c.month)}`} lines={budget} />
      <div className="card">
        <div className="space-y-5 px-4 py-4">
          {/*
            The trip so far (the user, 22 Oct: "there is no previous linked claim data or amount"): each earlier day of
            it with where it went and what it came to, and the trip's total with this day.
          */}
          {d.continues_day && (() => {
            const chain: Day[] = []
            for (let at: string | null = d.continues_day; at; ) {
              const prev = data.days.find(x => x.day === at && x.id !== d.id)
              if (!prev || chain.includes(prev)) break
              chain.unshift(prev); at = prev.continues_day
            }
            const dn = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
            const amt = (x: Day) => dayTotal({ ...x, hotel: x.room_by ? null : x.hotel }, rule)
            const before = chain.reduce((t, x) => t + amt(x), 0), now = amt(d)
            return (
              <div className="rounded-lg bg-violet-100 px-3 py-2 text-sm text-violet-900">
                <p className="font-semibold">Continues the trip of {dn(d.continues_day)}</p>
                {chain.map(x => (
                  <p key={x.id} className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-xs">
                    <span className="min-w-0">{dn(x.day)} · {x.rides.length ? `${(x.rides[0].from_name ?? '').split(',')[0]} → ${(x.rides[x.rides.length - 1].to_name ?? '').split(',')[0]}` : 'no rides'}</span>
                    <span className="font-semibold tabular-nums">{money(amt(x))}</span>
                  </p>
                ))}
                <p className="mt-1 flex justify-between gap-x-3 border-t border-violet-300 pt-1 text-xs">
                  <span>Trip so far {money(before)} + this day {money(now)}</span>
                  <span className="font-semibold tabular-nums">{money(before + now)}</span>
                </p>
              </div>
            )
          })()}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* The date chosen on the calendar shown, not asked again; a press changes it (the user, 21 Oct). */}
            <div id="day-date"><span className="label">Date</span>
              <button type="button" onClick={() => setDating(true)}
                className="input mt-1 flex h-11 items-center justify-between gap-2 text-left">
                {d.day ? new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Choose…'}
                <CalendarDays className="h-4 w-4 shrink-0 text-ink-400" />
              </button></div>
          </div>

          {/* ---- rides ---- */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-800">Rides</h3>
            {/* A round trip's return due on this day, from the going ride's ticket: added with one tap (te_0058). */}
            {returnsHere.map(({ r, day }) => {
              const leg = r.return_leg!, dn = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              return (
                <div key={leg.ref + r.id} className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3">
                  <TicketIcon className="h-5 w-5 shrink-0 text-sky-700" />
                  <div className="min-w-0 flex-1 text-sm text-sky-900">
                    <p className="font-semibold">Your return on the {dn(day)} ticket · {leg.from} → {leg.to} · ₹0</p>
                    <p className="text-xs">{dn(day)} · {(r.from_name ?? '').split(',')[0]} → {(r.to_name ?? '').split(',')[0]} · {money(r.fare ?? 0)} · {leg.ref}</p>
                  </div>
                  <button type="button" className="btn-primary !py-1.5 text-sm" disabled={adding === leg.ref} onClick={() => void addReturn(leg)}>
                    {adding === leg.ref ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Add this return
                  </button>
                </div>
              )
            })}
            <div className="space-y-3">
              {d.rides.map((r, i) => {
                const m = MODES[r.mode]
                const notAllowed = outOfPolicy(r.mode, rule)
                const read = m.perKm ? null : billRead(data.bills, r.id)
                const placeBtn = (end: 'from' | 'to', name: string | null) => (
                  <button type="button" onClick={() => setPicking({ ride: r.id, end })} style={name ? undefined : { borderColor: m.color + '99', background: m.color + '14' }}
                    className={`btn-lift flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm ${name ? 'border-ink-200 text-ink-900' : 'text-ink-700'}`}>
                    <span className="grid w-4 shrink-0 place-items-center">{end === 'from' ? <span className="h-2.5 w-2.5 rounded-full bg-teal-500" /> : <MapPin className="h-4 w-4 text-cyrixRed-600" />}</span>
                    <span className="w-9 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{end === 'from' ? 'From' : 'To'}</span>
                    <span className="truncate">{name ?? (end === 'from' ? 'Choose where you started' : 'Choose where you went')}</span>
                  </button>
                )
                return (
                  // A soft line and tint in its mode's colour (the user, 17 Oct: "not this much color, like neon").
                  <div key={r.id} id={'ride-' + r.id} className="scroll-mt-24 rounded-xl border p-3 transition-shadow" style={{ borderColor: m.color + '59', background: m.color + '0A' }}>
                    <div className="flex items-start gap-2">
                      <span className="mt-3 w-4 text-xs font-semibold text-ink-400">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1.5">{placeBtn('from', r.from_name)}{placeBtn('to', r.to_name)}</div>
                      <button type="button" className="btn-icon mt-1 text-ink-400" aria-label="Remove ride" onClick={() => void removeRide(r.id)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 pl-6">
                      <ModePicker value={r.mode} onChange={code => setRide(r.id, { mode: code })} blocked={code => outOfPolicy(code, rule)} />
                      {m.perKm ? (
                        <span className="relative min-w-0 max-w-[8rem] flex-1">
                          <input type="number" inputMode="decimal" min={0} step="0.1" aria-label="Km" className="input h-10 w-full pr-9" value={r.claimed_km ?? ''} placeholder="0"
                            onChange={e => {
                              const v = e.target.value === '' ? null : Number(e.target.value)
                              // A key that cannot end in the band is not taken: map 10, "12" stays "1"; map 8.8, "7" is not taken (the user, 26–27 Oct).
                              if (v != null && r.map_km != null && !kmCanReach(e.target.value, kmRange(r.map_km, tol))) return
                              setRide(r.id, { claimed_km: v })
                            }}
                            // Emptied, or under the map's km, and left: the map's km again (the user, 26–27 Oct: "he shouldnt be able to type less than map km").
                            onFocus={() => setTypingKm(r.id)}
                            onBlur={() => { setTypingKm(null); if (r.map_km != null && (r.claimed_km == null || r.claimed_km < kmRange(r.map_km, tol).lo)) setRide(r.id, { claimed_km: r.map_km }) }} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">km</span>
                        </span>
                      ) : (
                        <span className="relative min-w-0 max-w-[8rem] flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                          <input type="number" inputMode="decimal" min={0} step="1" aria-label="Fare" className="input h-10 w-full pl-7 pr-7" value={r.fare ?? ''} placeholder="Fare"
                            onChange={e => setRide(r.id, { fare: e.target.value === '' ? null : Number(e.target.value) })} />
                          <BillHint value={r.fare} read={read} />
                        </span>
                      )}
                      <BillButton compact large part="attach" accent={m} fills={!m.perKm} claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable needed={needsBill('ride', r, over, rule)}
                        onRead={(a, mode) => { const r1 = latest.current.rides.find(x => x.id === r.id); if (!MODES[mode ?? r1?.mode ?? r.mode].perKm && r1?.fare == null) setRide(r.id, { fare: a }) }}
                        onMode={mode => { if (mode !== r.mode) setRide(r.id, { mode }) }}
                        onSameTicket={refs => linkReturn(r.id, refs)}
                        onTicket={(rt, mode, refs) => void fillFromTicket(r.id, rt, mode, refs)} onChange={refresh} />
                      {/* The amount only where it is not the fare itself: km x rate. */}
                      {m.perKm && <span className="ml-auto text-base font-semibold text-ink-900">{money(rideAmount(r, rule))}</span>}
                    </div>
                    {/* Why, and for which call centre — each ride its own (te_0060). */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2 pl-6">
                      <select className={`input h-10 text-sm ${r.purpose ? '' : '!border-amber-400'}`} aria-label="Purpose" value={r.purpose ?? ''} onChange={e => setRide(r.id, { purpose: e.target.value || null })}>
                        <option value="">Purpose…</option>
                        {data.purposes.map(p => <option key={p}>{p}</option>)}
                      </select>
                      <select className={`input h-10 text-sm ${r.project ? '' : '!border-amber-400'}`} aria-label="Call centre" value={r.project ?? ''} onChange={e => setRide(r.id, { project: e.target.value || null })}>
                        <option value="">Call centre…</option>
                        {[...new Set([...projects, ...(r.project ? [r.project] : [])])].map(x => <option key={x}>{x}</option>)}
                      </select>
                    </div>
                    {isBreakdown(r.purpose) && (
                      <div className="mt-2 flex items-center gap-2 pl-6">
                        <span className="relative min-w-0 flex-1">
                          <TicketIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-600" />
                          <input className={`input h-10 w-full pl-9 text-sm ${r.ticket_no?.trim() ? '' : '!border-amber-400'}`} aria-label="Ticket ID" placeholder="Ticket ID (required)" value={r.ticket_no ?? ''} onChange={e => setRide(r.id, { ticket_no: e.target.value })} />
                        </span>
                        <ReportButton large claimId={c.id} ticketId={r.id} bills={data.bills} editable onChange={refresh} />
                      </div>
                    )}
                    {/* A round trip: where its return will be added (te_0058). */}
                    {r.return_leg?.date && !returnAdded(r.return_leg) && r.return_leg.date !== d.day && (
                      <p className="mt-1.5 pl-6 text-xs font-semibold text-sky-700">
                        Round trip · return on {((iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))(r.return_leg.date)}, {r.return_leg.from} → {r.return_leg.to} — {r.return_leg.date.slice(0, 7) === c.month.slice(0, 7) ? 'add it on that day' : "add it in that month's claim"}
                      </p>
                    )}
                    {/* A ticket for another day than this one (te_0057; the user, 22 Oct). */}
                    {r.ticket_date && r.ticket_date !== d.day && (
                      <p className="mt-1.5 pl-6 text-xs font-semibold text-amber-800">
                        The ticket is for {new Date(r.ticket_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} — this day is {new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    )}
                    {/* One short line about the map, amber when the km is over (no chips). */}
                    {/* As soon as the map has the road, before any km is typed (the user, 21 Oct). */}
                    {r.map_km != null && (
                      <div className="mt-1.5 flex items-center gap-3 pl-6">
                        <p className={`min-w-0 flex-1 text-xs ${m.perKm && kmChanged(r) ? 'font-semibold text-amber-800' : 'text-ink-500'}`}>
                          {kmWay(r.mode) === 'rail' ? 'Rail' : kmWay(r.mode) === 'air' ? 'Air' : 'Map'} {km(r.map_km)}{m.perKm && kmOutside(r, tol) && typingKm !== r.id ? ' · km does not match' : m.perKm && kmChanged(r) ? ' · changed' : ''}
                        </p>
                        <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-teal-700 hover:underline" onClick={() => setMapRide(r)}>
                          <MapIcon className="h-3.5 w-3.5" /> View on map
                        </button>
                      </div>
                    )}
                    {/* The bill and what it reads, on a line of its own (the user, 18 Oct). */}
                    {data.bills.some(b => b.owner_id === r.id) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                        <BillButton compact part="bills" claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable needed={false} claimed={m.perKm ? undefined : r.fare} onChange={refresh} />
                        {read != null && r.fare != null && Math.abs(read - r.fare) > 1 && (
                          <span className="text-xs font-semibold text-amber-800">Reads {money(read)} · <button type="button" className="underline" onClick={() => setRide(r.id, { fare: read })}>Use {money(read)}</button></span>
                        )}
                      </div>
                    )}
                    {/* Anything about the ride, in the engineer's words (the user, 21 Oct). */}
                    <div className="mt-2 pl-6">
                      <input className={`input h-10 w-full text-sm ${REMARKS_NEEDED.has(r.mode) && !r.note?.trim() ? '!border-amber-400' : ''}`} aria-label="Remarks" placeholder={REMARKS_NEEDED.has(r.mode) ? 'Remarks (required)' : 'Remarks'} value={r.note ?? ''} onChange={e => setRide(r.id, { note: e.target.value })} />
                    </div>
                    {/* A ticket the company booked: shown, and not claimed (te_0042). */}
                    {(() => { const co = companyOf(data.bills, r); return co && <p className="mt-2 ml-6 flex items-center gap-1.5 rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-semibold text-sky-900"><Building2 className="h-3.5 w-3.5 shrink-0" />Booked by company · {money(co.net)} · {co.booking_id} · not claimed</p> })()}
                    {notAllowed && <p className="mt-2 ml-6 flex items-center gap-1.5 rounded-lg bg-cyrixRed-100 px-2.5 py-1.5 text-xs font-semibold text-cyrixRed-800"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyrixRed-600 text-[10px] font-bold text-white">!</span>{m.label} is not in grade {c.grade ?? '—'}'s policy — needs prior approval</p>}
                  </div>
                )
              })}
              <button type="button" className="btn-lift flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-teal-300 bg-teal-50 text-sm font-semibold text-teal-800 hover:bg-teal-100" onClick={() => {
                const last = d.rides[d.rides.length - 1]
                const from = last?.to_lat != null ? { name: last.to_name!, lat: last.to_lat, lng: last.to_lng! } : d.rides.length === 0 && home ? home : null
                set({ rides: [...d.rides, blankRide(from, carry())] })
              }}><span className="grid h-6 w-6 place-items-center rounded-full bg-teal-600 text-white"><Plus className="h-4 w-4" /></span> {d.rides.length ? 'Add another ride' : 'Add a ride'}</button>
            </div>
          </section>

          {/* ---- DA ---- */}
          {/* An office day pays no DA: one line, not a list of ₹0 (the user, 23 Oct: "why 0?"). */}
          {dayPurpose && data.office_purposes.includes(dayPurpose) ? (
          <section>
            <span className="label">Daily allowance</span>
            <p className="input mt-1 flex h-11 items-center text-ink-500">No DA — office day</p>
          </section>
          ) : (
          <section>
            <label className="block">
              <span className="label flex flex-wrap items-center gap-2">Daily allowance
                {dep && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-violet-800">Deputation · {dep.state}</span>}
                {dep && off && <span title={off} className="rounded-full bg-cyrixRed-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-cyrixRed-800">Outside {dep.state}</span>}
                {auto && (d.da_kind === auto
                  ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-teal-800">From the map</span>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900">Map says {DA_KINDS.find(k => k.code === auto)?.label.toLowerCase()}</span>)}
              </span>
              <select className="input mt-1 h-11" value={d.da_kind} onChange={e => set({ da_kind: e.target.value as DaKind })}>
                {DA_KINDS.filter(k => k.code !== 'deputation' || dep || d.da_kind === 'deputation').map(k => <option key={k.code} value={k.code}>{k.label}{k.code !== 'none' ? ` · ${money(daFor(rule, k.code, dayPurpose, data.office_purposes, depDa))}` : ''}</option>)}
              </select></label>
          </section>
          )}

          {/* ---- other expenses ---- */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><ReceiptIndianRupee className="h-4 w-4 text-amber-600" /> Other expenses</h3>
            {d.expenses.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border border-ink-200">
                <div className="hidden grid-cols-[11rem_8rem_1fr_auto_2.5rem] gap-2 bg-ink-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500 sm:grid">
                  <span>Category</span><span>Amount</span><span>Description</span><span>Bill</span><span />
                </div>
                {d.expenses.map(x => {
                  const put = (p: Partial<typeof x>) => set({ expenses: d.expenses.map(y => (y.id === x.id ? { ...y, ...p } : y)) })
                  return (
                    <div key={x.id} id={'exp-' + x.id} className="border-t border-ink-100 px-3 py-2 first:border-t-0">
                      <div className="grid grid-cols-[1fr_7.5rem_2.25rem] items-center gap-2 sm:grid-cols-[11rem_8rem_1fr_auto_2.5rem]">
                        <select className="input h-10" aria-label="Category" value={x.category} onChange={e => put({ category: e.target.value })}>
                          {EXPENSE_CATEGORIES.map(k => <option key={k}>{k}</option>)}
                        </select>
                        <span className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                          <input type="number" inputMode="decimal" min={0} className="input h-10 pl-7 pr-7" aria-label="Amount" value={x.amount || ''} placeholder="from bill" onChange={e => put({ amount: Number(e.target.value) })} />
                          <BillHint value={x.amount} read={billRead(data.bills, x.id)} />
                        </span>
                        <button type="button" className="btn-icon text-ink-400 sm:order-last" aria-label="Remove expense" onClick={() => set({ expenses: d.expenses.filter(y => y.id !== x.id) })}><Trash2 className="h-4 w-4" /></button>
                        <input className="input col-span-3 h-10 sm:col-span-1" aria-label="Description" placeholder="What it was for" value={x.description ?? ''} onChange={e => put({ description: e.target.value })} />
                        <span className="col-span-3 sm:col-span-1">
                          <BillButton compact large fills claimId={c.id} kind="expense" ownerId={x.id} bills={data.bills} editable needed={needsBill('expense', x, over)} claimed={x.amount || null}
                            onRead={a => { if (!x.amount) put({ amount: a }) }} onChange={refresh} />
                        </span>
                      </div>
                      {x.category === 'Tools' && x.amount > Number(data.policy.tool_max ?? 500) && <p className="mt-1 text-xs text-amber-800">Tools above {money(Number(data.policy.tool_max ?? 500))} go through petty cash</p>}
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="btn-secondary w-full justify-center border-dashed !py-2.5 text-sm sm:w-auto" onClick={() => set({ expenses: [...d.expenses, { id: newId(), category: 'Courier', description: '', amount: 0 }] })}><Plus className="h-4 w-4" /> Expense</button>
          </section>

          {/* ---- hotel, after the other expenses (the user, 27 Oct) ---- */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><BedDouble className="h-4 w-4 text-violet-600" /> Hotel</h3>
            {d.room_by ? (
              <p className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-900">Room already claimed by {d.room_by.name} ({d.room_by.ecode}) · {money(d.room_by.amount)} — you keep the day's DA.</p>
            ) : !d.hotel ? (
              <button type="button" className="btn-secondary w-full justify-center border-dashed !py-2.5 text-sm sm:w-auto" onClick={() => set({ hotel: { id: newId(), name: '', amount: 0, occupancy: 'single', metro: false } })}><Plus className="h-4 w-4" /> Hotel night</button>
            ) : (() => {
              const h = d.hotel!, limit = hotelLimit(rule, h, outOfState, metroPct)
              const setH = (p: Partial<typeof h>) => set({ hotel: { ...h, ...p } })
              return (
                <div id={'hotel-' + h.id} className="space-y-3 rounded-xl border border-ink-200 p-3">
                  <div className="flex items-end gap-2">
                    <label className="block min-w-0 flex-1"><span className="label">Hotel</span>
                      <input className="input mt-1 h-11" value={h.name ?? ''} onChange={e => setH({ name: e.target.value })} placeholder="Hotel name, city" /></label>
                    <button type="button" className="btn-icon mb-1.5 text-ink-400" aria-label="Remove hotel" onClick={() => set({ hotel: null })}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="label">Amount</span>
                      <span className="relative mt-1 block">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                        <input type="number" inputMode="decimal" min={0} className="input h-11 pl-7 pr-7" value={h.amount || ''} placeholder="from bill" onChange={e => setH({ amount: Number(e.target.value) })} />
                        <BillHint value={h.amount} read={billRead(data.bills, h.id)} />
                      </span></label>
                    <div><span className="label">Room</span>
                      <div className="mt-1 grid h-11 grid-cols-2 overflow-hidden rounded-lg border border-ink-200">
                        {(['single', 'double'] as const).map(o => (
                          <button key={o} type="button" onClick={() => setH({ occupancy: o })} className={`text-sm font-semibold ${h.occupancy === o ? 'bg-violet-600 text-white' : 'text-ink-700'}`}>{o === 'single' ? 'Single' : 'Double'}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <input className={`input h-10 w-full text-sm ${!h.note?.trim() ? '!border-amber-400' : ''}`} aria-label="Remarks" placeholder="Remarks (required)" value={h.note ?? ''} onChange={e => setH({ note: e.target.value })} />
                  {(() => { const co = companyOf(data.bills, h); return co && <p className="flex items-center gap-1.5 rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-semibold text-sky-900"><Building2 className="h-3.5 w-3.5 shrink-0" />Booked by company · {money(co.net)} · {co.booking_id} · not claimed</p> })()}
                  <label className="flex h-10 items-center gap-2 text-sm text-ink-800"><input type="checkbox" className="h-5 w-5" checked={h.metro} onChange={e => setH({ metro: e.target.checked })} /> In a metro city (limit +{metroPct}%)</label>
                  {h.occupancy === 'double' && (
                    <div className="relative">
                      <span className="label">Shared with</span>
                      <input className="input mt-1 h-11" placeholder="Name or E-code" defaultValue={h.shared_name ? `${h.shared_name} (${h.shared_ecode})` : ''}
                        onChange={e => { setH({ shared_ecode: null, shared_name: null }); void findPeople(e.target.value) }} />
                      {who.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lg">
                          {who.map(p => (
                            <button key={p.ecode} type="button" className="block w-full px-3 py-3 text-left text-sm hover:bg-ink-100"
                              onClick={e => { setH({ shared_ecode: p.ecode, shared_name: p.full_name }); setWho([]); ((e.currentTarget.parentElement?.previousElementSibling) as HTMLInputElement).value = `${p.full_name} (${p.ecode})` }}>
                              {p.full_name} <span className="text-ink-500">{p.ecode}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs ${limit != null && h.amount > limit ? 'font-semibold text-amber-800' : 'text-ink-500'}`}>
                      {limit == null ? '' : h.amount > limit ? `Over the ${money(limit)} limit — needs approval` : `Limit ${money(limit)}`}
                    </span>
                    <BillButton compact large fills claimId={c.id} kind="hotel" ownerId={h.id} bills={data.bills} editable needed={needsBill('hotel', h, over)} claimed={h.amount || null} onRead={a => { if (!h.amount) setH({ amount: a }) }} onStay={st => void fillFromVoucher(st)} onChange={refresh} />
                  </div>
                </div>
              )
            })()}
          </section>

          <label className="block"><span className="label">Claim remarks</span>
            <textarea rows={2} className="input mt-1" value={d.remarks ?? ''} onChange={e => set({ remarks: e.target.value })} placeholder="What was done" /></label>
        </div>
      </div>
        <div className="sticky bottom-16 z-10 flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg lg:bottom-4">
          <span className="leading-tight"><span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Day total</span><span className="block text-2xl font-bold tabular-nums text-ink-900">{money(d.rides.reduce((t, r) => t + (companyOf(data.bills, r) ? 0 : rideAmount(r, rule)), 0) + da + (d.room_by || (d.hotel && companyOf(data.bills, d.hotel)) ? 0 : d.hotel?.amount ?? 0) + d.expenses.reduce((t, x) => t + (x.amount || 0), 0))}
            {/* The day's km beside its rupees (the user, 27 Oct: "show total km also beautifully"). */}
            {(() => { const k = d.rides.reduce((t, r) => t + Number((MODES[r.mode].perKm ? r.claimed_km : r.map_km) ?? 0), 0); return k > 0 && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 align-middle text-sm font-semibold text-amber-900 ring-1 ring-amber-200"><Route className="h-3.5 w-3.5" /> {km(k)}</span> })()}</span></span>
          <div className="flex items-center gap-2">
            {err ? <span className="max-w-[16rem] text-right text-sm text-cyrixRed-700">{err}</span>
              : blockers.length > 0 && (
                <button type="button" onClick={() => goTo(blockers[0].to)} className="max-w-[13rem] text-right text-xs font-semibold leading-snug text-amber-800 underline-offset-2 hover:underline sm:max-w-[18rem] sm:text-sm">
                  {blockers[0].text}{blockers.length > 1 ? ` · +${blockers.length - 1} more` : ''}
                </button>
              )}
            <button type="button" className={`btn-primary h-11 px-6 text-base ${blockers.length ? 'opacity-50' : ''}`} aria-disabled={blockers.length > 0} disabled={busy} onClick={() => void save()}>{busy && <Spinner className="h-4 w-4" />} Save claim</button>
          </div>
        </div>
      {dating && (
        <Dialog title="Date" icon={<CalendarDays className="h-5 w-5 text-amber-600" />} onClose={() => setDating(false)}>
          <div className="mt-3">
            <MonthCalendar value={d.day} min={firstDay} max={lastDay} marked={data.days.filter(x => x.id !== initial.id).map(x => x.day)}
              onChange={v => { set({ day: v }); setDating(false) }} />
          </div>
        </Dialog>
      )}
      {mapRide && <RouteMap days={[d]} focus={mapRide.id} rule={rule} title={`${(mapRide.from_name ?? '').split(',')[0]} → ${(mapRide.to_name ?? '').split(',')[0]}`} onClose={() => setMapRide(null)} />}
      {picking && ride && (
        <PlacePicker
          title={picking.end === 'from' ? 'From' : 'To'}
          start={picking.end === 'from' ? (ride.from_lat != null ? { name: ride.from_name!, lat: ride.from_lat, lng: ride.from_lng! } : null) : (ride.to_lat != null ? { name: ride.to_name!, lat: ride.to_lat, lng: ride.to_lng! } : null)}
          near={picking.end === 'to' && ride.from_lat != null ? { name: ride.from_name ?? '', lat: ride.from_lat, lng: ride.from_lng! } : null}
          quick={quick}
          onPick={(p, _name, named) => void placed(picking.ride, picking.end, p, named)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
