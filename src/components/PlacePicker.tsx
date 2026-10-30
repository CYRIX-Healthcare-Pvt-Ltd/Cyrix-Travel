import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackCloses } from '@/lib/useBackCloses'
import { BedDouble, Camera, Check, Crosshair, Home, Hospital, MapPin, Search, Star, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMyPlaces } from '@/pages/MyPlaces'
import 'leaflet/dist/leaflet.css'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { distanceKm, findLearned, nameOf, namesNear, rpc, searchPlaces, type Learned, type Place } from '@/lib/claims'
import { readPasted, spotFrom } from '@/lib/pasted'
import { clock, usePhotoUrls, type VisitPhoto } from '@/lib/visits'

/*
  Choosing a place is required, and is done on the map (the user, 17 Oct: "there mandatory option
  should be there to select in map"): searched by name, or a pin dropped and dragged, or where the
  phone is. It works the next day too: nothing here depends on where the phone is now unless asked.
*/
export default function PlacePicker({ title, start, near, other, quick, photos, used, onPick, onClose, askName = false, plain = false, yes }: {
  title: string
  start?: Place | null
  /** Where the map opens when nothing is picked yet: a ride's start, for its end. */
  near?: Place | null
  /** The ride's other end: the same place is refused (the user, 30 Oct: "From same as to"). */
  other?: Place | null
  quick: Array<Place & { label?: string; home?: boolean; hospital?: boolean; stay?: boolean }>
  /** The day's visit photos, earliest first: one pressed is the place (the user, 30 Oct). */
  photos?: VisitPhoto[]
  /** The photos already on one of the day's rides: a green edge and a tick (the user, 30 Oct: "already selected image show a green border"). */
  used?: string[]
  /** `named`: a spot the map does not have, given its name by hand — learned for everyone once its day is saved (te_0071). */
  onPick: (p: Place, name?: string, named?: boolean) => void
  onClose: () => void
  /** Adding a saved place: the name is asked for, not offered. */
  askName?: boolean
  /** Only a spot is wanted (a home): no name to write and nothing to save. */
  plain?: boolean
  yes?: string
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
  /*
    The list of what a search found closes on a tap anywhere else, on Escape, or with the box's ×; a tap in the box
    brings it back (the user, 26 Oct: "how to cancel the search? clicking outside not going"). The tap that closes it
    on the map drops no pin.
  */
  const [listOpen, setListOpen] = useState(true)
  const showList = listOpen && (learned.length > 0 || found.length > 0)
  const searchBox = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const dismissing = useRef(false)
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
  /*
    Coordinates or a Google Maps link pasted into the search drop the pin there (te_0071; the user, 26 Oct: a place
    our map does not have). A spot placed by hand — pasted, pressed or where the phone is — is named in a pop-up
    when it is used ("on click use this place clicked then a pop up needed ie name this place"), with the name a
    link carried filled in.
  */
  const [pasteErr, setPasteErr] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const linkName = useRef<string | undefined>(undefined)
  const handPlaced = fromMap && !askName && !plain
  useBackCloses(onClose)
  const photoUrls = usePhotoUrls((photos ?? []).map(p => p.path)).data ?? {}
  const [fromPhoto, setFromPhoto] = useState<string | null>(null)
  /*
    A visit photo of the day is the place where it was taken (the user, 30 Oct: "if i select dh aluva's image then it
    should automatically fetch location"): its own point, and the name of the place we know there — as the map's list
    has it — in one press. A spot we do not know yet is named, as a pressed one is, and learned when the day is saved;
    the box starts with the photo's place (the user, 30 Oct: "let official name auto fill the image name"). A place we know
    opens the box too, with its name in it and the places around offered, never set at once (the user, 30 Oct: "it is
    directly saving … better should like earlier, share suggesions also but field name filled with image name").
  */
  const knownAt = useRef<string | null>(null)
  const pickPhoto = async (ph: VisitPhoto) => {
    if (same(ph)) return
    setErr(null); setFromPhoto(ph.id)
    const known = await rpc<string | null>('te_place_at', { p_lat: ph.lat, p_lng: ph.lng }).catch(() => null)
    setFromPhoto(null)
    knownAt.current = known
    const named = known ?? (ph.place ?? '').split(',')[0].trim()
    await put(ph.lat, ph.lng, named || 'Visit photo')
    setNaming(named)
  }

  const put = async (lat: number, lng: number, name?: string, move = true, fromLink?: string) => {
    linkName.current = fromLink
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
      // The map takes the room the rest of the pop-up leaves, which changes as a name or save line comes and goes.
      const ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(box.current)
      map.on('unload', () => ro.disconnect())
      if (start) void put(start.lat, start.lng, start.name, false)
      // A home tapped on a far view is brought close, to be put right to the street.
      map.on('click', e => {
        if (dismissing.current) { dismissing.current = false; return }
        void put(e.latlng.lat, e.latlng.lng, undefined, plain && map.getZoom() < 15)
      })
    })()
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; pinRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setPasteErr(null)
    const pasted = readPasted(q)
    if (pasted) {
      setFound([]); setLearned([]); setNone(false)
      const t = window.setTimeout(async () => {
        // A short share link says where it leads only to a server (the place-link function).
        if ('short' in pasted) setBusy(true)
        const hit = await spotFrom(pasted)
        setBusy(false)
        if ('bad' in hit) { setPasteErr(hit.bad); return }
        void put(hit.at.lat, hit.at.lng, undefined, true, hit.name)
      }, 400)
      return () => window.clearTimeout(t)
    }
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
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/*
          Every quick place in one row, side by side, wrapping only when full (the user, 22 Oct: "if 10 locations are
          there why downward?"); each kind its own colour — saved amber star, home teal, hotel violet, hospital red,
          a place used before a grey pin.
        */}
        {/* The day's visit photos first, earliest first: the photo is the place. */}
        {(photos ?? []).length > 0 && (
          <div className="shrink-0">
            <p className="label">Visit photos</p>
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
              {photos!.map(ph => (
                <button key={ph.id} type="button" onClick={() => void pickPhoto(ph)} disabled={!!fromPhoto}
                  className={`w-24 shrink-0 overflow-hidden rounded-xl border text-left transition-colors ${used?.includes(ph.id) ? 'border-emerald-500 outline outline-2 -outline-offset-2 outline-emerald-500' : 'border-ink-200 hover:border-ink-400'}`}>
                  <span className="relative grid h-14 w-full place-items-center overflow-hidden bg-ink-100">
                    {ph.path && photoUrls[ph.path] ? <img src={photoUrls[ph.path]} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="h-5 w-5 text-ink-400" />}
                    {used?.includes(ph.id) && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white shadow"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>}
                    {fromPhoto === ph.id && <span className="absolute inset-0 grid place-items-center bg-black/40"><Spinner className="h-5 w-5 text-white" /></span>}
                  </span>
                  <span className="block truncate px-1.5 pt-1 text-xs font-medium text-ink-900">{(ph.place ?? '').split(',')[0] || 'Visit photo'}</span>
                  <span className="block px-1.5 pb-1 text-[11px] text-ink-500">{clock(ph.shot_at)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* A place used before that is already saved shows once, as the saved star (the user, 26 Oct: "what is this 2 work?"). */}
        {((saved ?? []).length > 0 || quick.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {(saved ?? []).map(p => (
              <button key={p.id} type="button" className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100"
                onClick={() => void put(p.lat, p.lng, p.name)}><Star className="h-3.5 w-3.5 text-amber-500" />{p.name}</button>
            ))}
            {quick.filter(p => p.home || p.stay || !(saved ?? []).some(x => distanceKm(x, p) < 0.15)).map((p, i) => {
              const Icon = p.home ? Home : p.stay ? BedDouble : p.hospital ? Hospital : MapPin
              const ink = p.home ? 'text-teal-600' : p.stay ? 'text-violet-600' : p.hospital ? 'text-cyrixRed-600' : 'text-ink-400'
              return (
                <button key={i} type="button" className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-ink-100 ${p.hospital ? 'border-cyrixRed-300 font-semibold text-ink-900' : 'border-ink-200 text-ink-800'}`}
                  onClick={() => void put(p.lat, p.lng, p.name)}>
                  <Icon className={`h-3.5 w-3.5 ${ink}`} />{p.label ?? p.name}
                </button>
              )
            })}
          </div>
        )}
        {/* What a search finds drops over the map, not pushing it and the buttons down (the user, 26 Oct). */}
        <div ref={searchBox} className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input ref={searchInput} className="input pl-9 pr-10" value={q} onChange={e => { setQ(e.target.value); setListOpen(true) }} placeholder="Search a hospital, bus stand or place"
            onFocus={() => setListOpen(true)}
            onKeyDown={e => { if (e.key === 'Escape' && showList) { e.stopPropagation(); setListOpen(false) } }} />
          {busy ? <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            : q && <button type="button" aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                onClick={() => { setQ(''); searchInput.current?.focus() }}><X className="h-4 w-4" /></button>}
          {showList && (
          <div className="absolute inset-x-0 top-full z-[1001] mt-1 max-h-60 overflow-y-auto rounded-xl border border-ink-200 bg-surface shadow-lg">
            {learned.map(p => (
              <button key={p.id} type="button" className="flex w-full items-center gap-2 border-b border-ink-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setLearned([]); setQ(''); void put(p.lat, p.lng, p.name) }}>
                <Hospital className="h-4 w-4 shrink-0 text-cyrixRed-600" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{p.short}</span>
                {/* The district only; no visit count in the list (the user, 26 Oct: "dont show the visit count here"). */}
                {p.district && <span className="shrink-0 text-xs text-ink-500">{p.district}</span>}
              </button>
            ))}
            {found.map((p, i) => (
              <button key={i} type="button" className="block w-full border-b border-ink-100 px-3 py-2 text-left text-sm text-ink-800 last:border-0 hover:bg-ink-100"
                onClick={() => { setFound([]); setQ(''); void put(p.lat, p.lng, p.name) }}>{p.name}</button>
            ))}
          </div>
          )}
        </div>
        {pasteErr && <p className="shrink-0 text-sm text-cyrixRed-700">{pasteErr}</p>}
        {none && !busy && <p className="shrink-0 text-sm text-ink-500">No match. Try another spelling, or tap the place on the map.</p>}
        <div ref={box} className="min-h-[10rem] w-full flex-1 overflow-hidden rounded-xl border border-ink-200" />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={here}><Crosshair className="h-4 w-4" /> Use my location</button>
          <span className="min-w-0 flex-1 truncate text-right text-sm text-ink-600">{picked ? picked.name : 'Tap the map or search'}</span>
        </div>
        {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
        {picked && picked.name !== '…' && !plain && (saveAs === null ? (
          <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline" onClick={() => setSaveAs(picked.name.split(',')[0])}><Star className="h-4 w-4" /> Save to my places</button>
        ) : (
          <label className="block"><span className="label">{askName ? 'Name this place' : 'Save to my places as'}</span>
            <input className="input mt-1" value={saveAs} onChange={e => setSaveAs(e.target.value)} placeholder="Home, Kochi office, ESI Hospital" autoFocus={askName} /></label>
        ))}
        {saveErr && <p className="text-sm text-cyrixRed-700">{saveErr}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!picked || (!plain && !handPlaced && (picked.name === '…' || !picked.name.trim())) || (askName && !(saveAs ?? '').trim())} onClick={() => {
            if (!picked) return
            if (handPlaced) setNaming(linkName.current ?? '')
            else void finish(picked, false)
          }}>{yes ?? (askName ? 'Save place' : 'Use this place')}</button>
        </div>
      </div>
      {naming !== null && picked && (
        <NameThisPlace at={picked} start={naming} onCancel={() => { setNaming(null); knownAt.current = null }}
          onDone={name => {
            // A known place kept as it is named is not learned again.
            const same = !!knownAt.current && name.trim().toLowerCase() === knownAt.current.toLowerCase()
            setNaming(null); knownAt.current = null
            void finish({ ...picked, name }, !same)
          }} />
      )}
    </Dialog>
  )

  function same(p: { lat: number; lng: number }) {
    if (!other || distanceKm(other, p) >= 0.15) return false
    setErr(`From and To can't be the same place (${other.name.split(',')[0]}).`)
    return true
  }
  async function finish(p: Place, named: boolean) {
    if (same(p)) return
    const name = (saveAs ?? '').trim()
    if (name && !askName) {
      setSaveErr(null)
      try { await rpc('te_save_place', { p_id: null, p_name: name, p_lat: p.lat, p_lng: p.lng }); await qc.invalidateQueries({ queryKey: ['te_places'] }) }
      catch (e) { setSaveErr((e as Error).message); return }
      // A place named by hand keeps its official name on the ride; the saved one is the person's own.
      onPick(named ? p : { ...p, name }, name, named)
    } else onPick(p, name || undefined, named)
  }
}

/*
  "Name this place": the official name of a spot the map does not have, with names offered as it is typed (the user,
  26 Oct: "on name type can we show suggestion? like in chrome") — places our engineers named first, then what the
  map calls the places within 2 km, a short form written out ("dh aluva": District Hospital Aluva). Until the name it
  starts with is changed, the places around the pin are offered (a photo's "GH Canteen": General Hospital Ernakulam).
  A name offered only fills the box; the pin stays where it was put.
*/
function NameThisPlace({ at, start, onCancel, onDone }: { at: Place; start: string; onCancel: () => void; onDone: (name: string) => void }) {
  const [text, setText] = useState(start)
  const [offers, setOffers] = useState<Array<{ name: string; ours: boolean; km: number | null }>>([])
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(async () => {
      const [ours, map] = await Promise.all([
        text.trim().length >= 3 ? findLearned(text, at).catch(() => []) : Promise.resolve([] as Learned[]),
        namesNear(text === start ? '' : text, at),
      ])
      if (!alive) return
      const mine = ours.map(o => ({ name: o.short, ours: true, km: distanceKm(at, o) })).filter(o => o.km <= 2)
      const rest = map.filter(m => !mine.some(o => o.name.toLowerCase() === m.name.toLowerCase())).map(m => ({ ...m, ours: false }))
      // The name in the box is offered too (the user, 30 Oct: "show maj hospital also in suggesion").
      setOffers([...mine, ...rest].slice(0, 6))
    }, text === start ? 0 : 400)
    return () => { alive = false; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  const ok = text.trim().length >= 2
  const far = (km: number) => (km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`)
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Name this place" className="fixed inset-0 z-[60] flex items-end justify-center bg-shade/60 sm:items-center sm:p-4"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <div className="animate-pop-in w-full rounded-t-2xl bg-surface p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-base font-semibold text-ink-900"><MapPin className="h-5 w-5 text-cyrixRed-600" />Name this place</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="btn-press -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900"><X className="h-5 w-5" /></button>
        </div>
        <label className="mt-4 block"><span className="label">Official name</span>
          <input className="input mt-1" autoFocus value={text} placeholder="Taluk Headquarters Hospital, Aluva" onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && ok) onDone(text.trim()) }} /></label>
        {offers.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-ink-200">
            {offers.map(o => (
              <button key={`${o.ours}-${o.name}`} type="button" className="flex w-full items-center gap-2 border-b border-ink-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink-100"
                onClick={() => setText(o.name)}>
                {o.ours ? <Hospital className="h-4 w-4 shrink-0 text-cyrixRed-600" /> : o.km == null ? <Search className="h-4 w-4 shrink-0 text-ink-400" /> : <MapPin className="h-4 w-4 shrink-0 text-ink-400" />}
                <span className="min-w-0 flex-1 truncate text-ink-900">{o.name}</span>
                {o.km != null && <span className="shrink-0 text-xs text-ink-500">{far(o.km)}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!ok} onClick={() => onDone(text.trim())}>Use this place</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
