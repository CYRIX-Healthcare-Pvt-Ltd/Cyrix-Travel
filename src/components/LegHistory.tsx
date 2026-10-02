import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText } from 'lucide-react'
import Dialog from '@/components/Dialog'
import Lightbox from '@/components/Lightbox'
import ModeArt from '@/components/ModeArt'
import { Spinner } from '@/components/ui'
import { mapLink, placeName, routeLink, type Point } from '@/lib/geo'
import { clockTime, gapLabel } from '@/lib/when'
import { km, kmDiffers, rideEnds, rideLine, rupees, stopsOn, useClaimKm, useShot, type Leg, type Stop, type Trip } from '@/lib/travel'

/**
 * One leg, opened by pressing it: when it began and ended and where, how
 * far it was and what it pays, the stops made on it, and its bill if it
 * has one (the user, 2 Oct: "on click each mode, small history with start n
 * from time, location, documents").
 *
 * It opens from the day's list while the trip is still on the road, where
 * the engineer can still see that a leg came out wrong; and from the
 * claim's page afterwards, for the engineer and for the manager deciding
 * it (the user, 2 Oct: "on the claim, if i click auto / bus, can i see the
 * history? like we have in earlier stages?").
 */
export default function LegHistory({ leg, label, legs, stops, trip, onClose, editable = false, theirs = false }: {
  leg: Leg; label: string; legs: Leg[]; stops: Stop[]; trip: Trip; onClose: () => void
  /** The engineer's own trip, not yet with the manager: their km can be given or corrected here. */
  editable?: boolean
  /** Somebody else's claim is being read — a manager's view: the engineer's figure is called theirs, not "yours". */
  theirs?: boolean
}) {
  const line = rideLine(rideEnds(leg, legs, stops, trip))
  const from = { lat: leg.from_lat, lng: leg.from_lng }
  const to = leg.to_lat !== null && leg.to_lng !== null ? { lat: leg.to_lat, lng: leg.to_lng } : null
  const made = stopsOn(leg, stops)
  const took = leg.to_at ? Date.parse(leg.to_at) - Date.parse(leg.from_at) : null

  return (
    <Dialog title={`${label} ride`} icon={<ModeArt mode={leg.mode} className="w-10 rounded-md" />} onClose={onClose}>
      {line && <p className="mt-1 text-sm font-medium text-ink-700">{line}</p>}
      <dl className="mt-4 space-y-3 text-sm">
        <Row term="Started"><When at={leg.from_at} /> <Place at={from} /></Row>
        {leg.to_at && to
          ? <Row term="Ended"><When at={leg.to_at} /> <Place at={to} /></Row>
          : <Row term="Ended"><span className="text-ink-500">Still running</span></Row>}
        {took !== null && <Row term="Took">{gapLabel(took)}</Row>}
        {leg.to_at && (
          <Row term="Distance">
            {km(leg.road_km)}{' '}
            <span className="text-ink-500">{leg.km_source === 'line' ? 'on the straight line — the road could not be worked out' : 'by road'}</span>
            {to && (
              <a className="link-accent ml-2 inline-flex items-center gap-1 underline" target="_blank" rel="noreferrer"
                href={routeLink([from, ...made.map(s => ({ lat: s.lat, lng: s.lng })), to])}>route <ExternalLink className="h-3 w-3" /></a>
            )}
          </Row>
        )}
        {leg.to_at && leg.rate !== null && (leg.claimed_km !== null || editable) && (
          <Row term={theirs ? 'Engineer’s km' : 'Your km'}><OwnKm leg={leg} editable={editable} /></Row>
        )}
        {made.length > 0 && <Row term="Through">{made.map(s => s.facility_name).join(', ')}</Row>}
        {leg.to_at && (
          <Row term="Pays">
            <span className="font-semibold tabular-nums text-ink-900">{rupees(leg.amount)}</span>{' '}
            <span className="text-ink-500">{leg.rate !== null ? `${km(leg.road_km)} × ${rupees(leg.rate)}` : 'the actual fare'}</span>
          </Row>
        )}
        <Row term="Documents">
          {leg.bill_path
            ? <Bill path={leg.bill_path} label={`${label} bill`} at={leg.bill_lat !== null && leg.bill_lng !== null ? { lat: leg.bill_lat, lng: leg.bill_lng } : null} />
            : <span className="text-ink-500">{leg.rate === null && leg.to_at ? 'No bill photo' : 'None — this ride is paid by the kilometre'}</span>}
        </Row>
      </dl>
      <button type="button" className="btn-secondary mt-5 w-full justify-center" onClick={onClose}>Close</button>
    </Dialog>
  )
}

