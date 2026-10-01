import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowRightLeft, Check, ExternalLink, Flag, Home, LocateFixed, MapPin, MapPinCheck, MapPinned, Play } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import ModeArt, { modeLook } from '@/components/ModeArt'
import Camera, { type Shot } from '@/components/Camera'
import { mapLink, placeName, whereAmI, type Fix } from '@/lib/geo'
import { clockTime } from '@/lib/when'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import {
  STOP_KIND, km, rupees, uploadShot, useChangeMode, useCloseStop, useEnd, useHome, useModes, useReach, useStart, useTrip, useTrips,
  type Leg, type Mode, type Stop, type StopKind,
} from '@/lib/travel'
import { TONE_CLASS } from '@/lib/tones'

/**
 * The engineer's day on the road: start, change mode, reach, close, end.
 * Every press reads where the phone is at that moment — nothing is typed
 * for a place — and one thing is asked at a time, with thumb-sized buttons.
 */
export default function Trip() {
  const { data: trips, isLoading } = useTrips()
  const running = useMemo(() => (trips ?? []).find(t => t.mine && t.status === 'open' && !t.ended_at), [trips])
  const unsent = useMemo(() => (trips ?? []).filter(t => t.mine && ((t.status === 'open' && t.ended_at) || t.status === 'returned')), [trips])

  if (isLoading) return <PageLoader />
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {unsent.length > 0 && (
        <Alert kind="warning" title={unsent.length === 1 ? 'One claim is waiting for you to submit' : `${unsent.length} claims are waiting for you to submit`}>
          {unsent.map(t => <Link key={t.id} to={`/claims/${t.id}`} className="link-accent mr-3">{t.code}</Link>)}
        </Alert>
      )}
      {running ? <Running tripId={running.id} code={running.code} /> : <StartCard />}
    </div>
  )
}

/**
 * The ways of travelling, each a tile in its own colour with its vehicle on
 * it. The chosen one takes the colour whole, is ticked, and its vehicle runs
 * (the user, 1 Oct: "for each travel mode, use diff color and on selected
 * mode, show mode animation").
 */
