import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BedDouble, MapPin, Plus, ReceiptIndianRupee, Ticket as TicketIcon, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PlacePicker from '@/components/PlacePicker'
import BillButton from '@/components/BillButton'
import ModePicker from '@/components/ModePicker'
import { useAsk } from '@/components/Ask'
import Budget, { budgetLines, dayUse, monthLong } from '@/components/Budget'
import { Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  DA_KINDS, EXPENSE_CATEGORIES, autoDa, districtOf, MODES, daFor, hotelLimit, km, kmOver, money, monthName, needsBill, newId,
  billRead, outOfPolicy, reachesPlace, rideAmount, roadKm, searchPlaces, type ClaimData, type Day, type DaKind, type Place, type Ride,
} from '@/lib/claims'

/*
  One day of the claim (the user, 17 Oct: day cards): where, why, the rides with their places picked
  on the map, the tickets attended, the DA, a hotel night and other expenses, each with its bills.
  Saved as a whole with te_save_day.
*/
export function blankDay(day: string): Day {
  return { id: newId(), day, place: '', district: '', purpose: null, da_kind: 'in_district', da_amount: 0, continues_day: null, remarks: '', rides: [], tickets: [], hotel: null, expenses: [] }
}
const blankRide = (from?: Place | null): Ride => ({
  id: newId(), mode: 'bike', from_name: from?.name ?? null, from_lat: from?.lat ?? null, from_lng: from?.lng ?? null,
  to_name: null, to_lat: null, to_lng: null, claimed_km: null, map_km: null, fare: null,
})

