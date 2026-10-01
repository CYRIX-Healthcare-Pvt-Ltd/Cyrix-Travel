import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, BookmarkCheck, BookmarkPlus, Check, ExternalLink, Flag, Home, LocateFixed, MapPin, MapPinCheck, MapPinned, Play } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import ModeArt, { modeLook } from '@/components/ModeArt'
import HomePlace from '@/components/HomePlace'
import StartRide, { SwapRide } from '@/components/StartRide'
import Camera, { type Shot } from '@/components/Camera'
import { lineKm, mapLink, placeName, whereAmI, type Fix, type Point } from '@/lib/geo'
import { clockTime } from '@/lib/when'
import {
  STOP_KIND, km, placeAt, rupees, startTrip, stopsOn, tripName, uploadShot, useChangeMode, useCloseStop, useDeleteTrip, useEnd, useHome, useKnownFacilities, useModes, usePhotosRequired, usePlaces, useReach, useSavePlace, useTrip, useTrips,
  type Leg, type Mode, type SavedPlace, type Stop, type StopKind,
} from '@/lib/travel'
import { TONE_CLASS } from '@/lib/tones'
import { artOf } from '@/lib/modeArt'

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
          {unsent.map(t => <Link key={t.id} to={`/claims/${t.id}`} className="link-accent mr-3">{tripName(t)}</Link>)}
        </Alert>
      )}
      {running ? <Running tripId={running.id} /> : <StartCard />}
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
  { kind: 'home', label: 'Home', icon: Home, tint: 'text-cyan-700', on: 'border-cyan-400 bg-cyan-100 text-cyan-900 ring-1 ring-cyan-400' },
  { kind: 'new', label: 'A new place', icon: MapPin, tint: 'text-violet-700', on: 'border-violet-400 bg-violet-100 text-violet-900 ring-1 ring-violet-400' },
] as const

/** A place marked with a press: the point, what it is called, and when it was read. */
interface Mark { at: Fix; name: string | null; when: number }

/** A mark older than this is read again at Start: a place marked a while ago is not where Start was pressed. */
const MARK_KEEPS_MS = 5 * 60_000

/** The least a start is seen to take, so the vehicle is seen arriving even when the phone answers at once; and how long it takes to ride out. */
const RIDE_MS = 900
const LEAVE_MS = 450
/** The least a change of mode is seen to take: the walk across, and the new vehicle seen to start. */
const SWAP_MS = 1500

/**
 * The place just marked: what it is called, when it was read and how
 * closely, and — if it is somewhere this person starts from often — a way to
 * save it under a name of their own (the user, 1 Oct: "in a new place also,
 * we should have option to save this place, with name"). At a saved place it
 * is called by that name instead of the map's.
 */
function MarkedPlace({ mark, saved, marking, busy, onAgain }: {
  mark: Mark; saved: SavedPlace | null; marking: boolean; busy: boolean; onAgain: () => void
}) {
  const save = useSavePlace()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const keep = async () => {
    setError(null)
    if (name.trim().length < 2) { setError('Give the place a name.'); return }
    try { await save.mutateAsync({ name, at: mark.at }); setNaming(false); setName('') }
    catch (e) { setError(e instanceof Error ? e.message : 'The place was not saved.') }
  }

  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
      {/* The name has the whole width: a place is three or four words long, and beside a button it broke onto as many lines. */}
      <div className="flex items-start gap-2.5">
        {saved ? <BookmarkCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" /> : <MapPinCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-violet-900">{saved?.name ?? mark.name ?? `${mark.at.lat.toFixed(5)}, ${mark.at.lng.toFixed(5)}`}</p>
          <p className="mt-0.5 text-xs text-ink-600">
            {saved && 'Your saved place · '}Marked at {clockTime(mark.when)}{Number.isFinite(mark.at.accuracy) ? `, to about ${Math.max(1, Math.round(mark.at.accuracy))} m` : ''}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 pl-[1.875rem]">
        <a className="link-accent inline-flex items-center gap-1 text-xs text-violet-900 underline" href={mapLink(mark.at)} target="_blank" rel="noreferrer">
          see on the map <ExternalLink className="h-3 w-3" />
        </a>
        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={onAgain} disabled={marking || busy}>
          {marking ? <Spinner className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5 text-violet-700" />} Mark again
        </button>
      </div>
      {!saved && (naming ? (
        <div className="mt-3 space-y-2 border-t border-violet-200 pt-3 pl-[1.875rem]">
          <label className="block">
            <span className="label">Name this place</span>
            <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Office, Thrissur store" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') keep() }} />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={keep} disabled={save.isPending}>
              {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />} Save place
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => { setNaming(false); setError(null) }} disabled={save.isPending}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-press mt-2.5 ml-[1.875rem] inline-flex items-center gap-1.5 rounded-lg py-1 text-xs font-medium text-violet-900 underline" onClick={() => setNaming(true)}>
          <BookmarkPlus className="h-3.5 w-3.5 text-violet-700" /> Save this place under a name
        </button>
      ))}
    </div>
  )
}

