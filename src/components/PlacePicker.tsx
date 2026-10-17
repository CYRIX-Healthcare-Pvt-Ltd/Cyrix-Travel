import { useEffect, useRef, useState } from 'react'
import { useBackCloses } from '@/lib/useBackCloses'
import { Crosshair, Home, MapPin, Search } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { nameOf, searchPlaces, type Place } from '@/lib/claims'

/*
  Choosing a place is required, and is done on the map (the user, 17 Oct: "there mandatory option
  should be there to select in map"): searched by name, or a pin dropped and dragged, or where the
  phone is. It works the next day too: nothing here depends on where the phone is now unless asked.
*/
export default function PlacePicker({ title, start, quick, onPick, onClose }: {
  title: string
  start?: Place | null
  quick: Array<Place & { label?: string; home?: boolean }>
  onPick: (p: Place) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const pinRef = useRef<import('leaflet').Marker | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Place | null>(start ?? null)
  const [err, setErr] = useState<string | null>(null)
  useBackCloses(onClose)

  const put = async (lat: number, lng: number, name?: string, move = true) => {
    const L = (await import('leaflet')).default
    const map = mapRef.current
    if (!map) return
    const icon = L.divIcon({ className: '', html: '<div class="rm-pin" style="background:#E24B4A"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="6"/></svg></div>', iconSize: [26, 26], iconAnchor: [13, 13] })
    if (!pinRef.current) {
      pinRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
      pinRef.current.on('dragend', async () => {
        const p = pinRef.current!.getLatLng()
        setPicked({ name: '…', lat: p.lat, lng: p.lng })
        setPicked({ name: await nameOf(p.lat, p.lng), lat: p.lat, lng: p.lng })
      })
    } else pinRef.current.setLatLng([lat, lng])
    if (move) map.setView([lat, lng], Math.max(map.getZoom(), 15))
    setPicked({ name: name ?? '…', lat, lng })
    if (!name) setPicked({ name: await nameOf(lat, lng), lat, lng })
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      const map = L.map(box.current).setView(start ? [start.lat, start.lng] : [10.0, 76.3], start ? 15 : 7)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      mapRef.current = map
      if (start) void put(start.lat, start.lng, start.name, false)
      map.on('click', e => void put(e.latlng.lat, e.latlng.lng, undefined, false))
    })()
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; pinRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (q.trim().length < 3) { setFound([]); return }
    const t = window.setTimeout(async () => { setBusy(true); setFound(await searchPlaces(q)); setBusy(false) }, 450)
    return () => window.clearTimeout(t)
  }, [q])

  const here = () => {
    setErr(null)
    if (!navigator.geolocation) { setErr('This phone cannot give its location.'); return }
    navigator.geolocation.getCurrentPosition(p => void put(p.coords.latitude, p.coords.longitude),
      () => setErr('Location is off. Allow it, or search or tap the map.'), { enableHighAccuracy: true, timeout: 15000 })
  }

  return (
    <Dialog title={title} icon={<MapPin className="h-5 w-5 text-cyrixRed-600" />} onClose={onClose} wide>
      <div className="mt-3 space-y-3">
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((p, i) => (
              <button key={i} type="button" className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-800 hover:bg-ink-100"
                onClick={() => void put(p.lat, p.lng, p.name)}>
                {p.home && <Home className="h-3.5 w-3.5 text-teal-600" />}{p.label ?? p.name}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a hospital, bus stand or place" />
          {busy && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
        </div>
        {found.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-ink-200">
            {found.map((p, i) => (
              <button key={i} type="button" className="block w-full border-b border-ink-100 px-3 py-2 text-left text-sm text-ink-800 last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setQ(''); void put(p.lat, p.lng, p.name) }}>{p.name}</button>
            ))}
          </div>
        )}
        <div ref={box} className="h-64 w-full overflow-hidden rounded-xl border border-ink-200" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={here}><Crosshair className="h-4 w-4" /> Use my location</button>
          <span className="min-w-0 flex-1 truncate text-right text-sm text-ink-600">{picked ? picked.name : 'Tap the map or search'}</span>
        </div>
        {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!picked || picked.name === '…'} onClick={() => picked && onPick(picked)}>Use this place</button>
        </div>
      </div>
    </Dialog>
  )
}
