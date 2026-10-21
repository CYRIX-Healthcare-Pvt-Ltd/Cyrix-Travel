import { useEffect, useRef, useState } from 'react'
import { useBackCloses } from '@/lib/useBackCloses'
import { BedDouble, Crosshair, Home, Hospital, MapPin, Search, Star } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMyPlaces } from '@/pages/MyPlaces'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { distanceKm, findLearned, nameOf, rpc, searchPlaces, type Learned, type Place } from '@/lib/claims'

/*
  Choosing a place is required, and is done on the map (the user, 17 Oct: "there mandatory option
  should be there to select in map"): searched by name, or a pin dropped and dragged, or where the
  phone is. It works the next day too: nothing here depends on where the phone is now unless asked.
*/
export default function PlacePicker({ title, start, near, quick, onPick, onClose, askName = false }: {
  title: string
  start?: Place | null
  /** Where the map opens when nothing is picked yet: a ride's start, for its end. */
  near?: Place | null
  quick: Array<Place & { label?: string; home?: boolean; hospital?: boolean; stay?: boolean }>
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
  // Places our engineers have serviced, first (te_0038; the user, 21 Oct: "if 1 eng went to dh aluva, next eng when type aluva").
  const [learned, setLearned] = useState<Learned[]>([])
  // A spot pressed on the map gets a name the engineer can write (the user, 21 Oct: a PHC the map does not have).
  const [fromMap, setFromMap] = useState(false)
  const edited = useRef(false)
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
        if (!edited.current) setPicked({ name: '…', lat: p.lat, lng: p.lng })
        else setPicked(x => ({ name: x?.name ?? '…', lat: p.lat, lng: p.lng }))
        setFromMap(true)
        const n = await nameOf(p.lat, p.lng)
        if (!edited.current) setPicked({ name: n, lat: p.lat, lng: p.lng })
      })
    } else pinRef.current.setLatLng([lat, lng])
    if (move) map.setView([lat, lng], Math.max(map.getZoom(), 15))
    edited.current = false
    setFromMap(!name)
    setPicked({ name: name ?? '…', lat, lng })
    if (!name) { const n = await nameOf(lat, lng); if (!edited.current) setPicked({ name: n, lat, lng }) }
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      /*
        Opened where the engineer is, anywhere in India (the user, 21 Oct: "this module is going to be used by
        pan-Indian engineers"): the place itself, else where the ride starts, else home or the day's last place, else where the phone is
        when location is already allowed, else all of India.
      */
      const around = near ?? quick.find(p => p.home) ?? quick[0] ?? null
      const map = L.map(box.current).setView(start ? [start.lat, start.lng] : around ? [around.lat, around.lng] : [22.6, 79.0], start ? 15 : around ? 12 : 5)
      if (!start && !around && navigator.permissions && navigator.geolocation) {
        void navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(s => {
          if (s.state === 'granted') navigator.geolocation.getCurrentPosition(p => { if (mapRef.current && !pinRef.current) mapRef.current.setView([p.coords.latitude, p.coords.longitude], 12) })
        }).catch(() => {})
      }
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      mapRef.current = map
      if (start) void put(start.lat, start.lng, start.name, false)
      map.on('click', e => void put(e.latlng.lat, e.latlng.lng, undefined, false))
    })()
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; pinRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (q.trim().length < 3) { setFound([]); setLearned([]); setNone(false); return }
    const t = window.setTimeout(async () => {
      setBusy(true)
      const c = mapRef.current?.getCenter()
      const near = c && mapRef.current!.getZoom() >= 9 ? { lat: c.lat, lng: c.lng } : undefined
      const [ours, res] = await Promise.all([findLearned(q, near), searchPlaces(q, near)])
      // The map's own result for a place already learned is the same place: shown once, as ours.
      const rest = res.filter(p => !ours.some(o => distanceKm(o, p) < 0.3))
      setLearned(ours); setFound(rest); setNone(ours.length + rest.length === 0); setBusy(false)
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
              <button key={i} type="button" className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-ink-100 ${p.hospital ? 'border-cyrixRed-300 font-semibold text-ink-900' : 'border-ink-200 text-ink-800'}`}
                onClick={() => void put(p.lat, p.lng, p.name)}>
                {p.home && <Home className="h-3.5 w-3.5 text-teal-600" />}{p.stay && <BedDouble className="h-3.5 w-3.5 text-violet-600" />}{p.hospital && <Hospital className="h-3.5 w-3.5 text-cyrixRed-600" />}{p.label ?? p.name}
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
        {(learned.length > 0 || found.length > 0) && (
          <div className="max-h-48 overflow-y-auto rounded-xl border border-ink-200">
            {learned.map(p => (
              <button key={p.id} type="button" className="flex w-full items-center gap-2 border-b border-ink-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setLearned([]); setQ(''); void put(p.lat, p.lng, p.name) }}>
                <Hospital className="h-4 w-4 shrink-0 text-cyrixRed-600" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{p.short}</span>
                <span className="shrink-0 text-xs text-ink-500">{[p.district, `${p.visits} visit${p.visits === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            {found.map((p, i) => (
              <button key={i} type="button" className="block w-full border-b border-ink-100 px-3 py-2 text-left text-sm text-ink-800 last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setQ(''); void put(p.lat, p.lng, p.name) }}>{p.name}</button>
            ))}
          </div>
        )}
        <div ref={box} className="h-64 w-full overflow-hidden rounded-xl border border-ink-200 sm:h-[55vh]" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={here}><Crosshair className="h-4 w-4" /> Use my location</button>
          {!(fromMap && picked && !askName) && <span className="min-w-0 flex-1 truncate text-right text-sm text-ink-600">{picked ? picked.name : 'Tap the map or search'}</span>}
        </div>
        {fromMap && picked && !askName && (
          <label className="block"><span className="label">Name</span>
            <input className="input mt-1" value={picked.name === '…' ? '' : picked.name} placeholder="Hospital or place name"
              onChange={e => { edited.current = true; setPicked({ ...picked, name: e.target.value }) }} /></label>
        )}
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
          <button type="button" className="btn-primary" disabled={!picked || picked.name === '…' || !picked.name.trim() || (askName && !(saveAs ?? '').trim())} onClick={async () => {
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
