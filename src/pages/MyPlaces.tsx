import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import PlacePicker from '@/components/PlacePicker'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader } from '@/components/ui'
import { rpc, type Place } from '@/lib/claims'

/*
  My places (the user, 17 Oct): the places this person named — home, an office, a hospital they visit
  often — to pick with one tap in any place picker. Added on the map, renamed, removed.
*/
export interface SavedPlace extends Place { id: string }
export const useMyPlaces = () => useQuery({ queryKey: ['te_places'], queryFn: () => rpc<SavedPlace[]>('te_places') })

export default function MyPlaces() {
  const qc = useQueryClient()
  const ask = useAsk()
  const { data, isLoading, error } = useMyPlaces()
  const [adding, setAdding] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['te_places'] })
  const rename = async (p: SavedPlace) => {
    const name = await ask.prompt({ title: 'Rename place', label: 'Name', placeholder: p.name, yes: 'Save' })
    if (!name) return
    try { await rpc('te_save_place', { p_id: p.id, p_name: name, p_lat: null, p_lng: null }); await refresh() } catch (e) { setFail((e as Error).message) }
  }
  const remove = async (p: SavedPlace) => {
    if (!(await ask.confirm({ title: `Remove ${p.name}?`, body: 'It comes off your saved places. Claims that used it keep it.', yes: 'Remove', danger: true }))) return
    try { await rpc('te_delete_place', { p_id: p.id }); await refresh() } catch (e) { setFail((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><MapPin className="h-5 w-5 text-teal-600" /> My places</h1>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a place</button>
      </div>
      {(fail || error) && <Alert kind="error">{fail ?? (error as Error).message}</Alert>}
      {!data?.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">No saved places yet. Add your home, office or a hospital you visit often.</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <MapPin className="h-4 w-4 shrink-0 text-teal-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{p.name}</p>
                <p className="text-xs text-ink-500">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Rename" title="Rename" onClick={() => void rename(p)}><Pencil className="h-4 w-4" /></button>
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
    </div>
  )
}
