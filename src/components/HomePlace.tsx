import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Home, LocateFixed } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { mapLink, placeName, whereAmI, type Point } from '@/lib/geo'
import { dayDate } from '@/lib/when'
import { useSetHome } from '@/lib/travel'

/**
 * The home a trip may start from: where it is, when it was saved, and a way
 * to mark or move it (the user, 1 Oct: "where is home location saved?",
 * then "in home, add mark my home"). It is set by standing there and
 * pressing, the same as every other place here — a home that could be typed
 * could be anywhere. It lives in this module, not on the KPI profile: KPI's
 * pages are not allowed to read a location at all.
 */
export default function HomePlace({ home }: { home: (Point & { set_at: string }) | null | undefined }) {
  const setHome = useSetHome()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Its own key, outside "travel": every move refreshes that, and a home does not need naming again each time.
  const { data: name } = useQuery({
    enabled: !!home,
    queryKey: ['place', home?.lat, home?.lng],
    staleTime: Infinity,
    queryFn: () => placeName(home!),
  })

  const mark = async () => {
    setError(null); setBusy(true)
    try { await setHome.mutateAsync({ at: await whereAmI() }); setAsking(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Your home was not saved.') }
    finally { setBusy(false) }
  }

  // No home yet: it can be marked now, or left to the first trip that starts from home.
  if (!home) {
    return (
      <div className="mt-2">
        {error && <div className="mb-2"><Alert kind="error">{error}</Alert></div>}
        <button type="button" className="btn-secondary w-full justify-center !py-3" onClick={mark} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4 text-cyan-700" />}
          {busy ? 'Reading your location…' : 'Mark my home'}
        </button>
        <p className="mt-1.5 text-xs text-ink-500">Optional. Press it only when you are at home.</p>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
      <div className="flex items-start gap-2.5">
        <Home className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-cyan-900">{name === undefined ? 'Your home' : name ?? `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`}</p>
          <p className="mt-0.5 text-xs text-ink-600">Your home, saved on {dayDate(home.set_at)}. A trip from home is recorded from where you press Start.</p>
        </div>
      </div>
      {error && <div className="mt-2.5"><Alert kind="error">{error}</Alert></div>}
      {asking ? (
        <div className="mt-2.5 space-y-2 pl-[1.875rem]">
          <p className="text-xs text-cyan-900">This makes the place where you are standing now your home.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={mark} disabled={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />} Set home here
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => { setAsking(false); setError(null) }} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-between gap-3 pl-[1.875rem]">
          <a className="link-accent inline-flex items-center gap-1 text-xs text-cyan-900 underline" href={mapLink(home)} target="_blank" rel="noreferrer">
            see on the map <ExternalLink className="h-3 w-3" />
          </a>
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setAsking(true)}>
            <LocateFixed className="h-3.5 w-3.5 text-cyan-700" /> Change home
          </button>
        </div>
      )}
    </div>
  )
}
