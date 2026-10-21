import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BedDouble, Building2, House, LocateFixed, Map as MapIcon, MapPin, Plus, RotateCcw, ReceiptIndianRupee, Ticket as TicketIcon, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PlacePicker from '@/components/PlacePicker'
import RouteMap from '@/components/RouteMap'
import BillButton from '@/components/BillButton'
import ReportButton from '@/components/ReportButton'
import ModePicker from '@/components/ModePicker'
import { useAsk } from '@/components/Ask'
import Budget, { budgetLines, dayUse, monthLong } from '@/components/Budget'
import { Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { whereAmI } from '@/lib/geo'
import { hotelQueries, ticketQueries, type HotelStay, type TicketRoute } from '@/lib/ticket'
import { useAuth } from '@/contexts/AuthContext'
import {
  DA_KINDS, EXPENSE_CATEGORIES, autoDa, districtOf, MODES, daFor, hotelLimit, km, kmOver, money, monthName, needsBill, newId,
  areaOf, billRead, companyOf, lookupPlace, outOfPolicy, rideAmount, roadKm, ticketVisited, visitedPlaces, type ClaimData, type Day, type DaKind, type Place, type Ride,
} from '@/lib/claims'

/*
  One day of the claim (the user, 17 Oct: day cards): when, why, the rides with their places picked
  on the map, the tickets attended, the DA, a hotel night and other expenses, each with its bills.
  Saved as a whole with te_save_day.
*/
export function blankDay(day: string): Day {
  return { id: newId(), day, place: '', district: '', purpose: null, da_kind: 'in_district', da_amount: 0, continues_day: null, remarks: '', rides: [], tickets: [], hotel: null, expenses: [] }
}
// A flight, a train and a hotel night always say why (the user, 21 Oct: "remarks mandatory").
const REMARKS_NEEDED = new Set(['flight', 'train'])
// A ticket that says where it goes (the user, 21 Oct).
const TICKETED = new Set(['flight', 'train', 'bus'])
const placeKey = (s: string | null | undefined) => (s ?? '').split(',')[0].trim().toLowerCase()
const blankRide = (from?: Place | null): Ride => ({
  id: newId(), mode: 'bike', from_name: from?.name ?? null, from_lat: from?.lat ?? null, from_lng: from?.lng ?? null,
  to_name: null, to_lat: null, to_lng: null, claimed_km: null, map_km: null, fare: null,
})

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

export default function DayEditor({ data, initial, chosen = false, onClose }: {
  data: ClaimData; initial: Day
  /** Opened on a date picked from the calendar: a kept new day takes that date. */
  chosen?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
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
    writeKept(key, null); setD(initial); setHdr(header); setErr(null)
  }
  const [projects, setProjects] = useState<string[]>([])
  useEffect(() => { void supabase.rpc('te_projects').then(({ data: p }) => setProjects(((p ?? []) as Array<{ label: string }>).map(x => x.label))) }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [home, setHome] = useState<Place | null>(null)
  const [homeReady, setHomeReady] = useState(false)
  /*
    A home before the first claim is sent (te_0041; the user, 21 Oct): marked by standing there and pressing,
    so it cannot be put anywhere else. The DA and each day's first ride are reckoned from it.
  */
  const [marking, setMarking] = useState(false)
  const markHome = async () => {
    setMarking(true); setErr(null)
    try {
      const at = await whereAmI()
      const { error } = await supabase.rpc('travel_set_home', { p_lat: at.lat, p_lng: at.lng })
      if (error) throw error
      setHome({ name: 'Home', lat: at.lat, lng: at.lng })
    } catch (e) { setErr(friendlyError(e as never)) } finally { setMarking(false) }
  }
  const [who, setWho] = useState<Array<{ ecode: string; full_name: string }>>([])
  const nav = useNavigate()
  /*
    Discard (the user, 19 Oct: "when I'm clicking Add a claim the old draft is showing, which is good, still
    need a discard, so that I can start from fresh"): the draft and its bills go — from My claims too — and a
    fresh one opens on the same date. Only an unsent draft: a claim with a number is never discarded here.
  */
  const discard = async () => {
    const n = data.days.length
    if (!(await ask.confirm({ title: `Discard the ${monthName(c.month)} draft?`, body: n ? `Its ${n} day${n > 1 ? 's' : ''} and bills are deleted, and a fresh claim opens.` : 'A fresh claim opens.', yes: 'Discard', danger: true }))) return
    setBusy(true); setErr(null)
    try {
      const paths = data.bills.map(b => b.path)
      if (paths.length) await supabase.storage.from('te-bills').remove(paths)
      const { error: de } = await supabase.rpc('te_delete_claim', { p_claim: c.id })
      if (de) throw de
      writeKept(key, null); writeKept(keptKey(c.id, null), null)
      const { data: fresh, error: oe } = await supabase.rpc('te_open_month', { p_month: c.month.slice(0, 8) + '01' })
      if (oe) throw oe
      void qc.invalidateQueries({ queryKey: ['te_my_claims'] }); void qc.invalidateQueries({ queryKey: ['te_summary'] })
      nav(`/claim/${fresh as string}?add=${d.day}`, { replace: true })
    } catch (e) { setErr(friendlyError(e as never)) } finally { setBusy(false) }
  }
  const c = data.claim, rule = data.rule
  const over = Number(data.policy.bill_over ?? 300), tol = Number(data.policy.km_tolerance_pct ?? 10), metroPct = Number(data.policy.metro_extra_pct ?? 20)
  const outOfState = d.da_kind === 'out_state' || d.da_kind === 'out_state_stay'
  const da = daFor(rule, d.da_kind, d.purpose, data.office_purposes)
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
  const applied = useRef(saved || kept ? stopsKey : '')
  useEffect(() => {
    if (!stops.length || !homeReady) return
    let live = true
    void autoDa(home, stops, stay).then(k => {
      if (!live || !k) return
      setAuto(k)
      if (applied.current !== stopsKey) { applied.current = stopsKey; set({ da_kind: k }) }
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, homeReady])
  // The hospitals a ticket is chosen from: where the day's rides went (the user, 21 Oct).
  const visited = visitedPlaces(d.rides)
  // The month's budget with this day as it is now in the form: saved use, less this day as saved, plus this day now.
  const was = dayUse(data.days.find(x => x.id === initial.id)), now = dayUse(d), km0 = data.km_month
  const budget = budgetLines(rule, data.policy, {
    bike: km0.bike - was.bike + now.bike, car: km0.car - was.car + now.car,
    auto: km0.auto - was.auto + now.auto, phone: (km0.phone ?? 0) - was.phone + now.phone,
  })

  // Road km once both ends of a ride are picked.
  const placed = async (rideId: string, end: 'from' | 'to', p: Place) => {
    setPicking(null)
    const r = d.rides.find(x => x.id === rideId)!
    const next = end === 'from'
      ? { ...r, from_name: p.name, from_lat: p.lat, from_lng: p.lng }
      : { ...r, to_name: p.name, to_lat: p.lat, to_lng: p.lng }
    setRide(rideId, { ...next, map_km: null })
    if (next.from_lat != null && next.to_lat != null) {
      const road = await roadKm({ name: '', lat: next.from_lat, lng: next.from_lng! }, { name: '', lat: next.to_lat, lng: next.to_lng! })
      setRide(rideId, { map_km: road?.km ?? null })
    }
  }

  /*
    A flight, train or bus ticket fills the ride's From and To (the user, 21 Oct: "from and to is there, so
    can we auto fetch"): only an end not picked yet, or a From still at Home — what the engineer picked stays.
  */
  const latest = useRef(d); latest.current = d
  const fillFromTicket = async (rideId: string, route: TicketRoute) => {
    const r0 = latest.current.rides.find(x => x.id === rideId)
    if (!r0) return
    const q = ticketQueries(r0.mode, route)
    if (!q) return
    const near = home ?? undefined
    const wantFrom = r0.from_lat == null || placeKey(r0.from_name) === 'home', wantTo = r0.to_lat == null
    const [pf, pt] = await Promise.all([wantFrom && q.from.length ? lookupPlace(q.from, q.want, near) : null, wantTo && q.to.length ? lookupPlace(q.to, q.want, near) : null])
    if (!pf && !pt) return
    const r1 = latest.current.rides.find(x => x.id === rideId)
    if (!r1) return
    const next = { ...r1, ...(pf ? { from_name: pf.name, from_lat: pf.lat, from_lng: pf.lng } : {}), ...(pt ? { to_name: pt.name, to_lat: pt.lat, to_lng: pt.lng } : {}), map_km: null }
    setRide(rideId, next)
    if (next.from_lat != null && next.to_lat != null) {
      const road = await roadKm({ name: '', lat: next.from_lat, lng: next.from_lng! }, { name: '', lat: next.to_lat, lng: next.to_lng! })
      setRide(rideId, { map_km: road?.km ?? null })
    }
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

  const save = async () => {
    setErr(null)
    if (!d.day) { setErr('Choose the date'); return }
    if (d.day > lastDay) { setErr('A future date cannot be claimed'); return }
    let joined = d.continues_day
    if (joined) { const n = new Date(joined + 'T00:00:00'); n.setDate(n.getDate() + 1); if (n.toLocaleDateString('en-CA') !== d.day) joined = null }
    for (const r of d.rides) {
      if (r.from_lat == null || r.to_lat == null) { setErr('Pick the from and to place of every ride on the map'); return }
      if (MODES[r.mode].perKm && !r.claimed_km) { setErr(`Type the km for the ${MODES[r.mode].label.toLowerCase()} ride`); return }
      if (!MODES[r.mode].perKm && r.fare == null) { setErr(`Type the fare for the ${MODES[r.mode].label.toLowerCase()} ride`); return }
      if (REMARKS_NEEDED.has(r.mode) && !r.note?.trim()) { setErr(`Write the remarks for the ${MODES[r.mode].label.toLowerCase()} ride`); return }
    }
    if (d.hotel && !d.room_by && (d.hotel.amount > 0 || companyOf(data.bills, d.hotel)) && !d.hotel.note?.trim()) { setErr('Write the remarks for the hotel night'); return }
    const away = d.tickets.filter(t => t.ticket_no.trim() && ticketVisited(t, d.rides) === false)
    if (away.length && !(await ask.confirm({
      title: away.length === 1 ? `You didn't visit ${away[0].place} on this day's rides` : "Some tickets' hospitals are not on this day's rides",
      body: `${away.map(t => `Ticket ${t.ticket_no} · ${t.place}`).join(', ')}. Your approvers will see this.`,
      yes: 'Save anyway',
    }))) return
    setBusy(true)
    /*
      The day's place is where its rides went, and its district theirs (the user, 21 Oct: "what if I went
      to 2-3 hospitals? … that we are showing in trip also, so that field needed there?").
    */
    const ends = d.rides.filter(r => r.to_lat != null && placeKey(r.to_name) !== 'home')
    const distOf = new Map(await Promise.all(ends.map(async r => [r.id, await districtOf(r.to_lat!, r.to_lng!).catch(() => null)] as const)))
    const dists = [...new Set([...distOf.values()].filter(Boolean))]
    // Each ticket's district goes with it, for the place it teaches everyone (te_0038).
    const tickets = d.tickets.map(t => { const r = ends.find(x => placeKey(x.to_name) === placeKey(t.place)); return { ...t, district: r ? distOf.get(r.id) ?? null : null } })
    const place = visited.length ? visited.join(' · ') : d.place
    const district = dists.length ? dists.join(', ') : d.district
    if (hdr.project !== (c.project ?? '') || hdr.base !== (c.base_location ?? '') || hdr.mobile !== (c.mobile ?? '')) {
      const { error: he } = await supabase.rpc('te_set_header', { p_claim: c.id, p_project: hdr.project, p_base: hdr.base, p_mobile: hdr.mobile })
      if (he) { setBusy(false); setErr(friendlyError(he)); return }
    }
    const { error } = await supabase.rpc('te_save_day', {
      p_claim: c.id,
      p_day: {
        ...d,
        place, district, place_lat: null, place_lng: null, tickets,
        continues_day: joined,
        da_auto: auto,
        hotel: d.hotel && (d.hotel.amount > 0 || companyOf(data.bills, d.hotel)) ? { ...d.hotel, shared_ecode: d.hotel.occupancy === 'double' ? d.hotel.shared_ecode ?? null : null } : null,
      },
    })
    setBusy(false)
    if (error) { setErr(friendlyError(error)); return }
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
      {homeReady && !home && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-300 bg-teal-50 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold text-teal-900"><House className="h-5 w-5 text-teal-700" /> Mark your home</span>
          <button type="button" className="btn-primary" disabled={marking} onClick={() => void markHome()}>{marking ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} I'm at home</button>
        </div>
      )}
      <Budget title={`Left in ${monthLong(c.month)}`} lines={budget} />
      <div className="card">
        <div className="space-y-5 px-4 py-4">
          <div className="grid gap-3 border-b border-ink-100 pb-4 sm:grid-cols-2">
            <label className="block"><span className="label">Project</span>
              <select className="input mt-1 h-11" value={hdr.project} onChange={e => setHdr({ ...hdr, project: e.target.value })}>
                <option value="">Choose…</option>
                {[...new Set([...projects, ...(hdr.project ? [hdr.project] : [])])].map(x => <option key={x}>{x}</option>)}
              </select></label>
          </div>
          {d.continues_day && <p className="rounded-lg bg-violet-100 px-3 py-2 text-sm text-violet-900">Continues the trip of {new Date(d.continues_day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Date</span>
              <input type="date" className="input mt-1 h-11" min={firstDay} max={lastDay} value={d.day} onChange={e => set({ day: e.target.value })} /></label>
            <label className="block"><span className="label">Purpose</span>
              <select className="input mt-1 h-11" value={d.purpose ?? ''} onChange={e => set({ purpose: e.target.value || null })}>
                <option value="">Choose…</option>
                {data.purposes.map(p => <option key={p}>{p}</option>)}
              </select></label>
          </div>

          {/* ---- rides ---- */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-800">Rides</h3>
            <div className="space-y-3">
              {d.rides.map((r, i) => {
                const m = MODES[r.mode]
                const check = m.perKm ? kmOver(r, tol) : null
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
                  <div key={r.id} className="rounded-xl border p-3" style={{ borderColor: m.color + '59', background: m.color + '0A' }}>
                    <div className="flex items-start gap-2">
                      <span className="mt-3 w-4 text-xs font-semibold text-ink-400">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1.5">{placeBtn('from', r.from_name)}{placeBtn('to', r.to_name)}</div>
                      <button type="button" className="btn-icon mt-1 text-ink-400" aria-label="Remove ride" onClick={() => set({ rides: d.rides.filter(x => x.id !== r.id) })}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 pl-6">
                      <ModePicker value={r.mode} onChange={code => setRide(r.id, { mode: code })} blocked={code => outOfPolicy(code, rule)} />
                      {m.perKm ? (
                        <span className="relative min-w-0 max-w-[8rem] flex-1">
                          <input type="number" inputMode="decimal" min={0} step="0.1" aria-label="Km" className="input h-10 w-full pr-9" value={r.claimed_km ?? ''} placeholder="0"
                            onChange={e => setRide(r.id, { claimed_km: e.target.value === '' ? null : Number(e.target.value) })} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">km</span>
                        </span>
                      ) : (
                        <span className="relative min-w-0 max-w-[8rem] flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                          <input type="number" inputMode="decimal" min={0} step="1" aria-label="Fare" className="input h-10 w-full pl-7" value={r.fare ?? ''} placeholder="Fare"
                            onChange={e => setRide(r.id, { fare: e.target.value === '' ? null : Number(e.target.value) })} />
                        </span>
                      )}
                      <BillButton compact large part="attach" accent={m} claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable needed={needsBill('ride', r, over, rule)}
                        onRead={a => { if (!m.perKm && r.fare == null) setRide(r.id, { fare: a }) }}
                        onTicket={TICKETED.has(r.mode) ? rt => void fillFromTicket(r.id, rt) : undefined} onChange={refresh} />
                      {/* The amount only where it is not the fare itself: km x rate. */}
                      {m.perKm && <span className="ml-auto text-base font-semibold text-ink-900">{money(rideAmount(r, rule))}</span>}
                    </div>
                    {/* One short line about the map, amber when the km is over (no chips). */}
                    {/* As soon as the map has the road, before any km is typed (the user, 21 Oct). */}
                    {r.map_km != null && (
                      <div className="mt-1.5 flex items-center gap-3 pl-6">
                        <p className={`min-w-0 flex-1 text-xs ${check?.over ? 'font-semibold text-amber-800' : 'text-ink-500'}`}>
                          {!m.perKm ? `Map ${km(r.map_km)}` : check?.over ? `${km(check.over)} over the allowed ${km(check.allowed)} (map ${km(r.map_km)}) — needs approval` : `Map ${km(r.map_km)} · allowed ${km(r.map_km * (1 + tol / 100))}`}
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
                set({ rides: [...d.rides, blankRide(from)] })
              }}><span className="grid h-6 w-6 place-items-center rounded-full bg-teal-600 text-white"><Plus className="h-4 w-4" /></span> {d.rides.length ? 'Add another ride' : 'Add a ride'}</button>
            </div>
          </section>

          {/* ---- tickets ---- */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><TicketIcon className="h-4 w-4 text-sky-600" /> Tickets attended</h3>
            {d.tickets.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border border-ink-200">
                {d.tickets.map(t => {
                  const put = (p: Partial<typeof t>) => set({ tickets: d.tickets.map(x => (x.id === t.id ? { ...x, ...p } : x)) })
                  const off = ticketVisited(t, d.rides) === false
                  return (
                    // Each box says what it is, on a phone too (the user, 17 Oct: "show what field is this").
                    <div key={t.id} className="grid grid-cols-2 items-end gap-2 border-t border-ink-100 px-3 py-2.5 first:border-t-0 sm:grid-cols-[1fr_1fr_1.6fr_auto]">
                      <label className="block min-w-0"><span className="label block truncate">Ticket ID</span>
                        <input className="input mt-1 h-10" value={t.ticket_no} onChange={e => put({ ticket_no: e.target.value })} /></label>
                      <label className="block min-w-0"><span className="label block truncate">SR No</span>
                        <input className="input mt-1 h-10" value={t.service_report ?? ''} onChange={e => put({ service_report: e.target.value })} /></label>
                      <label className="col-span-2 block min-w-0 sm:col-span-1"><span className="label">Hospital</span>
                        <select className={`input mt-1 h-10 ${off ? '!border-amber-400' : ''}`} value={t.place ?? ''} onChange={e => put({ place: e.target.value || null })}>
                          <option value="">{visited.length ? 'Choose…' : 'Add the ride first'}</option>
                          {[...visited, ...(off ? [t.place!] : [])].map(p => <option key={p} value={p}>{p}</option>)}
                        </select></label>
                      <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                        <ReportButton large claimId={c.id} ticketId={t.id} bills={data.bills} editable onChange={refresh} />
                        <button type="button" className="btn-icon ml-auto text-ink-400" aria-label="Remove ticket" onClick={() => set({ tickets: d.tickets.filter(x => x.id !== t.id) })}><Trash2 className="h-4 w-4" /></button>
                      </div>
                      {off && <p className="col-span-full text-xs font-semibold text-amber-800">You didn't visit {t.place} on this day's rides</p>}
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="btn-secondary w-full justify-center border-dashed !py-2.5 text-sm sm:w-auto" onClick={() => set({ tickets: [...d.tickets, { id: newId(), ticket_no: '', service_report: null, place: visited[visited.length - 1] ?? null }] })}><Plus className="h-4 w-4" /> Ticket</button>
          </section>

          {/* ---- DA ---- */}
          <section>
            <label className="block">
              <span className="label flex flex-wrap items-center gap-2">Daily allowance
                {auto && (d.da_kind === auto
                  ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-teal-800">From the map</span>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900">Map says {DA_KINDS.find(k => k.code === auto)?.label.toLowerCase()}</span>)}
              </span>
              <select className="input mt-1 h-11" value={d.da_kind} onChange={e => set({ da_kind: e.target.value as DaKind })}>
                {DA_KINDS.map(k => <option key={k.code} value={k.code}>{k.label}{k.code !== 'none' ? ` · ${money(daFor(rule, k.code, d.purpose, data.office_purposes))}` : ''}</option>)}
              </select></label>
            {d.purpose && data.office_purposes.includes(d.purpose) && <p className="mt-1 text-xs text-ink-500">No DA on an office day</p>}
          </section>

          {/* ---- hotel ---- */}
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
                <div className="space-y-3 rounded-xl border border-ink-200 p-3">
                  <div className="flex items-end gap-2">
                    <label className="block min-w-0 flex-1"><span className="label">Hotel</span>
                      <input className="input mt-1 h-11" value={h.name ?? ''} onChange={e => setH({ name: e.target.value })} placeholder="Hotel name, city" /></label>
                    <button type="button" className="btn-icon mb-1.5 text-ink-400" aria-label="Remove hotel" onClick={() => set({ hotel: null })}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="label">Amount</span>
                      <span className="relative mt-1 block">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                        <input type="number" inputMode="decimal" min={0} className="input h-11 pl-7" value={h.amount || ''} onChange={e => setH({ amount: Number(e.target.value) })} />
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
                    <BillButton compact large claimId={c.id} kind="hotel" ownerId={h.id} bills={data.bills} editable needed claimed={h.amount || null} onRead={a => { if (!h.amount) setH({ amount: a }) }} onStay={st => void fillFromVoucher(st)} onChange={refresh} />
                  </div>
                </div>
              )
            })()}
          </section>

          {/* ---- other expenses ---- */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800"><ReceiptIndianRupee className="h-4 w-4 text-amber-600" /> Other expenses</h3>
            {d.expenses.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border border-ink-200">
                <div className="hidden grid-cols-[11rem_7rem_1fr_auto_2.5rem] gap-2 bg-ink-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500 sm:grid">
                  <span>Category</span><span>Amount</span><span>Description</span><span>Bill</span><span />
                </div>
                {d.expenses.map(x => {
                  const put = (p: Partial<typeof x>) => set({ expenses: d.expenses.map(y => (y.id === x.id ? { ...y, ...p } : y)) })
                  return (
                    <div key={x.id} className="border-t border-ink-100 px-3 py-2 first:border-t-0">
                      <div className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-2 sm:grid-cols-[11rem_7rem_1fr_auto_2.5rem]">
                        <select className="input h-10" aria-label="Category" value={x.category} onChange={e => put({ category: e.target.value })}>
                          {EXPENSE_CATEGORIES.map(k => <option key={k}>{k}</option>)}
                        </select>
                        <span className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
                          <input type="number" min={0} className="input h-10 pl-7" aria-label="Amount" value={x.amount || ''} onChange={e => put({ amount: Number(e.target.value) })} />
                        </span>
                        <button type="button" className="btn-icon text-ink-400 sm:order-last" aria-label="Remove expense" onClick={() => set({ expenses: d.expenses.filter(y => y.id !== x.id) })}><Trash2 className="h-4 w-4" /></button>
                        <input className="input col-span-3 h-10 sm:col-span-1" aria-label="Description" placeholder="What it was for" value={x.description ?? ''} onChange={e => put({ description: e.target.value })} />
                        <span className="col-span-3 sm:col-span-1">
                          <BillButton compact large claimId={c.id} kind="expense" ownerId={x.id} bills={data.bills} editable needed={needsBill('expense', x, over)} claimed={x.amount || null}
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

          <label className="block"><span className="label">Claim remarks</span>
            <textarea rows={2} className="input mt-1" value={d.remarks ?? ''} onChange={e => set({ remarks: e.target.value })} placeholder="What was done" /></label>
        </div>
      </div>
        <div className="sticky bottom-16 z-10 flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg lg:bottom-4">
          <span className="leading-tight"><span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Day total</span><span className="block text-2xl font-bold tabular-nums text-ink-900">{money(d.rides.reduce((t, r) => t + (companyOf(data.bills, r) ? 0 : rideAmount(r, rule)), 0) + da + (d.room_by || (d.hotel && companyOf(data.bills, d.hotel)) ? 0 : d.hotel?.amount ?? 0) + d.expenses.reduce((t, x) => t + (x.amount || 0), 0))}</span></span>
          <div className="flex items-center gap-2">
            {err && <span className="max-w-[16rem] text-right text-sm text-cyrixRed-700">{err}</span>}
            <button type="button" className="btn-primary h-11 px-6 text-base" disabled={busy} onClick={() => void save()}>{busy && <Spinner className="h-4 w-4" />} Save claim</button>
          </div>
        </div>
      {mapRide && <RouteMap days={[{ ...d, rides: [mapRide] }]} rule={rule} title={`${(mapRide.from_name ?? '').split(',')[0]} → ${(mapRide.to_name ?? '').split(',')[0]}`} onClose={() => setMapRide(null)} />}
      {picking && ride && (
        <PlacePicker
          title={picking.end === 'from' ? 'From' : 'To'}
          start={picking.end === 'from' ? (ride.from_lat != null ? { name: ride.from_name!, lat: ride.from_lat, lng: ride.from_lng! } : null) : (ride.to_lat != null ? { name: ride.to_name!, lat: ride.to_lat, lng: ride.to_lng! } : null)}
          near={picking.end === 'to' && ride.from_lat != null ? { name: ride.from_name ?? '', lat: ride.from_lat, lng: ride.from_lng! } : null}
          quick={quick}
          onPick={p => void placed(picking.ride, picking.end, p)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
