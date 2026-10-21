import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'

/*
  A learned place on the map, for a Travel admin (the user, 21 Oct: "how to check in map or reallocate?"):
  its pin dragged, or the right spot tapped, and its name put right, then saved for everyone.
*/
export interface MapPlace { id: string; name: string; full_name: string; lat: number; lng: number }

export default function PlaceMapDialog({ place, onSave, onClose }: {
  place: MapPlace
  onSave: (p: { name: string; lat: number; lng: number }) => Promise<void>
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ lat: place.lat, lng: place.lng })
  const [name, setName] = useState(place.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      map = L.map(box.current).setView([place.lat, place.lng], 17)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      const icon = L.divIcon({ className: '', html: '<div style="width:24px;height:24px;border-radius:9999px;background:#E24B4A;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>', iconSize: [24, 24], iconAnchor: [12, 12] })
      const pin = L.marker([place.lat, place.lng], { icon, draggable: true }).addTo(map)
      pin.on('dragend', () => { const p = pin.getLatLng(); setAt({ lat: p.lat, lng: p.lng }) })
      map.on('click', e => { pin.setLatLng(e.latlng); setAt({ lat: e.latlng.lat, lng: e.latlng.lng }) })
      window.setTimeout(() => map?.invalidateSize(), 200)
    })()
    return () => { alive = false; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id])

  const moved = Math.abs(at.lat - place.lat) > 1e-6 || Math.abs(at.lng - place.lng) > 1e-6
  const save = async () => {
    setBusy(true); setErr(null)
    try { await onSave({ name: name.trim(), lat: at.lat, lng: at.lng }) } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Dialog title={place.name} icon={<MapPin className="h-5 w-5 text-cyrixRed-600" />} onClose={onClose} huge>
      <div className="mt-3 space-y-3">
        <p className="truncate text-sm text-ink-500">{place.full_name}</p>
        <div ref={box} className="h-72 w-full overflow-hidden rounded-xl border border-ink-200 sm:h-[55vh]" />
        <label className="block"><span className="label">Name</span>
          <input className="input mt-1" value={name} onChange={e => setName(e.target.value)} /></label>
        {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || name.trim().length < 2 || (!moved && name.trim() === place.name)} onClick={() => void save()}>
            {busy && <Spinner className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
    </Dialog>
  )
}
