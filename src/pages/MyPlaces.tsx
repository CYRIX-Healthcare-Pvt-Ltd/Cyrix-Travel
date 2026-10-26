import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { Building2, House, IdCard, LocateFixed, Map as MapIcon, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import PlacePicker from '@/components/PlacePicker'
import PlaceMapDialog from '@/components/PlaceMapDialog'
import DeputationCard from '@/components/DeputationCard'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { placeName, whereAmI } from '@/lib/geo'
import { useAuth } from '@/contexts/AuthContext'
import { distanceKm, km, rpc, type Place } from '@/lib/claims'

/*
  My places (the user, 17 Oct): the places this person named — home, an office, a hospital they visit
  often — to pick with one tap in any place picker. Added on the map, moved on it and renamed, removed.

  My profile since te_0075 (the user, 26 Oct: "make about changing my place tab to my details", then "my profile"):
  the home, the cost centre, the deputation and the saved places, each with its own colour ("all icon are green
  not good").
*/
const TILE = 'grid h-9 w-9 shrink-0 place-items-center rounded-xl'
export interface SavedPlace extends Place { id: string }
export const useMyPlaces = () => useQuery({ queryKey: ['te_places'], queryFn: () => rpc<SavedPlace[]>('te_places') })

export default function MyPlaces() {
  const qc = useQueryClient()
  const ask = useAsk()
  const { data, isLoading, error } = useMyPlaces()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SavedPlace | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['te_places'] })
  /*
    The home (te_0041, te_0053): marked by standing there and pressing, or set on the map (the user, 21 Oct:
    "home setting is tough, I cannot mark it on the map"). A move, and a home set on the map, are shown to the
    approvers ("showing to approver is enough"). A claim no longer asks for it (te_0054): this page says it is missing.
  */
  const { employee } = useAuth()
  const { data: home } = useQuery({
    queryKey: ['te_home', employee?.id], enabled: !!employee,
    queryFn: async () => (await supabase.from('travel_homes').select('lat, lng, set_at, how').eq('employee_id', employee!.id).maybeSingle()).data as { lat: number; lng: number; set_at: string; how: 'here' | 'map' } | null,
  })
  const { data: homeName } = useQuery({ queryKey: ['place', home?.lat, home?.lng], enabled: !!home, staleTime: Infinity, queryFn: () => placeName(home!) })
  const { data: costCentre } = useQuery({
    queryKey: ['te_cost_centre', employee?.id], enabled: !!employee,
    queryFn: async () => ((await supabase.from('employees').select('function_name').eq('id', employee!.id).maybeSingle()).data?.function_name as string | null)?.trim() || null,
  })
  // Sent here to set a home first, as an advance is from it (te_0063).
  const need = (useLocation().state as { need?: string } | null)?.need
  const [marking, setMarking] = useState(false)
  const [homeOnMap, setHomeOnMap] = useState(false)
  const setHomeAt = async (at: { lat: number; lng: number }, how: 'here' | 'map') => {
    const { error: e } = await supabase.rpc('travel_set_home', { p_lat: at.lat, p_lng: at.lng, p_how: how })
    if (e) throw new Error(e.message)
    await qc.invalidateQueries({ queryKey: ['te_home'] })
  }
  /*
    A change of home says from where to where before it is saved (the user, 21 Oct: "if changing home show an
    alert that home location will be changed from this to that"). The phone's own wobble (under 200 m) is no change.
  */
  const coords = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
  const changeHome = (to: { lat: number; lng: number }, toName: string, how: 'here' | 'map') => ask.confirm({
    title: 'Change your home?',
    body: `From: ${homeName ?? coords(home!)}\nTo: ${toName} · ${km(distanceKm(home!, to))} away\n\nYour approvers will see this move${how === 'map' ? ', set on the map' : ''}.`,
    yes: 'Change home',
  })
  const markHome = async () => {
    setMarking(true); setFail(null)
    try {
      const at = await whereAmI()
      if (home && distanceKm(home, at) >= 0.2 && !(await changeHome(at, (await placeName(at)) ?? coords(at), 'here'))) return
      await setHomeAt(at, 'here')
    } catch (e) { setFail((e as Error).message) } finally { setMarking(false) }
  }
  const homeFromMap = async (p: Place) => {
    setHomeOnMap(false)
    // The same spot chosen again leaves a home marked by standing there as it was.
    if (home && Math.abs(p.lat - home.lat) < 1e-6 && Math.abs(p.lng - home.lng) < 1e-6) return
    const name = p.name && p.name !== '…' ? p.name : coords(p)
    if (!(await (home ? changeHome(p, name, 'map')
      : ask.confirm({ title: 'Set your home here?', body: `${name}\n\nYour approvers will see that it was set on the map.`, yes: 'Set home' })))) return
    setFail(null)
    try { await setHomeAt(p, 'map') } catch (e) { setFail((e as Error).message) }
  }
  const remove = async (p: SavedPlace) => {
    if (!(await ask.confirm({ title: `Remove ${p.name}?`, body: 'It comes off your saved places. Claims that used it keep it.', yes: 'Remove', danger: true }))) return
    try { await rpc('te_delete_place', { p_id: p.id }); await refresh() } catch (e) { setFail((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><IdCard className="h-5 w-5 text-teal-600" /> My profile</h1>
      {(fail || error) && <Alert kind="error">{fail ?? (error as Error).message}</Alert>}
      {home === null && <Alert kind="warning">{need ?? 'Home location is not yet set'}</Alert>}
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <span className={`${TILE} bg-emerald-100 text-emerald-700`}><House className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-900">Home</p>
          {home && <p className="truncate text-xs text-ink-500">{homeName ?? `${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}`} · since {new Date(home.set_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{home.how === 'map' ? ' · set on the map' : ''}</p>}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" className={`${home ? 'btn-secondary' : 'btn-primary'} flex-1 sm:flex-none`} disabled={marking} onClick={() => void markHome()}>
            {marking ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} I'm at home
          </button>
          <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={() => setHomeOnMap(true)}><MapIcon className="h-4 w-4" /> On the map</button>
        </div>
      </div>
      <div className="card flex items-center gap-3 px-4 py-3">
        <span className={`${TILE} bg-sky-100 text-sky-700`}><Building2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-900">Cost centre</p>
          <p className="truncate text-xs text-ink-500">{costCentre ?? 'Not mapped'}</p>
        </div>
      </div>
      <DeputationCard />
      <div className="flex items-center justify-between gap-3 pt-2">
        <h2 className="text-sm font-semibold text-ink-800">Saved places</h2>
        <button type="button" className="btn-primary !py-1.5 text-sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a place</button>
      </div>
      {!data?.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">No saved places yet.</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`${TILE} bg-amber-100 text-amber-700`}><MapPin className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{p.name}</p>
                <p className="text-xs text-ink-500">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Edit" title="Edit" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></button>
              <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Remove" title="Remove" onClick={() => void remove(p)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <PlacePicker title="Add a place" start={null} quick={[]} askName
          onPick={async (p, name) => {
            setAdding(false)
            try { await rpc('te_save_place', { p_id: null, p_name: name || p.name.split(',')[0], p_lat: p.lat, p_lng: p.lng }); await refresh() } catch (e) { setFail((e as Error).message) }
          }}
          onClose={() => setAdding(false)} />
      )}
      {homeOnMap && (
        <PlacePicker title="Your home" start={home ? { name: homeName ?? 'Home', lat: home.lat, lng: home.lng } : null} quick={[]} plain yes={home ? 'Move home here' : 'Set as home'}
          onPick={p => void homeFromMap(p)} onClose={() => setHomeOnMap(false)} />
      )}
      {editing && (
        <PlaceMapDialog place={editing} onClose={() => setEditing(null)}
          onSave={async p => { await rpc('te_save_place', { p_id: editing.id, p_name: p.name, p_lat: p.lat, p_lng: p.lng }); setEditing(null); await refresh() }} />
      )}
    </div>
  )
}