export default function DayEditor({ data, initial, onClose }: { data: ClaimData; initial: Day; onClose: () => void }) {
  const qc = useQueryClient()
  const { employee } = useAuth()
  const [d, setD] = useState<Day>(initial)
  const [picking, setPicking] = useState<{ ride: string; end: 'from' | 'to' } | null>(null)
  // The day's hospital, picked on the map: its name and its district filled in (the user, 17 Oct).
  const [pickingPlace, setPickingPlace] = useState(false)
  // The claim's details, kept in the form with everything else (the user, 17 Oct).
  const [hdr, setHdr] = useState({ project: data.claim.project ?? '', base: data.claim.base_location ?? '', mobile: data.claim.mobile ?? '' })
  const [projects, setProjects] = useState<string[]>([])
  useEffect(() => { void supabase.rpc('te_projects').then(({ data: p }) => setProjects(((p ?? []) as Array<{ label: string }>).map(x => x.label))) }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [home, setHome] = useState<Place | null>(null)
  const [homeReady, setHomeReady] = useState(false)
  const [who, setWho] = useState<Array<{ ecode: string; full_name: string }>>([])
  const ask = useAsk()
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
      const { data: fresh, error: oe } = await supabase.rpc('te_open_month', { p_month: c.month.slice(0, 8) + '01' })
      if (oe) throw oe
      void qc.invalidateQueries({ queryKey: ['te_my_claims'] }); void qc.invalidateQueries({ queryKey: ['te_summary'] })
      nav(`/claim/${fresh as string}?add=${d.day}`, { replace: true })
    } catch (e) { setErr(friendlyError(e as never)) } finally { setBusy(false) }
  }
  // Places offered while the hospital is typed (the user, 18 Oct: "when typing hospital / place can we get place suggestion from map").
  const [typing, setTyping] = useState(false)
  const [hits, setHits] = useState<Place[]>([])
  const c = data.claim, rule = data.rule
  const nearKm = Number(data.policy.place_near_km ?? 1)
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

  // The day's hospital first (the user, 18 Oct: "should be also in his rides"), then places already used this month.
  const quick = useMemo(() => {
    const seen = new Map<string, Place & { home?: boolean; hospital?: boolean; label?: string }>()
    if (d.place && d.place_lat != null) seen.set('@hospital', { name: [d.place, d.district].filter(Boolean).join(', '), lat: d.place_lat, lng: d.place_lng!, hospital: true, label: d.place })
    if (home) seen.set('Home', { ...home, home: true })
    for (const day of [...data.days, d]) for (const r of day.rides) {
      if (r.from_name && r.from_lat != null && !seen.has(r.from_name)) seen.set(r.from_name, { name: r.from_name, lat: r.from_lat, lng: r.from_lng! })
      if (r.to_name && r.to_lat != null && !seen.has(r.to_name)) seen.set(r.to_name, { name: r.to_name, lat: r.to_lat, lng: r.to_lng! })
    }
    return [...seen.values()].slice(0, 10).map(p => ({ ...p, label: p.label ?? p.name.split(',')[0] }))
  }, [home, data.days, d])

  // The hospital chosen from the list or the map: its name, its pin, and its district filled in.
  const choosePlace = async (p: Place) => {
    setTyping(false); setHits([])
    set({ place: p.name.split(',')[0], place_lat: p.lat, place_lng: p.lng })
    const dist = await districtOf(p.lat, p.lng)
    if (dist) setD(x => ({ ...x, district: dist }))
  }
  useEffect(() => {
    const q = d.place ?? ''
    if (!typing || q.trim().length < 3) { setHits([]); return }
    const t = window.setTimeout(async () => {
      const r0 = d.rides.find(r => r.from_lat != null)
      const near = home ?? (r0 ? { lat: r0.from_lat!, lng: r0.from_lng! } : undefined)
      setHits((await searchPlaces(q, near)).slice(0, 6))
    }, 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.place, typing])

  /*
    The DA follows the day's places (the user, 18 Oct): worked out again whenever a place or the hotel
    night changes, and set. The person can still choose another; a day already saved keeps its choice
    until its places change.
  */
  const [auto, setAuto] = useState<DaKind | null>(initial.da_auto ?? null)
  const stops = useMemo(() => {
    const ps: Place[] = []
    for (const r of d.rides) {
      if (r.from_lat != null) ps.push({ name: '', lat: r.from_lat, lng: r.from_lng! })
      if (r.to_lat != null) ps.push({ name: '', lat: r.to_lat, lng: r.to_lng! })
    }
    if (d.place_lat != null) ps.push({ name: '', lat: d.place_lat, lng: d.place_lng! })
    return ps
  }, [d.rides, d.place_lat, d.place_lng])
  const stay = !!(d.hotel || d.room_by)
  const stopsKey = stops.map(p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|') + (stay ? '|stay' : '')
  const applied = useRef(data.days.some(x => x.id === initial.id) ? stopsKey : '')
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
  const reached = reachesPlace(d, nearKm)
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
    if (end === 'to' && !d.place?.trim()) {
      set({ place: p.name.split(',')[0], place_lat: p.lat, place_lng: p.lng })
      void districtOf(p.lat, p.lng).then(dist => { if (dist) setD(x => (x.district?.trim() ? x : { ...x, district: dist })) })
    }
    if (next.from_lat != null && next.to_lat != null) {
      const road = await roadKm({ name: '', lat: next.from_lat, lng: next.from_lng! }, { name: '', lat: next.to_lat, lng: next.to_lng! })
      setRide(rideId, { map_km: road?.km ?? null })
    }
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
    }
    if (reached === false && !(await ask.confirm({
      title: `No ride reaches ${d.place}`,
      body: `None of the rides starts or ends within ${nearKm} km of it. Your approvers will see this.`,
      yes: 'Save anyway',
    }))) return
    setBusy(true)
    if (hdr.project !== (c.project ?? '') || hdr.base !== (c.base_location ?? '') || hdr.mobile !== (c.mobile ?? '')) {
      const { error: he } = await supabase.rpc('te_set_header', { p_claim: c.id, p_project: hdr.project, p_base: hdr.base, p_mobile: hdr.mobile })
      if (he) { setBusy(false); setErr(friendlyError(he)); return }
    }
    const { error } = await supabase.rpc('te_save_day', {
      p_claim: c.id,
      p_day: {
        ...d,
        continues_day: joined,
        da_auto: auto,
        hotel: d.hotel && d.hotel.amount > 0 ? { ...d.hotel, shared_ecode: d.hotel.occupancy === 'double' ? d.hotel.shared_ecode ?? null : null } : null,
      },
    })
    setBusy(false)
    if (error) { setErr(friendlyError(error)); return }
    refresh(); void qc.invalidateQueries({ queryKey: ['te_my_claims'] })
    onClose()
  }

  const ride = picking ? d.rides.find(r => r.id === picking.ride) : null
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <div>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="h-4 w-4" /> {c.number ? `Back to ${c.number}` : `Back to the ${monthName(c.month)} claim`}</button>
          {c.status === 'draft' && <button type="button" disabled={busy} onClick={() => void discard()} className="inline-flex items-center gap-1 text-sm font-medium text-cyrixRed-700 hover:underline"><Trash2 className="h-4 w-4" /> Discard draft</button>}
        </div>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">{data.days.some(x => x.id === initial.id) ? 'Edit claim' : 'Add a claim'}</h1>
      </div>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">Date</span>
              <input type="date" className="input mt-1 h-11" min={firstDay} max={lastDay} value={d.day} onChange={e => set({ day: e.target.value })} /></label>
            {/* pt-1, not mt-1: a margin here folds into the label's and sat the box 4px higher than its row (the user, 18 Oct: "alignment"). */}
            <label className="block"><span className="label">Hospital / place</span>
              <span className="block pt-1">
                <span className="relative block">
                  <input className="input h-11 pr-10" value={d.place ?? ''} placeholder="Hospital name" autoComplete="off"
                    onChange={e => { setTyping(true); set({ place: e.target.value, place_lat: null, place_lng: null }) }}
                    onBlur={() => window.setTimeout(() => setTyping(false), 150)} />
                  <button type="button" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-cyrixRed-600 hover:bg-ink-100"
                    title="Find on the map" aria-label="Find on the map" onClick={() => setPickingPlace(true)}><MapPin className="h-4 w-4" /></button>
                  {typing && hits.length > 0 && (
                    <span className="absolute inset-x-0 top-full z-20 mt-1 block overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lg sm:w-[200%] sm:max-w-[28rem]">
                      {hits.map((p, i) => (
                        <button key={i} type="button" className="flex w-full items-start gap-2 border-b border-ink-100 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-ink-100"
                          onMouseDown={e => e.preventDefault()} onClick={() => void choosePlace(p)}>
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyrixRed-600" />
                          <span className="min-w-0"><span className="block truncate font-medium text-ink-900">{p.name.split(',')[0]}</span>
                            <span className="block truncate text-xs text-ink-500">{p.name.split(',').slice(1).join(',').trim()}</span></span>
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </span></label>
            <label className="block"><span className="label">District</span>
              <input className="input mt-1 h-11" value={d.district ?? ''} onChange={e => set({ district: e.target.value })} placeholder="District" /></label>
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
                        onRead={a => { if (!m.perKm && r.fare == null) setRide(r.id, { fare: a }) }} onChange={refresh} />
                      {/* The amount only where it is not the fare itself: km x rate. */}
                      {m.perKm && <span className="ml-auto text-base font-semibold text-ink-900">{money(rideAmount(r, rule))}</span>}
                    </div>
                    {/* One short line about the map, amber when the km is over (no chips). */}
                    {m.perKm && r.claimed_km != null && check && (
                      <p className={`mt-1.5 pl-6 text-xs ${check.over ? 'font-semibold text-amber-800' : 'text-ink-500'}`}>
                        {check.over ? `${km(check.over)} over the allowed ${km(check.allowed)} (map ${km(r.map_km)}) — needs approval` : `Map ${km(r.map_km)} · allowed ${km(check.allowed)}`}
                      </p>
                    )}
                    {!m.perKm && r.map_km != null && <p className="mt-1.5 pl-6 text-xs text-ink-500">Map {km(r.map_km)}</p>}
                    {/* The bill and what it reads, on a line of its own (the user, 18 Oct). */}
                    {data.bills.some(b => b.owner_id === r.id) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                        <BillButton compact part="bills" claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable needed={false} claimed={m.perKm ? undefined : r.fare} onChange={refresh} />
                        {read != null && r.fare != null && Math.abs(read - r.fare) > 1 && (
                          <span className="text-xs font-semibold text-amber-800">Reads {money(read)} · <button type="button" className="underline" onClick={() => setRide(r.id, { fare: read })}>Use {money(read)}</button></span>
                        )}
                      </div>
                    )}
                    {notAllowed && <p className="mt-2 ml-6 flex items-center gap-1.5 rounded-lg bg-cyrixRed-100 px-2.5 py-1.5 text-xs font-semibold text-cyrixRed-800"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyrixRed-600 text-[10px] font-bold text-white">!</span>{m.label} is not in grade {c.grade ?? '—'}'s policy — needs prior approval</p>}
                  </div>
                )
              })}
              {reached === false && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">No ride reaches {d.place}</p>}
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
                  return (
                    // Each box says what it is, on a phone too (the user, 17 Oct: "show what field is this").
                    <div key={t.id} className="grid grid-cols-2 items-end gap-2 border-t border-ink-100 px-3 py-2.5 first:border-t-0 sm:grid-cols-[1fr_1fr_1.6fr]">
                      <label className="block min-w-0"><span className="label block truncate">Ticket ID</span>
                        <input className="input mt-1 h-10" value={t.ticket_no} onChange={e => put({ ticket_no: e.target.value })} /></label>
                      <label className="block min-w-0"><span className="label block truncate">SR No</span>
                        <input className="input mt-1 h-10" value={t.service_report ?? ''} onChange={e => put({ service_report: e.target.value })} /></label>
                      <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
                        <label className="block min-w-0 flex-1"><span className="label">Hospital</span>
                          <input className="input mt-1 h-10" value={t.place ?? ''} onChange={e => put({ place: e.target.value })} /></label>
                        <button type="button" className="btn-icon mb-1 text-ink-400" aria-label="Remove ticket" onClick={() => set({ tickets: d.tickets.filter(x => x.id !== t.id) })}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="btn-secondary w-full justify-center border-dashed !py-2.5 text-sm sm:w-auto" onClick={() => set({ tickets: [...d.tickets, { id: newId(), ticket_no: '', service_report: null, place: d.place || null }] })}><Plus className="h-4 w-4" /> Ticket</button>
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
                    <BillButton compact large claimId={c.id} kind="hotel" ownerId={h.id} bills={data.bills} editable needed claimed={h.amount || null} onRead={a => { if (!h.amount) setH({ amount: a }) }} onChange={refresh} />
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

          <label className="block"><span className="label">Remarks</span>
            <textarea rows={2} className="input mt-1" value={d.remarks ?? ''} onChange={e => set({ remarks: e.target.value })} placeholder="What was done" /></label>
        </div>
      </div>
        <div className="sticky bottom-16 z-10 flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg lg:bottom-4">
          <span className="leading-tight"><span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Day total</span><span className="block text-2xl font-bold tabular-nums text-ink-900">{money(d.rides.reduce((t, r) => t + rideAmount(r, rule), 0) + da + (d.room_by ? 0 : d.hotel?.amount ?? 0) + d.expenses.reduce((t, x) => t + (x.amount || 0), 0))}</span></span>
          <div className="flex items-center gap-2">
            {err && <span className="max-w-[16rem] text-right text-sm text-cyrixRed-700">{err}</span>}
            <button type="button" className="btn-primary h-11 px-6 text-base" disabled={busy} onClick={() => void save()}>{busy && <Spinner className="h-4 w-4" />} Save claim</button>
          </div>
        </div>
      {pickingPlace && (
        <PlacePicker title="Hospital / place" start={d.place_lat != null ? { name: d.place ?? '', lat: d.place_lat, lng: d.place_lng! } : null} quick={quick.filter(p => !p.hospital)}
          onPick={p => { setPickingPlace(false); void choosePlace(p) }}
          onClose={() => setPickingPlace(false)} />
      )}
      {picking && ride && (
        <PlacePicker
          title={picking.end === 'from' ? 'From' : 'To'}
          start={picking.end === 'from' ? (ride.from_lat != null ? { name: ride.from_name!, lat: ride.from_lat, lng: ride.from_lng! } : null) : (ride.to_lat != null ? { name: ride.to_name!, lat: ride.to_lat, lng: ride.to_lng! } : null)}
          quick={quick}
          onPick={p => void placed(picking.ride, picking.end, p)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
