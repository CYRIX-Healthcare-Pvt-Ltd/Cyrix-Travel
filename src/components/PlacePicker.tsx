import { useEffect, useRef, useState } from 'react'
import { useBackCloses } from '@/lib/useBackCloses'
import { Crosshair, Home, MapPin, Search, Star } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMyPlaces } from '@/pages/MyPlaces'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { nameOf, rpc, searchPlaces, type Place } from '@/lib/claims'

/*
  Choosing a place is required, and is done on the map (the user, 17 Oct: "there mandatory option
  should be there to select in map"): searched by name, or a pin dropped and dragged, or where the
  phone is. It works the next day too: nothing here depends on where the phone is now unless asked.
*/
export default function PlacePicker({ title, start, quick, onPick, onClose, askName = false }: {
  title: string
  start?: Place | null
  quick: Array<Place & { label?: string; home?: boolean }>
  onPick: (p: Place, name?: string) => void
  onClose: () => void
  /** Adding a saved place: the name is asked for, not offered. */
  askName?: boolean
}) {
  // Saved places first (te_0023; the user, 17 Oct), and saving the one chosen with a name.
  const { data: saved } = useMyPlaces()
  const [saveAs, setSaveAs] = useState<string | null>(askName ? '' : null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const qc = useQueryClient()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const pinRef = useRef<import('leaflet').Marker | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [none, setNone] = useState(false)
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
    if (q.trim().length < 3) { setFound([]); setNone(false); return }
    const t = window.setTimeout(async () => {
      setBusy(true)
      const c = mapRef.current?.getCenter()
      const res = await searchPlaces(q, c && mapRef.current!.getZoom() >= 9 ? { lat: c.lat, lng: c.lng } : undefined)
      setFound(res); setNone(res.length === 0); setBusy(false)
    }, 400)
    return () => window.clearTimeout(t)
  }, [q])

  const here = () => {
    setErr(null)
    if (!navigator.geolocation) { setErr('This phone cannot give its location.'); return }
    navigator.geolocation.getCurrentPosition(p => void put(p.coords.latitude, p.coords.longitude),
      () => setErr('Location is off. Allow it, or search or tap the map.'), { enableHighAccuracy: true, timeout: 15000 })
  }

  return (
    <Dialog title={title} icon={<MapPin className="h-5 w-5 text-cyrixRed-600" />} onClose={onClose} huge>
      <div className="mt-3 space-y-3">
        {(saved ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(saved ?? []).map(p => (
              <button key={p.id} type="button" className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100"
                onClick={() => void put(p.lat, p.lng, p.name)}><Star className="h-3.5 w-3.5" />{p.name}</button>
            ))}
          </div>
        )}
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
        {none && !busy && <p className="text-sm text-ink-500">No match. Try another spelling, or tap the place on the map.</p>}
        {found.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-ink-200">
            {found.map((p, i) => (
              <button key={i} type="button" className="block w-full border-b border-ink-100 px-3 py-2 text-left text-sm text-ink-800 last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setQ(''); void put(p.lat, p.lng, p.name) }}>{p.name}</button>
            ))}
          </div>
        )}
        <div ref={box} className="h-64 w-full overflow-hidden rounded-xl border border-ink-200 sm:h-[55vh]" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={here}><Crosshair className="h-4 w-4" /> Use my location</button>
          <span className="min-w-0 flex-1 truncate text-right text-sm text-ink-600">{picked ? picked.name : 'Tap the map or search'}</span>
        </div>
        {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
        {picked && picked.name !== '…' && (saveAs === null ? (
          <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline" onClick={() => setSaveAs(picked.name.split(',')[0])}><Star className="h-4 w-4" /> Save to my places</button>
        ) : (
          <label className="block"><span className="label">{askName ? 'Name this place' : 'Save to my places as'}</span>
            <input className="input mt-1" value={saveAs} onChange={e => setSaveAs(e.target.value)} placeholder="Home, Kochi office, ESI Hospital" autoFocus={askName} /></label>
        ))}
        {saveErr && <p className="text-sm text-cyrixRed-700">{saveErr}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!picked || picked.name === '…' || (askName && !(saveAs ?? '').trim())} onClick={async () => {
            if (!picked) return
            const name = (saveAs ?? '').trim()
            if (name && !askName) {
              setSaveErr(null)
              try { await rpc('te_save_place', { p_id: null, p_name: name, p_lat: picked.lat, p_lng: picked.lng }); await qc.invalidateQueries({ queryKey: ['te_places'] }) }
              catch (e) { setSaveErr((e as Error).message); return }
              onPick({ ...picked, name }, name)
            } else onPick(picked, name || undefined)
          }}>{askName ? 'Save place' : 'Use this place'}</button>
        </div>
      </div>
    </Dialog>
  )
}
