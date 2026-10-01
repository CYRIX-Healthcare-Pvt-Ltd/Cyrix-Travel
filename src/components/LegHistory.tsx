import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText } from 'lucide-react'
import Dialog from '@/components/Dialog'
import Lightbox from '@/components/Lightbox'
import ModeArt from '@/components/ModeArt'
import { Spinner } from '@/components/ui'
import { mapLink, placeName, routeLink, type Point } from '@/lib/geo'
import { clockTime, gapLabel } from '@/lib/when'
import { km, rupees, stopsOn, useShot, type Leg, type Stop } from '@/lib/travel'

/**
 * One leg, opened from the day's list while the trip is still on the road:
 * when it began and ended and where, how far it was and what it pays, the
 * stops made on it, and its bill if it has one (the user, 2 Oct: "on click
 * each mode, small history with start n from time, location, documents").
 *
 * The same facts a claim's page lays out afterwards; here they are within
 * reach while the engineer can still see that a leg came out wrong.
 */
export default function LegHistory({ leg, label, stops, onClose }: { leg: Leg; label: string; stops: Stop[]; onClose: () => void }) {
  const from = { lat: leg.from_lat, lng: leg.from_lng }
  const to = leg.to_lat !== null && leg.to_lng !== null ? { lat: leg.to_lat, lng: leg.to_lng } : null
  const made = stopsOn(leg, stops)
  const took = leg.to_at ? Date.parse(leg.to_at) - Date.parse(leg.from_at) : null

  return (
    <Dialog title={`${label} leg`} icon={<ModeArt mode={leg.mode} className="w-10 rounded-md" />} onClose={onClose}>
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
            : <span className="text-ink-500">{leg.rate === null && leg.to_at ? 'No bill photograph' : 'None — this leg is paid by the kilometre'}</span>}
        </Row>
      </dl>
      <button type="button" className="btn-secondary mt-5 w-full justify-center" onClick={onClose}>Close</button>
    </Dialog>
  )
}

const Row = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-24 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-label text-ink-500">{term}</dt>
    <dd className="min-w-0 flex-1 text-ink-800">{children}</dd>
  </div>
)

const When = ({ at }: { at: string }) => <span className="font-medium tabular-nums text-ink-900">{clockTime(at)}</span>

/** Where a press was made: what the place is called, once the map has said, and a link to it. */
function Place({ at }: { at: Point }) {
  // Outside "travel": every move refreshes that, and a place does not need naming again each time.
  const { data: name, isLoading } = useQuery({ queryKey: ['place', at.lat, at.lng], staleTime: Infinity, queryFn: () => placeName(at) })
  return (
    <span className="block text-ink-600">
      {isLoading ? <Spinner className="inline h-3.5 w-3.5" /> : name ?? `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`}{' '}
      <a className="link-accent inline-flex items-center gap-1 text-xs underline" href={mapLink(at)} target="_blank" rel="noreferrer">map <ExternalLink className="h-3 w-3" /></a>
    </span>
  )
}

/** The bill, small; a press opens it over the page. */
function Bill({ path, label, at }: { path: string; label: string; at: Point | null }) {
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
