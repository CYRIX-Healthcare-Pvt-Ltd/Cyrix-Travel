import { MapPinned, TriangleAlert } from 'lucide-react'
import Dialog from '@/components/Dialog'
import IconChip from '@/components/IconChip'
import { Bill, Place, Row, When } from '@/components/LegHistory'
import { gapLabel } from '@/lib/when'
import { STOP_KIND, type Stop } from '@/lib/travel'

/**
 * One visit, opened by pressing it — in the day's list while the trip is on
 * the road, and on the claim's page afterwards, for the engineer and for the
 * manager deciding it (the user, 2 Oct, once a ride opened its details on
 * the claim: "do same for visits also").
 *
 * When it was reached and when it was finished, where each of those presses
 * was made, how long the visit took, whether it was finished at the
 * facility's own place, what was noted, and its photo. Nothing is changed
 * here: a visit is recorded where and when it happened.
 */
export default function StopHistory({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const kind = STOP_KIND[stop.kind]
  // Where the visit was finished: where its photo was taken or, with no photo, where the phone was then.
  const finished = stop.proof_lat !== null && stop.proof_lng !== null ? { lat: stop.proof_lat, lng: stop.proof_lng } : null
  const stayed = stop.closed_at ? Date.parse(stop.closed_at) - Date.parse(stop.reached_at) : null

  return (
    <Dialog title={kind.label} icon={<IconChip icon={MapPinned} tone={kind.tone} />} onClose={onClose}>
      <p className="mt-1 text-sm font-medium text-ink-700">{stop.facility_name}</p>
      <dl className="mt-4 space-y-3 text-sm">
        {stop.ticket_no && <Row term="Ticket"><span className="font-mono text-ink-900">{stop.ticket_no}</span></Row>}
        <Row term="Reached"><When at={stop.reached_at} /> <Place at={{ lat: stop.lat, lng: stop.lng }} /></Row>
        {stop.closed_at
          ? <Row term="Finished"><When at={stop.closed_at} /> {finished && <Place at={finished} />}</Row>
          : <Row term="Finished"><span className="text-ink-500">Not finished yet</span></Row>}
        {stayed !== null && <Row term="Stayed">{gapLabel(stayed)}</Row>}
        {/* The check a finished visit is given: how far from the facility's agreed place it was finished. */}
        {stop.closed_at && (
          <Row term="Location">
            {stop.flagged ? (
              <>
                <span className="badge bg-cyrixRed-100 text-cyrixRed-900"><TriangleAlert className="mr-1 h-3.5 w-3.5" /> {stop.distance_m} m from the facility</span>
                <span className="mt-1 block text-xs text-ink-500">Finished further from this facility’s saved location than a visit there should be.</span>
              </>
            ) : stop.distance_m === null ? (
              <>
                <span className="badge bg-amber-100 text-amber-900">First visit here</span>
                <span className="mt-1 block text-xs text-ink-500">This facility has no saved location yet. It is saved from this visit when the claim is approved.</span>
              </>
            ) : (
              <>
                <span className="badge bg-green-100 text-green-900">At the facility</span>
                <span className="mt-1 block text-xs text-ink-500">Finished {stop.distance_m} m from this facility’s saved location.</span>
              </>
            )}
          </Row>
        )}
        {stop.note && <Row term="Note">{stop.note}</Row>}
        <Row term="Documents">
          {stop.proof_path
            ? <Bill path={stop.proof_path} label="Photo of the visit" at={finished} />
            : <span className="text-ink-500">{stop.closed_at ? 'No photo' : 'None yet — the photo is taken when the visit is finished'}</span>}
        </Row>
      </dl>
      <button type="button" className="btn-secondary mt-5 w-full justify-center" onClick={onClose}>Close</button>
    </Dialog>
  )
}