function StartCard() {
  const { employee } = useAuth()
  const { data: modes } = useModes()
  const { data: home } = useHome(employee?.id)
  const { data: places } = usePlaces()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'home' | 'new'>('home')
  const [mark, setMark] = useState<Mark | null>(null)
  const [marking, setMarking] = useState(false)
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  // The place is known and the trip is being made: the vehicle rides out.
  const [leaving, setLeaving] = useState(false)
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
    if (busy) return
    setError(null)
    if (kind === 'new' && !mark) { setError('Mark your location first.'); return }
    if (!mode) { setError('Choose how you are travelling.'); return }
    setBusy(true); setLeaving(false)
    // The vehicle is given time to be seen — unless less motion has been asked for, when there is no ride to wait for.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = (ms: number) => new Promise(done => setTimeout(done, still ? 0 : ms))
    const ride = wait(RIDE_MS)
    try {
      let at: Point, note: string | undefined
      if (kind === 'new') {
        const [from] = await Promise.all([Date.now() - mark!.when > MARK_KEEPS_MS ? readMark() : mark!, ride])
        // At a saved place the trip is recorded under the name its owner gave it; otherwise under the map's.
        at = from.at; note = placeAt(places ?? [], from.at)?.name ?? from.name ?? undefined
      } else {
        [at] = await Promise.all([whereAmI(), ride])
      }
      // The trip is made while the vehicle is still on the button. Only once it exists does the vehicle ride out —
      // a start that fails leaves it where it is, under the reason — and only then is the screen refreshed, which
      // is what puts the trip's own screen in this one's place.
      await startTrip({ kind, at, mode, note })
      setLeaving(true)
      await wait(LEAVE_MS)
      await qc.invalidateQueries({ queryKey: ['travel'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The trip did not start.')
      setBusy(false); setLeaving(false)
    }
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
        {kind === 'home' && <HomePlace home={home} />}
        {kind === 'new' && (mark ? (
          <MarkedPlace mark={mark} saved={placeAt(places ?? [], mark.at)} marking={marking} busy={busy} onAgain={markHere} />
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
      {/* Not disabled while it works: a disabled button is dimmed, and the ride is the thing to be seen. go() ignores a second press. */}
      <button type="button" aria-busy={busy} onClick={go} disabled={marking}
        className={clsx('relative w-full justify-center overflow-hidden !py-3 text-base',
          busy ? clsx('btn start-run border', modeLook(mode).on, modeLook(mode).scene, modeLook(mode).art, artOf(mode) === 'train' && 'on-rails', leaving && 'start-off') : 'btn-primary')}>
        {busy ? <StartRide mode={mode} /> : <><Play className="h-5 w-5" /> Start</>}
      </button>
    </div>
  )
}

type Panel = 'reach' | 'change' | 'end' | null

function Running({ tripId }: { tripId: string }) {
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
            {/* No number here: a trip is numbered when its claim is submitted, so one cancelled uses none. */}
            <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-ink-900">
              On the road
              {/* What the legs closed so far come to (the user, 1 Oct: "show the total sum also"). The leg being travelled joins it when it is closed. */}
              <span className="tabular-nums">· {rupees(data.trip.total_amount)}</span>
              <span className="text-sm font-normal text-ink-500">so far</span>
            </p>
            <p className="text-sm text-ink-500">since {clockTime(data.trip.started_at)} · {km(data.trip.total_km)}</p>
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
          via={stopsOn(leg, data.stops).map(s => ({ lat: s.lat, lng: s.lng }))}
          onCancel={() => setPanel(null)}
          onDone={() => { if (panel === 'end') navigate(`/claims/${tripId}`); else done('Mode changed. The last leg is closed with its distance.') }}
        />
      )}
      <CancelTrip tripId={tripId} />
    </div>
  )
}

/**
 * A trip started by mistake, cancelled from the screen it is running on (the
 * user, 1 Oct: "what if mistakenly started, there is no option to cancel
 * trip"). It is the same deleting a claim's own page offers; here it is
 * within reach of the mistake. Quiet until it is wanted, and asked twice:
 * it sits under the buttons an engineer presses all day.
 */
function CancelTrip({ tripId }: { tripId: string }) {
  const remove = useDeleteTrip()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setError(null)
    // Gone, the list of trips has none running, and Start a trip takes this screen's place by itself.
    try { await remove.mutateAsync({ tripId }) } catch (e) { setError(e instanceof Error ? e.message : 'The trip was not cancelled.') }
  }

  if (!asking) {
    return (
      <p className="pt-1 text-center">
        <button type="button" className="link-accent text-xs text-ink-500 underline" onClick={() => setAsking(true)}>Started by mistake? Cancel this trip</button>
      </p>
    )
  }
  return (
    <div className="card space-y-2.5 p-4">
      {error && <Alert kind="error">{error}</Alert>}
      <p className="text-sm text-ink-800">
        Cancel this trip? It is deleted with its legs, stops and photographs, and nothing is claimed for it. It has taken no claim number. This cannot be undone.
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn-danger" onClick={go} disabled={remove.isPending}>
          {remove.isPending ? <Spinner className="h-4 w-4" /> : <Flag className="h-4 w-4" />} Cancel the trip
        </button>
        <button type="button" className="btn-secondary" onClick={() => { setAsking(false); setError(null) }} disabled={remove.isPending}>Keep going</button>
      </div>
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
  const { data: known } = useKnownFacilities()
  const { data: places } = usePlaces()
  /*
   * Where the phone is as the form opens, read once, to offer the name of the
   * place: a facility whose place a manager has agreed, or else one of this
   * person's own saved places, within the same 300 m either way. It only
   * fills the box — what is recorded is still read at "I am here" — and it
   * never writes over something already typed.
   */
  const [here, setHere] = useState<Point | null>(null)
  const typed = useRef(false)
  useEffect(() => {
    let alive = true
    whereAmI().then(p => { if (alive) setHere(p) }).catch(() => { /* no name is offered; the form works as it did */ })
    return () => { alive = false }
  }, [])
  const offered = useMemo(() => {
    if (!here) return null
    let best: string | null = null, near = 0.3
    for (const f of known ?? []) { if (f.status !== 'approved') continue; const d = lineKm(f, here); if (d <= near) { best = f.name; near = d } }
    return best ?? placeAt(places ?? [], here)?.name ?? null
  }, [here, known, places])
  useEffect(() => { if (offered && !typed.current) setFacility(offered) }, [offered])

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
        <input className="input" list="travel-facilities" value={facility} onChange={e => { typed.current = true; setFacility(e.target.value) }} maxLength={200} placeholder="e.g. GH Thrissur" />
        <datalist id="travel-facilities">{(known ?? []).map(f => <option key={f.name} value={f.name} />)}</datalist>
        {offered && facility === offered && (
          <span className="mt-1.5 block text-xs text-ink-500">Filled in from where you are. Change it if you are somewhere else.</span>
        )}
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
  const required = usePhotosRequired()
  const [shot, setShot] = useState<Shot | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)

  const go = async () => {
    if (!shot && required) { setError('Take the proof photograph first.'); return }
    setBusy(true); setError(null)
    try {
      // With a photograph, the stop is closed where it was taken; without one (while none is required), where the phone is now.
      const path = shot ? await uploadShot(stop.trip_id, 'proof', stop.seq + 100 * attempt.current++, shot.blob) : null
      const out = await close.mutateAsync({ stopId: stop.id, proofPath: path, at: shot ? shot.at : await whereAmI(), note })
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
        {/* "I am here" read the phone's place; this is where to see that it did, and where. */}
        {' '}Your location was read when you pressed I am here: <a className="link-accent underline" href={mapLink({ lat: stop.lat, lng: stop.lng })} target="_blank" rel="noreferrer">see it on the map</a>.
        {' '}When the work is done, close it with a photograph taken here.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <Camera label="Proof photograph" optional={!required} onShot={x => { setShot(x); if (x) setError(null) }} />
      <label className="block">
        <span className="label">Note</span>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What was done — optional" />
      </label>
      <button type="button" className="btn-primary w-full justify-center" onClick={go} disabled={busy || (required && !shot)}>
        {busy ? <Spinner className="h-4 w-4" /> : <Flag className="h-4 w-4" />} Close this stop
      </button>
    </div>
  )
}

/** Ending a leg — by changing mode, or by ending the trip. A fare-paid leg gives its fare and the bill's photograph. */
function LegEndForm({ tripId, leg: legNow, mode: modeNow, modes, ending, via = [], onCancel, onDone }: {
  tripId: string; leg: Leg; mode: Mode | undefined; modes: Mode[]; ending: boolean
  /** The stops made on this leg: its distance goes through them, not past them. */
  via?: Point[]
  onCancel: () => void; onDone: () => void
}) {
  const change = useChangeMode()
  const end = useEnd()
  /*
   * The leg this form was opened to close, held. Once the change is made the
   * trip's running leg is the new one, and this form is still on screen for a
   * moment showing the change of vehicle — it must go on being about the leg
   * that was closed, or the vehicle being left turns into the one being taken.
   */
  const [{ leg, mode }] = useState({ leg: legNow, mode: modeNow })
  const required = usePhotosRequired()
  const [next, setNext] = useState('')
  const [fare, setFare] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  // The change is made: the new vehicle rides out.
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)
  const onFare = !!mode && mode.per_km === null
  // Changing mode, with the next one chosen and the work under way: the button shows the change of vehicle.
  const swapping = busy && !ending && !!next

  const go = async () => {
    setError(null)
    if (!ending && !next) { setError('Choose how you are travelling next.'); return }
    if (!ending && next === leg.mode) { setError('That is the mode you are already on.'); return }
    const amount = Number(fare)
    if (onFare && (!fare.trim() || !Number.isFinite(amount) || amount < 0)) { setError(`Enter the ${mode!.label.toLowerCase()} fare.`); return }
    if (onFare && !shot && required) { setError(`Take a photograph of the ${mode!.label.toLowerCase()} bill.`); return }
    if (busy) return
    setBusy(true); setLeaving(false)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = (ms: number) => new Promise(done => setTimeout(done, still ? 0 : ms))
    // The walk from one vehicle to the next is given time to be seen; ending a trip has no such thing to show.
    const seen = wait(ending ? 0 : SWAP_MS)
    try {
      const at = await whereAmI()
      const bill = onFare && shot ? { path: await uploadShot(tripId, 'bill', leg.seq + 100 * attempt.current++, shot.blob), at: shot.at } : null
      const legEnd = { at, from: { lat: leg.from_lat, lng: leg.from_lng }, via, fare: onFare ? amount : null, bill }
      if (ending) await end.mutateAsync({ tripId, end: legEnd })
      else {
        await Promise.all([change.mutateAsync({ tripId, mode: next, end: legEnd }), seen])
        setLeaving(true)
        await wait(LEAVE_MS)
      }
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
        This closes the {mode?.label.toLowerCase() ?? leg.mode} leg here{onFare ? ', on its fare.' : via.length ? `, and works out its distance by road through the ${via.length === 1 ? 'stop' : `${via.length} stops`} you made.` : ', and works out its distance by road.'}
        {ending && ' After this the trip is totalled for you to check and submit.'}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {onFare && (
        <>
          <label className="block">
            <span className="label">{mode!.label} fare (₹) <span className="text-cyrixRed-600">*</span></span>
            <input className="input" inputMode="decimal" value={fare} onChange={e => setFare(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 150" />
          </label>
          <Camera label={`${mode!.label} bill`} optional={!required} onShot={x => { setShot(x); if (x) setError(null) }} />
        </>
      )}
      {!ending && (
        <div>
          <p className="label">Travelling next by</p>
          <ModePicker modes={modes} value={next} onChange={setNext} />
        </div>
      )}
      <div className="flex gap-2">
        {/* While a change is shown it is not disabled — a disabled button is dimmed — and go() ignores a second press. */}
        <button type="button" aria-busy={busy} onClick={go} disabled={busy && !swapping}
          className={clsx('relative flex-1 justify-center overflow-hidden',
            swapping ? clsx('btn start-run swap-run border', modeLook(next).on, modeLook(next).scene, artOf(next) === 'train' && 'on-rails', leaving && 'start-off') : 'btn-primary')}>
          {swapping ? <SwapRide from={leg.mode} to={next} fromArt={modeLook(leg.mode).art} /> : (
            <>
              {busy ? <Spinner className="h-4 w-4" /> : ending ? <Flag className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
              {ending ? 'End the trip here' : 'Change here'}
            </>
          )}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}