/** One line of the details: what it is, then what it was. Shared with a visit's (StopHistory). */
export const Row = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-24 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-label text-ink-500">{term}</dt>
    <dd className="min-w-0 flex-1 text-ink-800">{children}</dd>
  </div>
)

/**
 * The engineer's own kilometres for the ride, beside the distance worked out
 * (the user, 2 Oct: "show what km we got and what eng inputted, both"). It
 * is a second figure for the manager to see; the ride is paid on the first.
 */
function OwnKm({ leg, editable }: { leg: Leg; editable: boolean }) {
  const save = useClaimKm()
  const [value, setValue] = useState(leg.claimed_km?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const typed = value.trim() === '' ? null : Number(value)
  const changed = typed !== leg.claimed_km

  const keep = async () => {
    setError(null)
    if (typed !== null && (!Number.isFinite(typed) || typed <= 0 || typed > 2000)) { setError('Enter the km as a number.'); return }
    try { await save.mutateAsync({ legId: leg.id, km: typed }) } catch (e) { setError(e instanceof Error ? e.message : 'That was not saved.') }
  }

  if (!editable) {
    return <>{km(leg.claimed_km)} {kmDiffers(leg) && <span className="badge ml-1 bg-amber-100 text-amber-900">differs from the {km(leg.road_km)} worked out</span>}</>
  }
  return (
    <span className="block space-y-1.5">
      <span className="flex items-center gap-2">
        <input className="input !w-24 !py-1.5 tabular-nums" inputMode="decimal" value={value} placeholder="e.g. 12.5" aria-label="Your km for this ride"
          onChange={e => setValue(e.target.value.replace(/[^0-9.]/g, ''))} />
        <span className="text-ink-500">km</span>
        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={keep} disabled={!changed || save.isPending}>
          {save.isPending && <Spinner className="h-3.5 w-3.5" />} Save
        </button>
      </span>
      <span className="block text-xs text-ink-500">From your odometer, if it differs. Your manager sees both; the ride is paid on the distance worked out.</span>
      {error && <span className="block text-xs text-cyrixRed-700">{error}</span>}
    </span>
  )
}

export const When = ({ at }: { at: string }) => <span className="font-medium tabular-nums text-ink-900">{clockTime(at)}</span>

/** Where a press was made: what the place is called, once the map has said, and a link to it. */
export function Place({ at }: { at: Point }) {
  // Outside "travel": every move refreshes that, and a place does not need naming again each time.
  const { data: name, isLoading } = useQuery({ queryKey: ['place', at.lat, at.lng], staleTime: Infinity, queryFn: () => placeName(at) })
  return (
    <span className="block text-ink-600">
      {isLoading ? <Spinner className="inline h-3.5 w-3.5" /> : name ?? `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`}{' '}
      <a className="link-accent inline-flex items-center gap-1 text-xs underline" href={mapLink(at)} target="_blank" rel="noreferrer">map <ExternalLink className="h-3 w-3" /></a>
    </span>
  )
}

/** The bill — or a visit's photo — small; a press opens it over the page. */
export function Bill({ path, label, at }: { path: string; label: string; at: Point | null }) {
  const { data: url } = useShot(path)
  const [open, setOpen] = useState(false)
  return (
    <span className="block">
      <button type="button" className="btn-press block overflow-hidden rounded-lg border border-ink-200 bg-ink-50" onClick={() => setOpen(true)} disabled={!url} aria-label={`Open the ${label.toLowerCase()}`}>
        {url
          ? <img src={url} alt={label} className="h-24 w-32 object-cover" />
          : <span className="grid h-24 w-32 place-items-center text-ink-400"><FileText className="h-6 w-6" /></span>}
      </button>
      {at && <a className="link-accent mt-1 inline-flex items-center gap-1 text-xs underline" href={mapLink(at)} target="_blank" rel="noreferrer">where it was taken <ExternalLink className="h-3 w-3" /></a>}
      {open && url && <Lightbox images={[{ src: url, alt: label }]} index={0} onClose={() => setOpen(false)} onIndex={() => {}} />}
    </span>
  )
}
