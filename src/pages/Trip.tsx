import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, BookmarkCheck, BookmarkPlus, Check, ChevronRight, ExternalLink, FileText, Flag, Home, LocateFixed, MapPin, MapPinCheck, MapPinned, Play } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import ModeArt, { modeLook } from '@/components/ModeArt'
import HomePlace from '@/components/HomePlace'
import StartRide, { SwapRide } from '@/components/StartRide'
import LegHistory from '@/components/LegHistory'
import StopHistory from '@/components/StopHistory'
import ConfirmPlace from '@/components/ConfirmPlace'
import MiniMap from '@/components/MiniMap'
import Camera, { type Shot } from '@/components/Camera'
import { lineKm, mapLink, placeName, whereAmI, type Fix, type Point } from '@/lib/geo'
import { clockTime, dayDate, localDay } from '@/lib/when'
import {
  STOP_KIND, km, placeAt, resumeTrip, rideEnds, rideLine, rupees, startTrip, stopsOn, tripName, uploadShot, useChangeMode, useClaimKm, useCloseStop, useDeleteTrip, useEnd, useHome, useKnownFacilities, useModes, usePhotosRequired, usePlaces, useReach, useSavePlace, useTrip, useTrips,
  type Leg, type Mode, type SavedPlace, type Stop, type StopKind, type Trip as TripRecord,
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

/*
 * The least a start is seen to take, so the vehicle is seen arriving even
 * when the phone answers at once; and how long it takes to ride out. Then
 * the least a change of mode is seen to take: the walk across, and the new
 * vehicle seen to start.
 *
 * Each of the two is half a second shorter than it first was — Start 0.85s
 * from 1.35s, a change 1.45s from 1.95s, the ride out counted in both (the
 * user, 2 Oct: "start n change mode animation reduce by 0.5 secs"). They
 * are floors: a phone slow to say where it is keeps the vehicle on the
 * button for as long as it takes. The motion in index.css is timed to fit
 * inside them, and is changed with them.
 */
const RIDE_MS = 550
const LEAVE_MS = 300
const SWAP_MS = 1150

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
      <MiniMap at={mark.at} accuracy={mark.at.accuracy} className="mt-2.5 !h-32" />
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
  /*
   * The first Start from Home saves that place as the engineer's home — and
   * Home is what is chosen when the screen opens. Somebody starting their
   * first trip from the office, who presses Start without reading, would
   * have the office saved as their home. So that one start asks first.
   */
  const [askHome, setAskHome] = useState(false)

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

  const go = async (atHome = false) => {
    if (busy) return
    setError(null)
    if (kind === 'new' && !mark) { setError('Mark your location first.'); return }
    if (!mode) { setError('Choose how you are travelling.'); return }
    if (kind === 'home' && home === null && !atHome) { setAskHome(true); return }
    setAskHome(false)
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
        <p className="mt-0.5 text-sm text-ink-500">Press Start when you begin travelling. Your location is read each time you press a button, and the distance is calculated for you.</p>
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
      {askHome && !busy && (
        <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
          <p className="text-sm text-cyan-900">
            <span className="font-semibold">Are you at home now?</span> You have no home saved yet, so starting from Home saves this place as your home.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-2 text-sm" onClick={() => go(true)}>Yes, I am at home — start</button>
            <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => { setAskHome(false); setKind('new') }}>No, I am somewhere else</button>
          </div>
        </div>
      )}
      <button type="button" aria-busy={busy} onClick={() => go()} disabled={marking}
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
  // A leg runs only while the engineer travels: reaching a place ends it (te_0009), and they set off again after.
  const leg = data.legs.find(l => !l.to_at) ?? null
  const openStop = data.stops.find(s => !s.closed_at) ?? null
  // Where they are when nothing is travelling: the stop they are at, or the one they last closed.
  const lastStop = openStop ?? [...data.stops].sort((a, b) => b.seq - a.seq)[0] ?? null
  const lastLeg = [...data.legs].sort((a, b) => b.seq - a.seq)[0] ?? null
  const mode = (modes ?? []).find(m => m.mode === leg?.mode)
  const look = modeLook(leg?.mode)
  const done = (msg: string) => { setPanel(null); setNotice(msg) }
  // Started on an earlier day and still not ended: almost always End trip was forgotten.
  const stale = localDay(data.trip.started_at) < localDay()

  return (
    <div className="space-y-4">
      {stale && (
        <Alert kind="warning" title={`This trip was started on ${dayDate(data.trip.started_at, false)} and was never ended`}>
          If you forgot to end it, end it now and say so to your manager — the last ride will be measured to where you are today. If it was a mistake, cancel it below.
        </Alert>
      )}
      <div className="card overflow-hidden">
        <div aria-hidden className={clsx('h-1', leg ? look.bar : 'bg-ink-300')} />
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            {/* No number here: a trip is numbered when its claim is submitted, so one cancelled uses none. */}
            <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-ink-900">
              {/* On the road while a leg runs; at the place while it does not (the user, 2 Oct: "reached means now he is not in vehicle"). */}
              {leg ? 'On the road' : `At ${lastStop?.facility_name ?? 'a visit'}`}
              {/* What the legs closed so far come to (the user, 1 Oct: "show the total sum also"). The leg being travelled joins it when it is closed. */}
              <span className="tabular-nums">· {rupees(data.trip.total_amount)}</span>
              <span className="text-sm font-normal text-ink-500">so far</span>
            </p>
            <p className="text-sm text-ink-500">since {clockTime(data.trip.started_at)} · {km(data.trip.total_km)}</p>
          </div>
          {leg && (
            <span data-running={leg.mode} className={clsx('flex shrink-0 items-center gap-2 rounded-xl py-1 pl-1 pr-3 text-sm font-medium', look.pill)}>
              {/* It stands only on a trip from before te_0009 whose leg ran on through a stop; a leg made now is always moving. */}
              <ModeArt mode={leg.mode} moving={!openStop} chosen className="w-14 rounded-lg" />
              {mode?.label ?? leg.mode}
            </span>
          )}
        </div>
        <Journey legs={data.legs} stops={data.stops} modes={modes ?? []} trip={data.trip} />
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}

      {openStop ? (
        <CloseStop stop={openStop} onDone={msg => done(msg)} />
      ) : !leg ? (
        <SetOff tripId={tripId} place={lastStop?.facility_name ?? null} came={lastLeg?.mode ?? null} modes={modes ?? []} onEnded={() => navigate(`/claims/${tripId}`)} />
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
          {/* Which of the three, and when: an engineer new to it does not know that Reached is for a place and Change mode is not. */}
          <ul className="space-y-0.5 px-1 pt-1 text-xs text-ink-500">
            <li><span className="font-medium text-ink-700">Reached</span> — you have arrived at a hospital, a store or a meeting.</li>
            <li><span className="font-medium text-ink-700">Change mode</span> — you are switching vehicle on the way, bike to bus.</li>
            <li><span className="font-medium text-ink-700">End trip</span> — you are home, or done travelling for the day.</li>
          </ul>
        </div>
      ) : panel === 'reach' ? (
        <ReachForm tripId={tripId} leg={leg} mode={mode} stops={data.stops} onCancel={() => setPanel(null)} onEndInstead={() => setPanel('end')}
          onDone={() => done(`You have reached. Your ${(mode?.label ?? leg.mode).toLowerCase()} ride ends here. When the work is done, finish the visit below.`)} />
      ) : (
        <LegEndForm
          tripId={tripId} leg={leg} mode={mode} modes={modes ?? []} ending={panel === 'end'}
          via={stopsOn(leg, data.stops).map(s => ({ lat: s.lat, lng: s.lng }))}
          onCancel={() => setPanel(null)}
          onDone={() => { if (panel === 'end') navigate(`/claims/${tripId}`); else done('Mode changed. The last ride is saved with its distance.') }}
        />
      )}
      <CancelTrip tripId={tripId} />
    </div>
  )
}

