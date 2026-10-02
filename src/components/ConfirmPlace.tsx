import { useQuery } from '@tanstack/react-query'
import { LocateFixed, MapPinned } from 'lucide-react'
import Dialog from '@/components/Dialog'
import MiniMap from '@/components/MiniMap'
import { Alert, Spinner } from '@/components/ui'
import { placeName, type Fix } from '@/lib/geo'

/** Beyond this the phone is guessing: said in words, and in amber. */
const WEAK_M = 100

/**
 * "Is this where you are?" — the place the phone has read, shown on a map
 * before it is recorded.
 *
 * "I am here" ends a ride and opens a visit, and there was nothing between
 * the press and the record: a reading taken on a weak signal went in as it
 * was, and a press at the wrong place could not be taken back (the user,
 * 2 Oct: "in im here, do we have a confirmation pop?"). This is the look
 * before the leap — the pin, how sure the phone is, the place's name — with
 * a way to read again and a way out.
 */
export default function ConfirmPlace({ fix, busy, reading, onYes, onAgain, onCancel }: {
  fix: Fix
  /** The arrival is being recorded. */
  busy: boolean
  /** The location is being read again. */
  reading: boolean
  onYes: () => void
  onAgain: () => void
  onCancel: () => void
}) {
  // Outside "travel": every move refreshes that, and a place does not need naming again each time.
  const { data: name, isLoading } = useQuery({ queryKey: ['place', fix.lat, fix.lng], staleTime: Infinity, queryFn: () => placeName(fix) })
  const off = Number.isFinite(fix.accuracy) ? Math.max(1, Math.round(fix.accuracy)) : null
  const weak = off !== null && off > WEAK_M

  return (
    <Dialog title="Is this where you are?" icon={<MapPinned className="h-5 w-5 text-indigo-500" />} onClose={onCancel}>
      <div className="mt-4 space-y-3">
        <MiniMap at={fix} accuracy={fix.accuracy} />
        <div>
          <p className="text-sm font-medium text-ink-900">
            {isLoading ? <Spinner className="inline h-3.5 w-3.5" /> : name ?? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`}
          </p>
          {off !== null && <p className="mt-0.5 text-xs text-ink-500">Your phone places you within about {off} m of the pin — the blue ring.</p>}
        </div>
        {weak && (
          <Alert kind="warning">
            The signal is weak, so the pin may be up to {off} m off. If it is not where you are, step outside or wait a moment and press Read again.
          </Alert>
        )}
        <div className="grid gap-2">
          <button type="button" className="btn-primary w-full justify-center !py-3" onClick={onYes} disabled={busy || reading}>
            {busy ? <Spinner className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />} Yes, I am here
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary justify-center" onClick={onAgain} disabled={busy || reading}>
              {reading ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} Read again
            </button>
            <button type="button" className="btn-secondary justify-center" onClick={onCancel} disabled={busy}>Not here — cancel</button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
