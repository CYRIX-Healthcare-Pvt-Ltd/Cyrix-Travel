import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, BadgeCheck, Camera as CameraIcon, ExternalLink, MapPin, Send, TriangleAlert, Undo2 } from 'lucide-react'
import { Alert, EmptyState, PageLoader, Spinner } from '@/components/ui'
import Lightbox from '@/components/Lightbox'
import ModeArt from '@/components/ModeArt'
import { mapLink, routeLink } from '@/lib/geo'
import { dateTime, clockTime } from '@/lib/when'
import { STOP_KIND, km, rupees, statusLook, stopsOn, useDecide, useModes, useShot, useSubmit, useTrip, useTrips } from '@/lib/travel'
import { TONE_CLASS } from '@/lib/tones'

/** One trip, laid out as it happened: its legs with distance and amount, its stops with their proof. */
export default function Claim() {
  const { id } = useParams()
  const back = (useLocation().state as { back?: string } | null)?.back ?? '/claims'
  const { data, isLoading } = useTrip(id)
  const { data: trips } = useTrips()
  const { data: modes } = useModes()
  const submit = useSubmit()
  const decide = useDecide()
  const [note, setNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (isLoading) return <PageLoader />
  if (!data) return <EmptyState icon={MapPin} title="That trip is not here">It may belong to somebody outside your team.</EmptyState>
  const { trip, legs, stops } = data
  const row = (trips ?? []).find(t => t.id === trip.id)
  const look = statusLook(trip)
  const label = (m: string) => (modes ?? []).find(x => x.mode === m)?.label ?? m
  const mine = !!row?.mine
  const canSubmit = mine && !!trip.ended_at && (trip.status === 'open' || trip.status === 'returned')
  const canDecide = !!row?.can_decide && trip.status === 'submitted'
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null)
    try { await fn(); setDone(msg); setReturning(false) } catch (e) { setError(e instanceof Error ? e.message : 'That did not go through.') }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Back</Link>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold text-ink-900">{trip.code}</h1>
              <span className={clsx('badge', TONE_CLASS[look.tone])}>{look.label}</span>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {row && !mine && <>{row.employee_name} <span className="text-ink-400">{row.employee_ecode}</span> · </>}
              {dateTime(trip.started_at)}{trip.ended_at ? ` to ${clockTime(trip.ended_at)}` : ' — still on the road'}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Started from {trip.start_kind === 'home' ? 'home' : trip.start_note ?? 'a new place'} ·{' '}
              <a className="link-accent" href={mapLink({ lat: trip.start_lat, lng: trip.start_lng })} target="_blank" rel="noreferrer">see on the map</a>
            </p>
            {trip.decision_note && (
              <p className="mt-2 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">
                {trip.status === 'returned' ? 'Sent back' : 'Manager'}{row?.decided_by_name ? ` by ${row.decided_by_name}` : ''}: {trip.decision_note}
              </p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="label !mb-0">Claim</p>
            <p className="text-2xl font-semibold tabular-nums text-ink-900">{rupees(trip.total_amount)}</p>
            <p className="text-xs text-ink-500">{km(trip.total_km)}</p>
          </div>
        </div>

        {(canSubmit || canDecide) && (
          <div className="space-y-3 border-t border-ink-200 bg-ink-50 p-4 sm:px-5">
            {error && <Alert kind="error">{error}</Alert>}
            {canSubmit && (
              <button type="button" className="btn-primary" disabled={submit.isPending}
                onClick={() => run(() => submit.mutateAsync({ tripId: trip.id }), 'Submitted. It is with your manager.')}>
                {submit.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Submit to my manager
              </button>
            )}
            {canDecide && !returning && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={decide.isPending}
                  onClick={() => run(() => decide.mutateAsync({ tripId: trip.id, approve: true }), 'Approved.')}>
                  {decide.isPending ? <Spinner className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4 text-green-600" />} Approve {rupees(trip.total_amount)}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setReturning(true)}><Undo2 className="h-4 w-4" /> Send back</button>
              </div>
            )}
            {canDecide && returning && (
              <div className="space-y-2">
                <label className="label" htmlFor="why">Why is it sent back?</label>
                <textarea id="why" rows={2} className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} autoFocus placeholder="e.g. The bus fare does not match the bill" />
                <div className="flex gap-2">
                  <button type="button" className="btn-danger" disabled={note.trim().length < 5 || decide.isPending}
                    onClick={() => run(() => decide.mutateAsync({ tripId: trip.id, approve: false, note }), 'Sent back, with your reason.')}>Send back</button>
                  <button type="button" className="btn-secondary" onClick={() => setReturning(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {done && <Alert kind="success">{done}</Alert>}

      <div className="card overflow-hidden">
        <h2 className="border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">Legs</h2>
        <ul className="divide-y divide-ink-100">
          {legs.map(l => (
            <li key={l.id} className="px-4 py-3 text-sm">
              {/* The mode and what it pays on one line; how it got there underneath, free to wrap. */}
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5 font-medium text-ink-900">
                  <ModeArt mode={l.mode} className="w-10 rounded-md" /> {label(l.mode)}
                </span>
                <span className="font-semibold tabular-nums text-ink-900">{rupees(l.amount)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-600">
                <span>
                  {clockTime(l.from_at)}{l.to_at ? ` to ${clockTime(l.to_at)}` : ' — running'}
                  {l.to_at && <> · {km(l.road_km)}{l.rate !== null ? ` × ${rupees(l.rate)}` : ' · actual fare'}</>}
                </span>
                {/* A leg is measured through the stops made on it, so they are named: without them, home and back reads as no distance. */}
                {stopsOn(l, stops).length > 0 && <span>through {stopsOn(l, stops).map(s => s.facility_name).join(', ')}</span>}
                {/* The road it was paid on, through those stops: only a leg paid by the kilometre has one worth opening. */}
                {l.rate !== null && l.to_lat !== null && l.to_lng !== null && (
                  <a className="link-accent inline-flex items-center gap-1" target="_blank" rel="noreferrer"
                    href={routeLink([{ lat: l.from_lat, lng: l.from_lng }, ...stopsOn(l, stops).map(s => ({ lat: s.lat, lng: s.lng })), { lat: l.to_lat, lng: l.to_lng }])}>
                    route <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {l.km_source === 'line' && (
                  <span className="badge bg-cyrixRed-100 text-cyrixRed-900" title="The road distance could not be worked out, or was far from the straight line, so the straight line was paid">
                    <TriangleAlert className="mr-1 h-3.5 w-3.5" /> straight-line distance
                  </span>
                )}
                {l.bill_path && <Photo path={l.bill_path} label="Bill" at={l.bill_lat !== null && l.bill_lng !== null ? { lat: l.bill_lat, lng: l.bill_lng } : null} />}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card overflow-hidden">
        <h2 className="border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">Stops</h2>
        {stops.length === 0 ? <p className="p-4 text-sm text-ink-500">No stop was recorded on this trip.</p> : (
          <ul className="divide-y divide-ink-100">
            {stops.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className={clsx('badge', TONE_CLASS[STOP_KIND[s.kind].tone])}>{STOP_KIND[s.kind].label}</span>
                <span className="min-w-0 flex-1 text-ink-800">
                  {s.facility_name}{s.ticket_no && <span className="ml-2 font-mono text-ink-500">ticket {s.ticket_no}</span>}
                  <span className="block text-xs text-ink-500">
                    Reached {clockTime(s.reached_at)}{s.closed_at ? `, closed ${clockTime(s.closed_at)}` : ' — not closed'}{s.note ? ` · ${s.note}` : ''}
                  </span>
                </span>
                {s.flagged && (
                  <span className="badge bg-cyrixRed-100 text-cyrixRed-900"><TriangleAlert className="mr-1 h-3.5 w-3.5" /> {s.distance_m} m from the facility</span>
                )}
                {s.closed_at && s.distance_m === null && <span className="badge bg-amber-100 text-amber-900">First visit — sets the facility’s place</span>}
                {s.closed_at && s.distance_m !== null && !s.flagged && <span className="badge bg-green-100 text-green-900">At the facility · {s.distance_m} m</span>}
                {s.proof_path && <Photo path={s.proof_path} label="Proof" at={s.proof_lat !== null && s.proof_lng !== null ? { lat: s.proof_lat, lng: s.proof_lng } : null} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** A photograph taken in the app: opens over the page, with where it was taken. */
function Photo({ path, label, at }: { path: string; label: string; at: { lat: number; lng: number } | null }) {
  const { data: url } = useShot(path)
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setOpen(true)} disabled={!url}>
        <CameraIcon className="h-3.5 w-3.5" /> {label}
      </button>
      {at && <a className="text-xs text-ink-500 hover:text-ink-800" href={mapLink(at)} target="_blank" rel="noreferrer" title="Where it was taken"><MapPin className="h-3.5 w-3.5" /></a>}
      {open && url && <Lightbox images={[{ src: url, alt: label }]} index={0} onClose={() => setOpen(false)} onIndex={() => {}} />}
    </span>
  )
}
