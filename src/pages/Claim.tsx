import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, BadgeCheck, Camera as CameraIcon, ChevronRight, ExternalLink, MapPin, Send, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, EmptyState, PageLoader, Spinner } from '@/components/ui'
import Lightbox from '@/components/Lightbox'
import Dialog from '@/components/Dialog'
import ModeArt from '@/components/ModeArt'
import LegHistory from '@/components/LegHistory'
import { mapLink, routeLink } from '@/lib/geo'
import { dateTime, clockTime } from '@/lib/when'
import { STOP_KIND, km, kmDiffers, rideEnds, rideLine, rupees, statusLook, stopsOn, tripName, useDecide, useDeleteTrip, useModes, useShot, useSubmit, useTrip, useTrips } from '@/lib/travel'
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
  const remove = useDeleteTrip()
  const navigate = useNavigate()
  const { isSwAdmin } = useAuth()
  const [deleting, setDeleting] = useState(false)
  // The number a claim was given as it was submitted, shown once in a small dialog.
  const [numbered, setNumbered] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // The ride whose details are open, held by its id so they show the ride as it is now if the claim refreshes under them.
  const [openId, setOpenId] = useState<string | null>(null)

  if (isLoading) return <PageLoader />
  if (!data) return <EmptyState icon={MapPin} title="That trip is not here">It may belong to somebody outside your team.</EmptyState>
  const { trip, legs, stops } = data
  const row = (trips ?? []).find(t => t.id === trip.id)
  const look = statusLook(trip)
  const label = (m: string) => (modes ?? []).find(x => x.mode === m)?.label ?? m
  const mine = !!row?.mine
  const canSubmit = mine && !!trip.ended_at && (trip.status === 'open' || trip.status === 'returned')
  const canDecide = !!row?.can_decide && trip.status === 'submitted'
  // Its engineer while the manager does not hold it, or the software administrator: the database's own rule (te_0006), shown here so the button is only offered where it will work.
  const canDelete = isSwAdmin || (mine && (trip.status === 'open' || trip.status === 'returned'))
  const openLeg = legs.find(l => l.id === openId) ?? null
  const deleteIt = async () => {
    setError(null)
    try { await remove.mutateAsync({ tripId: trip.id }); navigate(back, { replace: true }) }
    catch (e) { setError(e instanceof Error ? e.message : 'The claim was not deleted.'); setDeleting(false) }
  }
  const send = async () => {
    setError(null)
    try { setNumbered(await submit.mutateAsync({ tripId: trip.id }) ?? ''); setDone(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'The claim was not submitted.') }
  }
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
              {trip.code
                ? <h1 className="font-mono text-2xl font-semibold text-ink-900">{trip.code}</h1>
                : <h1 className="text-2xl font-semibold text-ink-900">{tripName(trip)}</h1>}
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
            {!trip.code && mine && <p className="mt-0.5 text-xs text-ink-500">It gets its claim number when you submit it.</p>}
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
                onClick={send}>
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

      {numbered !== null && (
        <Dialog title="Claim submitted" icon={<BadgeCheck className="h-5 w-5 text-green-600" />} onClose={() => setNumbered(null)}>
          <div className="mt-4 space-y-4 text-center">
            <div>
              <p className="label !mb-1">Your claim number</p>
              <p className="font-mono text-4xl font-semibold tracking-tight text-ink-900">{numbered || trip.code}</p>
            </div>
            <p className="text-sm text-ink-600">{rupees(trip.total_amount)} over {km(trip.total_km)}. It is with your manager now.</p>
            <button type="button" className="btn-primary w-full justify-center" onClick={() => setNumbered(null)}>OK</button>
          </div>
        </Dialog>
      )}

      <div className="card overflow-hidden">
        <h2 className="border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">Rides</h2>
        <ul className="divide-y divide-ink-100">
          {legs.map(l => (
            /*
              The whole ride opens its details, as it does in the running
              trip's list. The button is the top line, and its own area is
              stretched over the row, so a press anywhere on the ride opens
              it; the route, the bill and its pin sit above that and go on
              doing what they do. No press-scale here: a transform on the
              button would shrink that area to the button while it is held.
            */
            <li key={l.id} className="relative px-4 py-3 text-sm transition-colors hover:bg-ink-50 active:bg-ink-100">
              {/* The mode and what it pays on one line; how it got there underneath, free to wrap. */}
              <button type="button" onClick={() => setOpenId(l.id)} aria-label={`${label(l.mode)} ride, ${rupees(l.amount)}: open its details`}
                className="flex w-full items-center justify-between gap-3 text-left after:absolute after:inset-0">
                <span className="flex min-w-0 items-center gap-2.5 font-medium text-ink-900">
                  <ModeArt mode={l.mode} className="w-10 rounded-md" />
                  {/* The mode, and where the ride went: "Home → GH Thrissur". */}
                  <span className="min-w-0">
                    {label(l.mode)}
                    {rideLine(rideEnds(l, legs, stops, trip)) && <span className="block truncate text-xs font-normal text-ink-500">{rideLine(rideEnds(l, legs, stops, trip))}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="font-semibold tabular-nums text-ink-900">{rupees(l.amount)}</span>
                  <ChevronRight aria-hidden className="h-4 w-4 text-ink-300" />
                </span>
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-600">
                <span>
                  {clockTime(l.from_at)}{l.to_at ? ` to ${clockTime(l.to_at)}` : ' — still travelling'}
                  {l.to_at && <> · {km(l.road_km)}{l.rate !== null ? ` × ${rupees(l.rate)}` : ' · actual fare'}</>}
                </span>
                {/* The engineer's own figure, beside the one worked out: both are shown, and it is pointed at when they are far apart. */}
                {l.claimed_km !== null && (
                  <span className={clsx('badge', kmDiffers(l) ? 'bg-amber-100 text-amber-900' : 'bg-ink-100 text-ink-700')}
                    title="Entered by the engineer. The ride is paid on the distance worked out.">
                    {kmDiffers(l) && <TriangleAlert className="mr-1 h-3.5 w-3.5" />} engineer’s km: {km(l.claimed_km)}
                  </span>
                )}
                {/* A leg is measured through the stops made on it, so they are named: without them, home and back reads as no distance. */}
                {stopsOn(l, stops).length > 0 && <span>through {stopsOn(l, stops).map(s => s.facility_name).join(', ')}</span>}
                {/* The road it was paid on, through those stops: only a leg paid by the kilometre has one worth opening. */}
                {l.rate !== null && l.to_lat !== null && l.to_lng !== null && (
                  <a className="link-accent relative z-10 inline-flex items-center gap-1" target="_blank" rel="noreferrer"
                    href={routeLink([{ lat: l.from_lat, lng: l.from_lng }, ...stopsOn(l, stops).map(s => ({ lat: s.lat, lng: s.lng })), { lat: l.to_lat, lng: l.to_lng }])}>
                    route <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {l.km_source === 'line' && (
                  <span className="badge bg-cyrixRed-100 text-cyrixRed-900" title="The road distance could not be worked out, or was far from the straight line, so the straight line was paid">
                    <TriangleAlert className="mr-1 h-3.5 w-3.5" /> straight-line distance
                  </span>
                )}
                {l.to_at && l.rate === null && !l.bill_path && <span className="badge bg-amber-100 text-amber-900">No bill photo</span>}
                {l.bill_path && <Photo path={l.bill_path} label="Bill" at={l.bill_lat !== null && l.bill_lng !== null ? { lat: l.bill_lat, lng: l.bill_lng } : null} />}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Its own km can be given or corrected there by the engineer while the claim is still theirs to send; a manager reads it. */}
      {openLeg && (
        <LegHistory leg={openLeg} label={label(openLeg.mode)} legs={legs} stops={stops} trip={trip} theirs={!mine}
          editable={mine && (trip.status === 'open' || trip.status === 'returned')} onClose={() => setOpenId(null)} />
      )}

      <div className="card overflow-hidden">
        <h2 className="border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">Visits</h2>
        {stops.length === 0 ? <p className="p-4 text-sm text-ink-500">No visit was recorded on this trip.</p> : (
          <ul className="divide-y divide-ink-100">
            {stops.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className={clsx('badge', TONE_CLASS[STOP_KIND[s.kind].tone])}>{STOP_KIND[s.kind].label}</span>
                <span className="min-w-0 flex-1 text-ink-800">
                  {s.facility_name}{s.ticket_no && <span className="ml-2 font-mono text-ink-500">ticket {s.ticket_no}</span>}
                  <span className="block text-xs text-ink-500">
                    Reached {clockTime(s.reached_at)}{s.closed_at ? `, finished ${clockTime(s.closed_at)}` : ' — not finished'}{s.note ? ` · ${s.note}` : ''}
                  </span>
                </span>
                {s.flagged && (
                  <span className="badge bg-cyrixRed-100 text-cyrixRed-900"><TriangleAlert className="mr-1 h-3.5 w-3.5" /> {s.distance_m} m from the facility</span>
                )}
                {s.closed_at && s.distance_m === null && <span className="badge bg-amber-100 text-amber-900">First visit here — its location is saved when approved</span>}
                {s.closed_at && s.distance_m !== null && !s.flagged && <span className="badge bg-green-100 text-green-900">At the facility · {s.distance_m} m</span>}
                {s.closed_at && !s.proof_path && <span className="badge bg-amber-100 text-amber-900">No photo</span>}
                {s.proof_path && <Photo path={s.proof_path} label="Proof" at={s.proof_lat !== null && s.proof_lng !== null ? { lat: s.proof_lat, lng: s.proof_lng } : null} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canDelete && (
        <div className="card p-4">
          {/* An error from the delete shows here when the claim has no action bar above to show it in. */}
          {error && !(canSubmit || canDecide) && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
          {deleting ? (
            <div className="space-y-2.5">
              <p className="text-sm text-ink-800">
                Delete {trip.code ? <span className="font-mono font-semibold">{trip.code}</span> : 'this trip'}? Its rides, visits and photos go with it{trip.code ? ', and its number is not used again' : ''}. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-danger" onClick={deleteIt} disabled={remove.isPending}>
                  {remove.isPending ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} Delete claim
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDeleting(false)} disabled={remove.isPending}>Keep it</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-500">{mine ? 'Started by mistake, or only a test?' : 'Removing a claim for good is the software administrator’s to do.'}</p>
              <button type="button" className="btn-secondary" onClick={() => { setError(null); setDeleting(true) }}>
                <Trash2 className="h-4 w-4 text-cyrixRed-600" /> Delete this claim
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A photograph taken in the app: opens over the page, with where it was taken. */
function Photo({ path, label, at }: { path: string; label: string; at: { lat: number; lng: number } | null }) {
  const { data: url } = useShot(path)
  const [open, setOpen] = useState(false)
  return (
    <span className="relative z-10 inline-flex items-center gap-2">
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setOpen(true)} disabled={!url}>
        <CameraIcon className="h-3.5 w-3.5" /> {label}
      </button>
      {at && <a className="text-xs text-ink-500 hover:text-ink-800" href={mapLink(at)} target="_blank" rel="noreferrer" title="Where it was taken"><MapPin className="h-3.5 w-3.5" /></a>}
      {open && url && <Lightbox images={[{ src: url, alt: label }]} index={0} onClose={() => setOpen(false)} onIndex={() => {}} />}
    </span>
  )
}