function ModePicker({ modes, value, onChange }: { modes: Mode[]; value: string; onChange: (m: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {modes.filter(m => m.is_active).map(m => {
        const on = value === m.mode
        const look = modeLook(m.mode)
        return (
          <button key={m.mode} type="button" aria-pressed={on} onClick={() => onChange(m.mode)}
            className={clsx('btn-press relative flex flex-col items-center rounded-xl border p-1.5 pb-2.5 text-center text-sm font-medium transition-colors',
              on ? look.on : 'border-ink-200 bg-surface text-ink-800 hover:border-ink-300')}>
            <ModeArt mode={m.mode} moving={on} chosen={on} className="w-full rounded-lg" />
            <span className="mt-1.5">{m.label}</span>
            <span className="text-[11px] font-normal opacity-70">{m.per_km !== null ? `${rupees(m.per_km)} a km` : 'actual fare'}</span>
            {on && (
              <span aria-hidden className={clsx('animate-pop-in absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-canvas ring-2 ring-surface', look.tick)}>
                <Check className="h-3 w-3" strokeWidth={3.5} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Where a trip may start from. Each has its own colour, so the two are told apart before they are read. */
const START_FROM = [
  { kind: 'home', label: 'Home', icon: Home, tint: 'text-teal-700', on: 'border-teal-400 bg-teal-100 text-teal-900 ring-1 ring-teal-400' },
  { kind: 'new', label: 'A new place', icon: MapPin, tint: 'text-violet-700', on: 'border-violet-400 bg-violet-100 text-violet-900 ring-1 ring-violet-400' },
] as const

/** A place marked with a press: the point, what it is called, and when it was read. */
interface Mark { at: Fix; name: string | null; when: number }

/** A mark older than this is read again at Start: a place marked a while ago is not where Start was pressed. */
const MARK_KEEPS_MS = 5 * 60_000

function StartCard() {
  const { employee } = useAuth()
  const { data: modes } = useModes()
  const { data: home } = useHome(employee?.id)
  const start = useStart()
  const [kind, setKind] = useState<'home' | 'new'>('home')
  const [mark, setMark] = useState<Mark | null>(null)
  const [marking, setMarking] = useState(false)
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Reads where the phone is and what that place is called. Nothing is typed (the user, 1 Oct). */
  const readMark = async (): Promise<Mark> => {
    const at = await whereAmI()
    const made = { at, name: await placeName(at), when: Date.now() }
    setMark(made)
    return made
  }
  const markHere = async () => {
    setError(null); setMarking(true)
    try { await readMark() } catch (e) { setError(e instanceof Error ? e.message : 'Your location could not be read.') } finally { setMarking(false) }
  }

  const go = async () => {
    setError(null)
    if (kind === 'new' && !mark) { setError('Mark your location first.'); return }
    if (!mode) { setError('Choose how you are travelling.'); return }
    setBusy(true)
    try {
      if (kind === 'new') {
        const from = Date.now() - mark!.when > MARK_KEEPS_MS ? await readMark() : mark!
        await start.mutateAsync({ kind, at: from.at, mode, note: from.name ?? undefined })
      } else {
        await start.mutateAsync({ kind, at: await whereAmI(), mode })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The trip did not start.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Start a trip</h1>
        <p className="mt-0.5 text-sm text-ink-500">Press Start where you set off. Your location is read at each press, so the distance works itself out.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <p className="label">Starting from</p>
        <div className="grid grid-cols-2 gap-2">
          {START_FROM.map(({ kind: k, label, icon: Icon, tint, on }) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={clsx('btn-press flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
                kind === k ? on : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300')}>
              <Icon className={clsx('h-4 w-4', tint)} /> {label}
            </button>
          ))}
        </div>
        {kind === 'home' && (
          <p className="mt-1.5 text-xs text-ink-500">{home ? 'Your home is saved. Where you are now is what is recorded.' : 'No home saved yet: where you press Start becomes your home.'}</p>
        )}
        {kind === 'new' && (mark ? (
          <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
            {/* The name has the whole width: a place is three or four words long, and beside a button it broke onto as many lines. */}
            <div className="flex items-start gap-2.5">
              <MapPinCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-violet-900">{mark.name ?? `${mark.at.lat.toFixed(5)}, ${mark.at.lng.toFixed(5)}`}</p>
                <p className="mt-0.5 text-xs text-ink-600">
                  Marked at {clockTime(mark.when)}{Number.isFinite(mark.at.accuracy) ? `, to about ${Math.max(1, Math.round(mark.at.accuracy))} m` : ''}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3 pl-[1.875rem]">
              <a className="link-accent inline-flex items-center gap-1 text-xs text-violet-900 underline" href={mapLink(mark.at)} target="_blank" rel="noreferrer">
                see on the map <ExternalLink className="h-3 w-3" />
              </a>
              <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={markHere} disabled={marking || busy}>
                {marking ? <Spinner className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5 text-violet-700" />} Mark again
              </button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="btn-secondary mt-2 w-full justify-center !py-3" onClick={markHere} disabled={marking}>
              {marking ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4 text-violet-700" />}
              {marking ? 'Reading your location…' : 'Mark my location'}
            </button>
            <p className="mt-1.5 text-xs text-ink-500">Reads where you are now and names the place. Nothing is typed.</p>
          </>
        ))}
      </div>
      <div>
        <p className="label">Travelling by</p>
        <ModePicker modes={modes ?? []} value={mode} onChange={setMode} />
      </div>
      <button type="button" className="btn-primary w-full justify-center !py-3 text-base" onClick={go} disabled={busy || marking}>
        {busy ? <Spinner className="h-5 w-5" /> : <Play className="h-5 w-5" />} Start
      </button>
    </div>
  )
}

type Panel = 'reach' | 'change' | 'end' | null

function Running({ tripId, code }: { tripId: string; code: string }) {
  const { data, isLoading } = useTrip(tripId)
  const { data: modes } = useModes()
  const [panel, setPanel] = useState<Panel>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const navigate = useNavigate()

  if (isLoading || !data) return <PageLoader />
  const leg = data.legs.find(l => !l.to_at) ?? null
  const openStop = data.stops.find(s => !s.closed_at) ?? null
  const mode = (modes ?? []).find(m => m.mode === leg?.mode)
  const look = modeLook(leg?.mode)
  const done = (msg: string) => { setPanel(null); setNotice(msg) }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div aria-hidden className={clsx('h-1', look.bar)} />
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-mono text-lg font-semibold text-ink-900">{code}</p>
            <p className="text-sm text-ink-500">On the road since {clockTime(data.trip.started_at)}</p>
          </div>
          {leg && (
            <span className={clsx('flex shrink-0 items-center gap-2 rounded-xl py-1 pl-1 pr-3 text-sm font-medium', look.pill)}>
              {/* It runs while they travel and stands while they are at a stop: a vehicle moving beside "At GH Thrissur" would be saying something untrue. */}
              <ModeArt mode={leg.mode} moving={!openStop} chosen className="w-14 rounded-lg" />
              {mode?.label ?? leg.mode}
            </span>
          )}
        </div>
        <Journey legs={data.legs} stops={data.stops} modes={modes ?? []} />
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}

      {openStop ? (
        <CloseStop stop={openStop} onDone={msg => done(msg)} />
      ) : panel === null ? (
        <div className="grid gap-2">
          <button type="button" className="btn-primary w-full justify-center !py-3 text-base" onClick={() => { setNotice(null); setPanel('reach') }}>
            <MapPinned className="h-5 w-5" /> Reached
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary justify-center !py-3" onClick={() => { setNotice(null); setPanel('change') }}>
              <ArrowRightLeft className="h-4 w-4 text-indigo-500" /> Change mode
            </button>
            <button type="button" className="btn-secondary justify-center !py-3" onClick={() => { setNotice(null); setPanel('end') }}>
              <Flag className="h-4 w-4 text-cyrixRed-600" /> End trip
            </button>
          </div>
        </div>
      ) : panel === 'reach' ? (
        <ReachForm tripId={tripId} onCancel={() => setPanel(null)} onDone={() => done('Reached. Close the stop with its photograph when the work is done.')} />
      ) : leg && (
        <LegEndForm
          tripId={tripId} leg={leg} mode={mode} modes={modes ?? []} ending={panel === 'end'}
          onCancel={() => setPanel(null)}
          onDone={() => { if (panel === 'end') navigate(`/claims/${tripId}`); else done('Mode changed. The last leg is closed with its distance.') }}
        />
      )}
    </div>
  )
}

/** The day so far: each leg and each stop, in the order they happened. */
function Journey({ legs, stops, modes }: { legs: Leg[]; stops: Stop[]; modes: Mode[] }) {
  const label = (m: string) => modes.find(x => x.mode === m)?.label ?? m
  const closed = legs.filter(l => l.to_at)
  if (closed.length === 0 && stops.length === 0) return null
  return (
    <ul className="divide-y divide-ink-100 border-t border-ink-200 text-sm">
      {closed.map(l => (
        <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="flex min-w-0 items-center gap-2.5 text-ink-700">
            <ModeArt mode={l.mode} className="w-9 rounded-md" />
            <span className="truncate">{label(l.mode)} <span className="text-ink-400">· {km(l.road_km)}</span></span>
          </span>
          <span className="tabular-nums font-medium text-ink-900">{rupees(l.amount)}</span>
        </li>
      ))}
      {stops.map(s => (
        <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="min-w-0 truncate text-ink-700">
            <span className={clsx('badge mr-2', TONE_CLASS[STOP_KIND[s.kind].tone])}>{STOP_KIND[s.kind].label}</span>
            {s.facility_name}{s.ticket_no ? ` · ${s.ticket_no}` : ''}
          </span>
          <span className={clsx('shrink-0 text-xs', s.closed_at ? 'text-green-700' : 'text-amber-700')}>{s.closed_at ? 'Closed' : 'Open'}</span>
        </li>
      ))}
    </ul>
  )
}

function ReachForm({ tripId, onCancel, onDone }: { tripId: string; onCancel: () => void; onDone: () => void }) {
  const reach = useReach()
  const [kind, setKind] = useState<StopKind>('ticket')
  const [facility, setFacility] = useState('')
  const [ticketNo, setTicketNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Places already visited, so a name is spelled the same way twice.
  const { data: known } = useQuery({
    queryKey: ['travel', 'facilities'],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await supabase.from('travel_facilities').select('name').order('name')).data ?? []) as Array<{ name: string }>,
  })

  const go = async () => {
    setError(null)
    if (facility.trim().length < 2) { setError('Enter the facility, or the place, you have reached.'); return }
    if (kind === 'ticket' && !ticketNo.trim()) { setError('Enter the ticket ID you came for.'); return }
    setBusy(true)
    try {
      const at = await whereAmI()
      await reach.mutateAsync({ tripId, kind, facility, ticketNo: kind === 'ticket' ? ticketNo : undefined, at })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink-800"><IconChip icon={MapPinned} tone="indigo" /> Reached</h2>
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <p className="label">This stop is for</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(STOP_KIND) as StopKind[]).map(k => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={clsx('btn-press rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                kind === k ? clsx('border-transparent', TONE_CLASS[STOP_KIND[k].tone]) : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300')}>
              {STOP_KIND[k].label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="label">Facility or place <span className="text-cyrixRed-600">*</span></span>
        <input className="input" list="travel-facilities" value={facility} onChange={e => setFacility(e.target.value)} maxLength={200} placeholder="e.g. GH Thrissur" />
        <datalist id="travel-facilities">{(known ?? []).map(f => <option key={f.name} value={f.name} />)}</datalist>
      </label>
      {kind === 'ticket' && (
        <label className="block">
          <span className="label">Ticket ID <span className="text-cyrixRed-600">*</span></span>
          <input className="input font-mono" value={ticketNo} onChange={e => setTicketNo(e.target.value)} maxLength={60} placeholder="e.g. 285716" />
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={go} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />} I am here
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function CloseStop({ stop, onDone }: { stop: Stop; onDone: (msg: string) => void }) {
  const close = useCloseStop()
  const [shot, setShot] = useState<Shot | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)

  const go = async () => {
    if (!shot) { setError('Take the proof photograph first.'); return }
    setBusy(true); setError(null)
    try {
      const path = await uploadShot(stop.trip_id, 'proof', stop.seq + 100 * attempt.current++, shot.blob)
      const out = await close.mutateAsync({ stopId: stop.id, proofPath: path, at: shot.at, note })
      onDone(out.flagged
        ? `Closed. The photograph was taken ${out.distance_m} m from ${stop.facility_name}'s recorded place, so your manager will see it marked.`
        : out.facility_status === 'pending'
          ? `Closed. This is the first visit recorded at ${stop.facility_name}: its place is set once your manager approves.`
          : 'Closed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink-800">
        <IconChip icon={MapPinned} tone={STOP_KIND[stop.kind].tone} /> At {stop.facility_name}
      </h2>
      <p className="text-sm text-ink-600">
        {STOP_KIND[stop.kind].label}{stop.ticket_no ? ` · ticket ${stop.ticket_no}` : ''} · reached {clockTime(stop.reached_at)}.
        When the work is done, close it with a photograph taken here.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <Camera label="Proof photograph" onShot={x => { setShot(x); if (x) setError(null) }} />
      <label className="block">
        <span className="label">Note</span>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What was done — optional" />
      </label>
      <button type="button" className="btn-primary w-full justify-center" onClick={go} disabled={busy || !shot}>
        {busy ? <Spinner className="h-4 w-4" /> : <Flag className="h-4 w-4" />} Close this stop
      </button>
    </div>
  )
}

/** Ending a leg — by changing mode, or by ending the trip. A fare-paid leg gives its fare and the bill's photograph. */
function LegEndForm({ tripId, leg, mode, modes, ending, onCancel, onDone }: {
  tripId: string; leg: Leg; mode: Mode | undefined; modes: Mode[]; ending: boolean; onCancel: () => void; onDone: () => void
}) {
  const change = useChangeMode()
  const end = useEnd()
  const [next, setNext] = useState('')
  const [fare, setFare] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)
  const onFare = !!mode && mode.per_km === null

  const go = async () => {
    setError(null)
    if (!ending && !next) { setError('Choose how you are travelling next.'); return }
    if (!ending && next === leg.mode) { setError('That is the mode you are already on.'); return }
    const amount = Number(fare)
    if (onFare && (!fare.trim() || !Number.isFinite(amount) || amount < 0)) { setError(`Enter the ${mode!.label.toLowerCase()} fare.`); return }
    if (onFare && !shot) { setError(`Take a photograph of the ${mode!.label.toLowerCase()} bill.`); return }
    setBusy(true)
    try {
      const at = await whereAmI()
      const bill = onFare && shot ? { path: await uploadShot(tripId, 'bill', leg.seq + 100 * attempt.current++, shot.blob), at: shot.at } : null
      const legEnd = { at, from: { lat: leg.from_lat, lng: leg.from_lng }, fare: onFare ? amount : null, bill }
      if (ending) await end.mutateAsync({ tripId, end: legEnd })
      else await change.mutateAsync({ tripId, mode: next, end: legEnd })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink-800">
        <IconChip icon={ending ? Flag : ArrowRightLeft} tone={ending ? 'red' : 'indigo'} /> {ending ? 'End trip' : 'Change mode'}
      </h2>
      <p className="text-sm text-ink-600">
        This closes the {mode?.label.toLowerCase() ?? leg.mode} leg here{onFare ? ', on its fare.' : ', and works out its distance by road.'}
        {ending && ' After this the trip is totalled for you to check and submit.'}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {onFare && (
        <>
          <label className="block">
            <span className="label">{mode!.label} fare (₹) <span className="text-cyrixRed-600">*</span></span>
            <input className="input" inputMode="decimal" value={fare} onChange={e => setFare(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 150" />
          </label>
          <Camera label={`${mode!.label} bill`} onShot={x => { setShot(x); if (x) setError(null) }} />
        </>
      )}
      {!ending && (
        <div>
          <p className="label">Travelling next by</p>
          <ModePicker modes={modes} value={next} onChange={setNext} />
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={go} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : ending ? <Flag className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
          {ending ? 'End the trip here' : 'Change here'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
