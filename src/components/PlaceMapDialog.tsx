import { useEffect, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { findOnMap, readPasted, spotFrom } from '@/lib/pasted'

/*
  A learned place on the map, for a Travel admin (the user, 21 Oct: "how to check in map or reallocate?"):
  its pin dragged, or the right spot tapped, and its name put right, then saved for everyone. In Travel, also one
  of a person's own saved places (the user, 21 Oct: "editing also cannot change pin in map"). The same file in
  Travel and KPI's SW Admin (src/components); change both.

  The right spot searched by name, or its coordinates or Google Maps link pasted (the user, 26 Oct: "sw admin also
  need to search with location link etc in edit places"): the pin goes there, and a name the place or link carries
  fills the Name.
*/
export interface MapPlace { id: string; name: string; full_name?: string; lat: number; lng: number }
type Hit = { name: string; where: string; lat: number; lng: number }

export default function PlaceMapDialog({ place, onSave, onClose }: {
  place: MapPlace
  onSave: (p: { name: string; lat: number; lng: number }) => Promise<void>
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const pinRef = useRef<import('leaflet').Marker | null>(null)
  const [at, setAt] = useState({ lat: place.lat, lng: place.lng })
  const [name, setName] = useState(place.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [finding, setFinding] = useState(false)
  const [none, setNone] = useState(false)
  const [findErr, setFindErr] = useState<string | null>(null)
  // The list closes on a tap anywhere else (that tap drops no pin), on Escape, or with the ×; a tap in the box brings it back.
  const [listOpen, setListOpen] = useState(true)
  const showList = listOpen && hits.length > 0
  const searchBox = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const dismissing = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      const map = L.map(box.current).setView([place.lat, place.lng], 17)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      const icon = L.divIcon({ className: '', html: '<div style="width:24px;height:24px;border-radius:9999px;background:#E24B4A;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>', iconSize: [24, 24], iconAnchor: [12, 12] })
      const pin = L.marker([place.lat, place.lng], { icon, draggable: true }).addTo(map)
      pinRef.current = pin
      pin.on('dragend', () => { const p = pin.getLatLng(); setAt({ lat: p.lat, lng: p.lng }) })
      map.on('click', e => {
        if (dismissing.current) { dismissing.current = false; return }
        pin.setLatLng(e.latlng); setAt({ lat: e.latlng.lat, lng: e.latlng.lng })
      })
      // The map takes the room the rest of the pop-up leaves (the user, 26 Oct: no scroll in a map pop-up).
      const ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(box.current)
      map.on('unload', () => ro.disconnect())
    })()
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; pinRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id])

  useEffect(() => {
    if (!showList) return
    const away = (e: PointerEvent) => {
      if (searchBox.current?.contains(e.target as Node)) return
      setListOpen(false)
      dismissing.current = true
      window.setTimeout(() => { dismissing.current = false }, 400)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [showList])

  const go = (lat: number, lng: number, named?: string) => {
    pinRef.current?.setLatLng([lat, lng])
    mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 17))
    setAt({ lat, lng })
    if (named) setName(named)
  }

  useEffect(() => {
    setFindErr(null); setNone(false)
    const pasted = readPasted(q)
    if (pasted) {
      setHits([])
      const t = window.setTimeout(async () => {
        if ('short' in pasted) setFinding(true)
        const hit = await spotFrom(pasted)
        setFinding(false)
        if ('bad' in hit) { setFindErr(hit.bad); return }
        go(hit.at.lat, hit.at.lng, hit.name)
      }, 400)
      return () => window.clearTimeout(t)
    }
    if (q.trim().length < 3) { setHits([]); return }
    let alive = true
    const t = window.setTimeout(async () => {
      setFinding(true)
      const c = mapRef.current?.getCenter()
      const found = await findOnMap(q, c ? { lat: c.lat, lng: c.lng } : { lat: place.lat, lng: place.lng })
      if (!alive) return
      setFinding(false); setHits(found); setNone(found.length === 0)
    }, 400)
    return () => { alive = false; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const moved = Math.abs(at.lat - place.lat) > 1e-6 || Math.abs(at.lng - place.lng) > 1e-6
  const save = async () => {
    setBusy(true); setErr(null)
    try { await onSave({ name: name.trim(), lat: at.lat, lng: at.lng }) } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Dialog title={place.name} icon={<MapPin className="h-5 w-5 text-cyrixRed-600" />} onClose={onClose} huge>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {place.full_name && <p className="truncate text-sm text-ink-500">{place.full_name}</p>}
        <div ref={searchBox} className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input ref={searchInput} className="input pl-9 pr-10" value={q} placeholder="Search, or paste a map link or coordinates"
            onChange={e => { setQ(e.target.value); setListOpen(true) }} onFocus={() => setListOpen(true)}
            onKeyDown={e => { if (e.key === 'Escape' && showList) { e.stopPropagation(); setListOpen(false) } }} />
          {finding ? <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            : q && <button type="button" aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                onClick={() => { setQ(''); searchInput.current?.focus() }}><X className="h-4 w-4" /></button>}
          {showList && (
            <div className="absolute inset-x-0 top-full z-[1001] mt-1 max-h-60 overflow-y-auto rounded-xl border border-ink-200 bg-surface shadow-lg">
              {hits.map((h, i) => (
                <button key={i} type="button" className="block w-full border-b border-ink-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-100"
                  onClick={() => { setHits([]); setQ(''); go(h.lat, h.lng, h.name) }}>
                  <span className="block truncate font-medium text-ink-900">{h.name}</span>
                  {h.where && <span className="block truncate text-xs text-ink-500">{h.where}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {findErr && <p className="shrink-0 text-sm text-cyrixRed-700">{findErr}</p>}
        {none && !finding && <p className="shrink-0 text-sm text-ink-500">No match. Try another spelling, or tap the place on the map.</p>}
        <div ref={box} className="min-h-[10rem] w-full flex-1 overflow-hidden rounded-xl border border-ink-200" />
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
