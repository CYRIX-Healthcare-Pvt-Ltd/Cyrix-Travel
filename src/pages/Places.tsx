import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Home, MapPin, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import HomePlace from '@/components/HomePlace'
import { mapLink } from '@/lib/geo'
import { dayDate } from '@/lib/when'
import { useForgetPlace, useHome, usePlaces, type SavedPlace } from '@/lib/travel'

/**
 * My places: the home a trip starts from, and the other places this person
 * starts from often, each under a name of their own (the user, 1 Oct: "in
 * profile under saved place we can see this"). Reached from the name in the
 * header — it is this person's, the way a profile is.
 *
 * A place is saved from Start a trip, by marking where one stands and
 * naming it. There is nothing to type a place into here, and no way to
 * start a trip from this list: a saved place names where the phone is, it
 * never stands in for being there.
 */
export default function Places() {
  const { employee } = useAuth()
  const { data: home, isLoading: homeLoading } = useHome(employee?.id)
  const { data: places, isLoading } = usePlaces()

  if (isLoading || homeLoading) return <PageLoader />
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">My places</h1>
        <p className="mt-0.5 text-sm text-ink-500">Where your trips start from. A place is set by standing there, never typed.</p>
      </div>

      <div className="card p-4">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink-800"><IconChip icon={Home} tone="cyan" /> Home</h2>
        <HomePlace home={home} />
      </div>

      <div className="card overflow-hidden">
        <h2 className="flex items-center gap-2.5 border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">
          <IconChip icon={MapPin} tone="violet" /> Saved places
          {(places ?? []).length > 0 && <span className="ml-auto text-xs font-normal text-ink-500">{places!.length} of 20</span>}
        </h2>
        {(places ?? []).length === 0 ? (
          <p className="p-4 text-sm text-ink-500">
            None yet. When a trip starts from somewhere other than home — the office, a store, a hotel — choose A new place on{' '}
            <Link to="/" className="link-accent underline">Start a trip</Link>, mark your location, and save it under a name. Next time you start from there it is called by that name.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {places!.map(p => <PlaceRow key={p.id} place={p} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function PlaceRow({ place }: { place: SavedPlace }) {
  const forget = useForgetPlace()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setError(null)
    try { await forget.mutateAsync({ id: place.id }) }
    catch (e) { setError(e instanceof Error ? e.message : 'The place was not removed.') }
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">{place.name}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Saved on {dayDate(place.saved_at)} ·{' '}
            <a className="link-accent inline-flex items-center gap-1 underline" href={mapLink(place)} target="_blank" rel="noreferrer">see on the map <ExternalLink className="h-3 w-3" /></a>
          </p>
        </div>
        {!asking && (
          <button type="button" className="btn-icon shrink-0" onClick={() => setAsking(true)} aria-label={`Remove ${place.name}`} title="Remove">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {asking && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-ink-600">Remove this place? Trips already made keep the name they started under.</p>
          <button type="button" className="btn-danger !px-3 !py-1.5 text-xs" onClick={remove} disabled={forget.isPending}>
            {forget.isPending && <Spinner className="h-3.5 w-3.5" />} Remove
          </button>
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => { setAsking(false); setError(null) }} disabled={forget.isPending}>Keep</button>
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
    </li>
  )
}
