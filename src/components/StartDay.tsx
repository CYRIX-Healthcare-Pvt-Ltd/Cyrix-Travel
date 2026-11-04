import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Sunrise } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { Alert, Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { placeName, whereAmI, type Fix } from '@/lib/geo'
import { startName, type DayStart } from '@/lib/dayStart'

/*
  Start my day (te_0104; the user, 3 Nov: "instead of take visit photo, make it as start my day, so save that location
  (non editable location) with a default logical image, if that only then take visit photo"). It stands where Take
  visit photo is until the day is started. Locally, ?start-preview shows it to anyone, and the press there saves nothing.
*/
export const startPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('start-preview')

export const useMyStarts = (from: string, to: string) => useQuery({
  queryKey: ['te_my_starts', from, to],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('te_my_starts', { p_from: from, p_to: to })
    if (error) throw new Error(friendlyError(error))
    return data as DayStart[]
  },
})

// The local preview, with location off, starts at a sample spot (Vyttila).
const findMe = () => whereAmI().catch(e => { if (startPreview) return { lat: 9.9667, lng: 76.3186, accuracy: 10 }; throw e })

/** Saves the spot as the day's start (te_0104), and says it. */
async function saveStart(fix: Fix, place: string | null): Promise<DayStart> {
  if (!startPreview) {
    const { error } = await supabase.rpc('te_start_day', { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_place: place })
    if (error) throw new Error(friendlyError(error))
  }
  return { day: new Date().toLocaleDateString('en-CA'), at: new Date().toISOString(), lat: fix.lat, lng: fix.lng, place, home_m: null }
}

/*
  Where the phone says he is, on a map that does not move, before it is saved (the user, 4 Nov: "what if location
  fetching is wrong, so better we can show a map and pin to confirm"): the pin can't be dragged, so the start stays
  where the phone is; a rough or wrong fix is read again with Try again.
*/
export function StartConfirm({ onStarted, onClose }: { onStarted?: (s: DayStart) => void; onClose: () => void }) {
  const qc = useQueryClient()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setFix(null); setPlace(null); setErr(null)
    findMe().then(async f => {
      if (!alive) return
      setFix(f)
      const n = await placeName(f)
      if (alive) setPlace(n ?? `${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`)
    }).catch(e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [round])

  useEffect(() => {
    if (!fix) return
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!alive || !box.current) return
      mapRef.current?.remove()
      const map = L.map(box.current, { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false })
        .setView([fix.lat, fix.lng], 17)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      L.circle([fix.lat, fix.lng], { radius: fix.accuracy, color: '#0d9488', weight: 1, fillOpacity: 0.12 }).addTo(map)
      L.marker([fix.lat, fix.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="rm-pin" style="background:#E24B4A"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="6"/></svg></div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map)
      mapRef.current = map
    })()
    return () => { alive = false }
  }, [fix])
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  const start = async () => {
    if (!fix) return
    setBusy(true); setErr(null)
    try {
      const s = await saveStart(fix, place)
      await Promise.all(['te_my_day', 'te_my_starts', 'te_claim'].map(k => qc.invalidateQueries({ queryKey: [k] })))
      onStarted?.(s)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  // Over 500 m the start is refused (te_0107; the user, 4 Nov): Try again only.
  const rough = !!fix && fix.accuracy > 100
  const tooRough = !!fix && fix.accuracy > 500

  return (
    <Dialog title="Start my day" icon={<Sunrise className="h-5 w-5 text-amber-500" />} onClose={onClose}>
      <div className="space-y-3">
        <div className="relative h-64 overflow-hidden rounded-xl border border-ink-200 bg-ink-100">
          <div ref={box} className="absolute inset-0" />
          {!fix && !err && <div className="absolute inset-0 grid place-items-center"><Spinner className="h-6 w-6" /></div>}
        </div>
        {fix && (
          <p className="text-base font-semibold text-ink-900">{place ?? '…'} <span className="text-sm font-normal text-ink-500">± {Math.round(fix.accuracy)} m</span></p>
        )}
        {tooRough ? <Alert kind="error">Location is not exact enough. Press Try again</Alert>
          : rough && <Alert kind="warning">Location is rough. Try again</Alert>}
        {err && <Alert kind="error">{err}</Alert>}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary h-12 flex-1 justify-center whitespace-nowrap" disabled={busy} onClick={() => setRound(r => r + 1)}>
            <RefreshCw className="h-5 w-5" /> Try again
          </button>
          <button type="button" className="btn-primary btn-go h-12 flex-[2] justify-center text-base" disabled={!fix || tooRough || busy} onClick={() => void start()}>
            {busy ? <Spinner className="h-5 w-5" /> : <Sunrise className="h-5 w-5" />} Start my day here
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export function StartDayButton({ onStarted }: { onStarted?: (s: DayStart) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" className="btn-primary btn-go h-12 w-full text-base sm:w-auto sm:px-6" onClick={() => setOpen(true)}>
        <Sunrise className="h-5 w-5" /> Start my day
      </button>
      {open && <StartConfirm onStarted={onStarted} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The drawn picture a day's start carries among the photos: sunrise over a road leaving home. */
export function StartArt({ home }: { home: boolean }) {
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="sd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" /><stop offset="0.6" stopColor="#fdba74" /><stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#sd-sky)" />
      <circle cx="80" cy="78" r="24" fill="#fff7ed" opacity="0.95" />
      {[-60, -30, 0, 30, 60].map(a => (
        <line key={a} x1="80" y1="78" x2={80 + Math.sin((a * Math.PI) / 180) * 40} y2={78 - Math.cos((a * Math.PI) / 180) * 40} stroke="#fff7ed" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      ))}
      <path d="M0 86 Q40 68 80 82 T160 78 V120 H0Z" fill="#65a30d" />
      <path d="M0 96 Q50 84 100 96 T160 92 V120 H0Z" fill="#4d7c0f" />
      <path d="M68 120 L78 92 H82 L92 120Z" fill="#57534e" />
      <path d="M80 96 V100 M80 105 V110 M80 115 V120" stroke="#fef3c7" strokeWidth="1.5" />
      {home && (
        <g transform="translate(22 70)">
          <path d="M0 14 L14 2 L28 14 V30 H0Z" fill="#fff7ed" />
          <path d="M-3 15 L14 0 L31 15" fill="none" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" />
          <rect x="11" y="19" width="7" height="11" fill="#b45309" />
        </g>
      )}
    </svg>
  )
}

export const startTitle = (s: DayStart) => (startName(s) === 'Home' ? 'Home' : (s.place ?? 'Where the day started'))