/**
 * After a stop is closed: the engineer is at the place and nothing is
 * travelling. They set off again — the next leg, from where they are, by
 * the mode they choose, which is the one they came on until they say
 * otherwise — or end the trip here if this was the last place (the user,
 * 2 Oct: "so after activity he can start again isnt?").
 *
 * Set off is Start again: the same button, the same vehicle riding out.
 */
function SetOff({ tripId, place, came, modes, onEnded }: {
  tripId: string; place: string | null; came: string | null; modes: Mode[]; onEnded: () => void
}) {
  const qc = useQueryClient()
  const end = useEnd()
  const [mode, setMode] = useState(came && modes.some(m => m.mode === came && m.is_active) ? came : '')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    if (busy || ending) return
    setError(null)
    if (!mode) { setError('Choose how you are travelling.'); return }
    setBusy(true); setLeaving(false)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = (ms: number) => new Promise(done => setTimeout(done, still ? 0 : ms))
    const ride = wait(RIDE_MS)
    try {
      const [at] = await Promise.all([whereAmI(), ride])
      await resumeTrip({ tripId, at, mode })
      setLeaving(true)
      await wait(LEAVE_MS)
      await qc.invalidateQueries({ queryKey: ['travel'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.')
      setBusy(false); setLeaving(false)
    }
  }

  const finish = async () => {
    if (busy || ending) return
    setError(null); setEnding(true)
    try {
      const at = await whereAmI()
      // No leg is running, so there is none to measure: the trip simply ends where the phone is.
      await end.mutateAsync({ tripId, end: { at, from: at } })
      onEnded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The trip did not end.')
      setEnding(false)
    }
  }

  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-ink-900">Leaving{place ? ` ${place}` : ''}?</h2>
        <p className="mt-0.5 text-sm text-ink-500">Choose how you are travelling next and press Start again. If this was your last place for the day, end the trip here.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <p className="label">Travelling next by</p>
        <ModePicker modes={modes} value={mode} onChange={setMode} />
      </div>
      <button type="button" aria-busy={busy} onClick={go} disabled={ending}
        className={clsx('relative w-full justify-center overflow-hidden !py-3 text-base',
          busy ? clsx('btn start-run border', modeLook(mode).on, modeLook(mode).scene, modeLook(mode).art, artOf(mode) === 'train' && 'on-rails', leaving && 'start-off') : 'btn-primary')}>
        {busy ? <StartRide mode={mode} /> : <><Play className="h-5 w-5" /> Start again</>}
      </button>
      <button type="button" className="btn-secondary w-full justify-center !py-3" onClick={finish} disabled={busy || ending}>
        {ending ? <Spinner className="h-4 w-4" /> : <Flag className="h-4 w-4 text-cyrixRed-600" />} End the trip here
      </button>
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
        Cancel this trip? It is deleted with its rides, visits and photos, and nothing is claimed for it. This cannot be undone.
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

/**
 * The day so far: each leg and each stop, in the order they happened.
 *
 * A leg says when it ran, shows a paper if it has a bill, and opens its
 * history when pressed — times, places, distance, documents (the user,
 * 2 Oct: "can we add each mode start n end time? … add a document icon also
 * and on click each mode, small history"). A stop opens its own the same
 * way: when it was reached and finished, where, and its photo (the user,
 * 2 Oct: "do same for visits also").
 */
function Journey({ legs, stops, modes, trip }: { legs: Leg[]; stops: Stop[]; modes: Mode[]; trip: TripRecord }) {
  const label = (m: string) => modes.find(x => x.mode === m)?.label ?? m
  const closed = legs.filter(l => l.to_at)
  // Held by its id, so the history shows the leg as it is now if the list refreshes under it.
  const [openId, setOpenId] = useState<string | null>(null)
  const open = legs.find(l => l.id === openId) ?? null
  const [shownStopId, setShownStopId] = useState<string | null>(null)
  const shownStop = stops.find(s => s.id === shownStopId) ?? null
  if (closed.length === 0 && stops.length === 0) return null
  // One line of the day in the order it went: a leg to a place, the stop there, the leg on from it. A leg and
  // the stop it ended at share a moment, and the leg comes first — the journey, then the arrival.
  const day = [
    ...closed.map(l => ({ at: Date.parse(l.from_at), leg: l, stop: null as Stop | null })),
    ...stops.map(s => ({ at: Date.parse(s.reached_at), leg: null as Leg | null, stop: s })),
  ].sort((a, b) => a.at - b.at || (a.leg ? -1 : 1))
  return (
    <>
      <ul className="divide-y divide-ink-100 border-t border-ink-200 text-sm">
        {day.map(({ leg: l, stop: s }) => l ? (
          <li key={l.id}>
            <button type="button" onClick={() => setOpenId(l.id)} aria-label={`${label(l.mode)} ride, ${clockTime(l.from_at)} to ${clockTime(l.to_at!)}: open its details`}
              className="btn-press flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-ink-50">
              <ModeArt mode={l.mode} className="w-9 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-700">
                  {label(l.mode)} <span className="text-ink-400">· {km(l.road_km)}</span>
                  {/* Their own figure beside the one worked out, where they gave one. */}
                  {l.claimed_km !== null && <span className="text-ink-400"> · yours {km(l.claimed_km)}</span>}
                </span>
                <span className="block truncate text-xs tabular-nums text-ink-500">
                  {clockTime(l.from_at)} – {clockTime(l.to_at!)}{rideLine(rideEnds(l, legs, stops, trip)) ? ` · ${rideLine(rideEnds(l, legs, stops, trip))}` : ''}
                </span>
              </span>
              {l.bill_path && <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-label="Has a bill photo" />}
              <span className="shrink-0 tabular-nums font-medium text-ink-900">{rupees(l.amount)}</span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-300" />
            </button>
          </li>
        ) : s && (
          <li key={s.id}>
            <button type="button" onClick={() => setShownStopId(s.id)} aria-label={`${STOP_KIND[s.kind].label} at ${s.facility_name}: open its details`}
              className="btn-press flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-ink-50">
              <span className="min-w-0 truncate text-ink-700">
                <span className={clsx('badge mr-2', TONE_CLASS[STOP_KIND[s.kind].tone])}>{STOP_KIND[s.kind].label}</span>
                {s.facility_name}{s.ticket_no ? ` · ${s.ticket_no}` : ''}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {s.proof_path && <FileText className="h-4 w-4 text-ink-400" aria-label="Has a photo" />}
                <span className={clsx('text-xs', s.closed_at ? 'text-green-700' : 'text-amber-700')}>{s.closed_at ? 'Done' : 'In progress'}</span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-300" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <LegHistory leg={open} label={label(open.mode)} legs={legs} stops={stops} trip={trip} editable onClose={() => setOpenId(null)} />}
      {shownStop && <StopHistory stop={shownStop} onClose={() => setShownStopId(null)} />}
    </>
  )
}

/**
 * The engineer's own kilometres for the ride that is ending — optional, and
 * only for a ride paid by the kilometre. It is kept beside the distance the
 * map works out and shown with it; it does not change what is paid.
 */
function OwnKmField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">Your km <span className="font-normal normal-case tracking-normal text-ink-400">— optional</span></span>
      <input className="input" inputMode="decimal" value={value} onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 12.5" />
      <span className="mt-1.5 block text-xs text-ink-500">From your odometer, if you want it noted. The distance is still calculated for you, and your manager sees both.</span>
    </label>
  )
}

/** What was typed for "Your km": a number, nothing, or not a distance at all. */
function readOwnKm(typed: string): { km: number | null; bad: boolean } {
  if (!typed.trim()) return { km: null, bad: false }
  const n = Number(typed)
  return Number.isFinite(n) && n > 0 && n <= 2000 ? { km: n, bad: false } : { km: null, bad: true }
}

function ReachForm({ tripId, leg: legNow, mode: modeNow, stops, onCancel, onDone, onEndInstead }: {
  tripId: string; leg: Leg; mode: Mode | undefined; stops: Stop[]; onCancel: () => void; onDone: () => void
  /** Home, or done for the day: there is no visit to record, and End trip is the form for it. */
  onEndInstead: () => void
}) {
  const reach = useReach()
  const { employee } = useAuth()
  const { data: home } = useHome(employee?.id)
  const required = usePhotosRequired()
  // The leg this arrival ends, held: once it is closed the trip has no running leg, and this form is still on screen for a moment.
  const [{ leg, mode }] = useState({ leg: legNow, mode: modeNow })
  // A ride paid on its fare ends here, so its fare and its bill are given here.
  const onFare = !!mode && mode.per_km === null
  const [fare, setFare] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const attempt = useRef(0)
  const claim = useClaimKm()
  const [own, setOwn] = useState('')
  /*
   * The place the phone read at "I am here", held while it is shown on the
   * map and asked about. Nothing is recorded until the engineer says yes:
   * a reading on a weak signal can be far out, and an arrival cannot be
   * taken back (the user, 2 Oct: "in im here, do we have a confirmation pop?").
   */
  const [fix, setFix] = useState<{ at: Fix; when: number } | null>(null)
  const [reading, setReading] = useState(false)
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
  // The same 300 m a saved place answers to: within it, the phone is at home.
  const atHome = !!here && !!home && lineKm(home, here) <= 0.3

  /** What the form needs before a place is worth reading: said one thing at a time. */
  const missing = (): string | null => {
    if (facility.trim().length < 2) return 'Enter the facility, or the place, you have reached.'
    if (kind === 'ticket' && !ticketNo.trim()) return 'Enter the ticket ID you came for.'
    const amount = Number(fare)
    if (onFare && (!fare.trim() || !Number.isFinite(amount) || amount < 0)) return `Enter the ${mode!.label.toLowerCase()} fare.`
    if (onFare && !shot && required) return `Take a photo of the ${mode!.label.toLowerCase()} bill.`
    if (readOwnKm(onFare ? '' : own).bad) return 'Enter your km as a number, or leave it empty.'
    return null
  }

  /** Reads where the phone is and shows it; nothing is recorded yet. */
  const read = async () => {
    setError(null); setReading(true)
    try { setFix({ at: await whereAmI(), when: Date.now() }) }
    catch (e) { setFix(null); setError(e instanceof Error ? e.message : 'Your location could not be read.') }
    finally { setReading(false) }
  }
  const ask = () => { const why = missing(); if (why) { setError(why); return } void read() }

  /** "Yes, I am here": the place that was shown is the place that is recorded. */
  const go = async () => {
    if (!fix || busy) return
    // Looked at a while ago is not where the phone is now: read again and show that instead.
    if (Date.now() - fix.when > 3 * 60_000) { await read(); return }
    const why = missing()
    if (why) { setFix(null); setError(why); return }
    const amount = Number(fare), mine = readOwnKm(onFare ? '' : own), at = fix.at
    setError(null); setBusy(true)
    try {
      const bill = onFare && shot ? { path: await uploadShot(tripId, 'bill', leg.seq + 100 * attempt.current++, shot.blob), at: shot.at } : null
      await reach.mutateAsync({
        tripId, kind, facility, ticketNo: kind === 'ticket' ? ticketNo : undefined, at,
        end: { at, from: { lat: leg.from_lat, lng: leg.from_lng }, via: stopsOn(leg, stops).map(s => ({ lat: s.lat, lng: s.lng })), fare: onFare ? amount : null, bill },
      })
      // The ride is closed; their own figure goes on it. If that does not go through the arrival still stands, and the figure can be given from the ride's details.
      if (mine.km !== null) await claim.mutateAsync({ legId: leg.id, km: mine.km }).catch(() => {})
      onDone()
    } catch (e) {
      // Back to the form, where the reason can be read and put right.
      setFix(null)
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink-800"><IconChip icon={MapPinned} tone="indigo" /> Reached</h2>
      <p className="text-sm text-ink-600">
        Your {mode?.label.toLowerCase() ?? leg.mode} ride ends here{onFare ? ', and is paid on its fare.' : ', and its distance is calculated.'} You start again after the visit.
      </p>
      {/*
        Arriving home is not a visit, and this form has nothing for it: the
        day ends with End trip (the user, 2 Oct, home again by auto and in
        this form: "what if return to home or last destination to close the
        trip?"). Said plainly when the phone is at the saved home, quietly
        otherwise.
      */}
      {atHome ? (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
          <div className="flex items-start gap-2.5">
            <Home className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-cyan-900">You are at home</p>
              <p className="mt-0.5 text-xs text-ink-600">Back for the day? Home is not a visit, so there is nothing to fill in here. End the trip instead.</p>
            </div>
          </div>
          <button type="button" className="btn-secondary mt-2.5 w-full justify-center" onClick={onEndInstead} disabled={busy}>
            <Flag className="h-4 w-4 text-cyrixRed-600" /> End trip
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">Back home, or done for the day? That is not a visit.</p>
          <button type="button" className="btn-secondary shrink-0 !px-2.5 !py-1.5 text-xs" onClick={onEndInstead} disabled={busy}>
            <Flag className="h-3.5 w-3.5 text-cyrixRed-600" /> End trip instead
          </button>
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <p className="label">This visit is for</p>
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
      {onFare && (
        <>
          <label className="block">
            <span className="label">{mode!.label} fare (₹) <span className="text-cyrixRed-600">*</span></span>
            <input className="input" inputMode="decimal" value={fare} onChange={e => setFare(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 150" />
          </label>
          <Camera label={`${mode!.label} bill`} optional={!required} onShot={x => { setShot(x); if (x) setError(null) }} />
        </>
      )}
      {!onFare && <OwnKmField value={own} onChange={setOwn} />}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={ask} disabled={busy || reading}>
          {reading ? <Spinner className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />} {reading && !fix ? 'Reading your location…' : 'I am here'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {fix && <ConfirmPlace fix={fix.at} busy={busy} reading={reading} onYes={go} onAgain={read} onCancel={() => { if (!busy) setFix(null) }} />}
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
    if (!shot && required) { setError('Take the photo first.'); return }
    setBusy(true); setError(null)
    try {
      // With a photograph, the stop is closed where it was taken; without one (while none is required), where the phone is now.
      const path = shot ? await uploadShot(stop.trip_id, 'proof', stop.seq + 100 * attempt.current++, shot.blob) : null
      const out = await close.mutateAsync({ stopId: stop.id, proofPath: path, at: shot ? shot.at : await whereAmI(), note })
      onDone(out.flagged
        ? `Visit finished. The photo was taken ${out.distance_m} m from ${stop.facility_name}'s saved location, so your manager will see it marked.`
        : out.facility_status === 'pending'
          ? `Visit finished. This is the first visit recorded at ${stop.facility_name}: its location is saved once your manager approves.`
          : 'Visit finished.')
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
        {' '}Your location was read when you pressed I am here (<a className="link-accent underline" href={mapLink({ lat: stop.lat, lng: stop.lng })} target="_blank" rel="noreferrer">see it on the map</a>).
        {' '}When your work is done, take a photo here and press Finish this visit.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <Camera label="Photo of the visit" optional={!required} onShot={x => { setShot(x); if (x) setError(null) }} />
      {/* What to point the camera at: asked by everybody the first time. */}
      <p className="!mt-1.5 text-xs text-ink-500">Take it at the place — for example the service report, or the equipment you worked on.</p>
      <label className="block">
        <span className="label">Note</span>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What was done — optional" />
      </label>
      <button type="button" className="btn-primary w-full justify-center" onClick={go} disabled={busy || (required && !shot)}>
        {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Finish this visit
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
  const claim = useClaimKm()
  const [own, setOwn] = useState('')
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
    if (onFare && !shot && required) { setError(`Take a photo of the ${mode!.label.toLowerCase()} bill.`); return }
    if (busy) return
    const mine = readOwnKm(onFare ? '' : own)
    if (mine.bad) { setError('Enter your km as a number, or leave it empty.'); return }
    // Their own figure goes on the ride once it is closed; if that does not go through, the ride still stands.
    const saveOwn = async () => { if (mine.km !== null) await claim.mutateAsync({ legId: leg.id, km: mine.km }).catch(() => {}) }
    setBusy(true); setLeaving(false)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = (ms: number) => new Promise(done => setTimeout(done, still ? 0 : ms))
    // The walk from one vehicle to the next is given time to be seen; ending a trip has no such thing to show.
    const seen = wait(ending ? 0 : SWAP_MS)
    try {
      const at = await whereAmI()
      const bill = onFare && shot ? { path: await uploadShot(tripId, 'bill', leg.seq + 100 * attempt.current++, shot.blob), at: shot.at } : null
      const legEnd = { at, from: { lat: leg.from_lat, lng: leg.from_lng }, via, fare: onFare ? amount : null, bill }
      if (ending) { await end.mutateAsync({ tripId, end: legEnd }); await saveOwn() }
      else {
        await Promise.all([change.mutateAsync({ tripId, mode: next, end: legEnd }).then(saveOwn), seen])
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
        Your {mode?.label.toLowerCase() ?? leg.mode} ride ends here{onFare ? ', and is paid on its fare.' : ', and its distance is calculated.'}
        {ending && ' Then you check the total and submit the claim.'}
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
      {!onFare && <OwnKmField value={own} onChange={setOwn} />}
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
