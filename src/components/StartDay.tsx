import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Sunrise, Sunset } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { useAsk } from '@/components/Ask'
import { Alert, Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { placeName, whereAmI, type Fix } from '@/lib/geo'
import { endPreview, endingNextMorning, latePreview, openPreview, shortDay, startName, useMyDay, type DayStart } from '@/lib/dayStart'

/*
  Start my day (te_0104; the user, 3 Nov: "instead of take visit photo, make it as start my day, so save that location
  (non editable location) with a default logical image, if that only then take visit photo"). It stands where Take
  visit photo is until the day is started. Locally, ?start-preview shows it to anyone, and the press there saves nothing.
*/
export const startPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('start-preview')

export const useMyEnds = (from: string, to: string) => useQuery({
  queryKey: ['te_my_ends', from, to],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('te_my_ends', { p_from: from, p_to: to })
    if (error) throw new Error(friendlyError(error))
    return data as DayStart[]
  },
})

export const useMyStarts = (from: string, to: string) => useQuery({
  queryKey: ['te_my_starts', from, to],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('te_my_starts', { p_from: from, p_to: to })
    if (error) throw new Error(friendlyError(error))
    return data as DayStart[]
  },
})

// The local preview, with location off, starts at a sample spot (Vyttila).
const findMe = () => whereAmI().catch(e => { if (startPreview || endPreview || latePreview || openPreview) return { lat: 9.9667, lng: 76.3186, accuracy: 10 }; throw e })

/** Saves the spot as the day's start (te_0104) or end (te_0109), and says it. */
async function saveStart(fix: Fix, place: string | null, end: boolean): Promise<DayStart> {
  if (!(startPreview || endPreview || latePreview || openPreview)) {
    const { error } = await supabase.rpc(end ? 'te_end_day' : 'te_start_day', { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_place: place })
    if (error) throw new Error(friendlyError(error))
  }
  return { day: new Date().toLocaleDateString('en-CA'), at: new Date().toISOString(), lat: fix.lat, lng: fix.lng, place, home_m: null }
}

/*
  Where the phone says he is, on a map that does not move, before it is saved (the user, 4 Nov: "what if location
  fetching is wrong, so better we can show a map and pin to confirm"): the pin can't be dragged, so the start stays
  where the phone is; a rough or wrong fix is read again with Try again.
*/
/** `end`: End my day (te_0109), with `day` when it ends the day before after midnight ("End 3 Nov"). */
export function StartConfirm({ onStarted, onClose, end = false, day }: { onStarted?: (s: DayStart) => void; onClose: () => void; end?: boolean; day?: string | null }) {
  const qc = useQueryClient()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The next morning (te_0150; the user, 12 Nov): the day ends at its last ride, so no map; the phone's place is kept
  // only to compare with it, and the sheet does not say how far it is ("dont show here").
  const morning = end && !!day && endingNextMorning(day)
  const { data: myDay } = useMyDay()
  const lastTo = morning ? myDay?.open_last ?? null : null

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
    if (!fix || morning) return
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
      const s = await saveStart(fix, place, end)
      await Promise.all(['te_my_day', 'te_my_starts', 'te_my_ends', 'te_claim'].map(k => qc.invalidateQueries({ queryKey: [k] })))
      onStarted?.(s)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  // Over 500 m the start is refused (te_0107; the user, 4 Nov): Try again only.
  const rough = !!fix && fix.accuracy > 100
  const tooRough = !!fix && fix.accuracy > 500

  return (
    <Dialog title={end ? (day ? `End ${shortDay(day)}` : 'End my day') : 'Start my day'} icon={end ? <Sunset className="h-5 w-5 text-orange-500" /> : <Sunrise className="h-5 w-5 text-amber-500" />} onClose={onClose}>
      <div className="space-y-3">
        {morning ? (
          lastTo && <p className="text-base text-ink-700">Last ride to <span className="font-semibold text-ink-900">{lastTo}</span></p>
        ) : (
          <>
            <div className="relative h-64 overflow-hidden rounded-xl border border-ink-200 bg-ink-100">
              <div ref={box} className="absolute inset-0" />
              {!fix && !err && <div className="absolute inset-0 grid place-items-center"><Spinner className="h-6 w-6" /></div>}
            </div>
            {fix && (
              <p className="text-base font-semibold text-ink-900">{place ?? '…'} <span className="text-sm font-normal text-ink-500">± {Math.round(fix.accuracy)} m</span></p>
            )}
          </>
        )}
        {tooRough ? <Alert kind="error">Location is not exact enough. Press Try again</Alert>
          : rough && <Alert kind="warning">Location is rough. Try again</Alert>}
        {err && <Alert kind="error">{err}</Alert>}
        <div className="flex gap-2">
          {morning && !tooRough && !err ? (
            <button type="button" className="btn-secondary h-12 flex-1 justify-center whitespace-nowrap" disabled={busy} onClick={onClose}>Cancel</button>
          ) : (
            <button type="button" className="btn-secondary h-12 flex-1 justify-center whitespace-nowrap" disabled={busy} onClick={() => setRound(r => r + 1)}>
              <RefreshCw className="h-5 w-5" /> Try again
            </button>
          )}
          <button type="button" className="btn-primary btn-go h-12 flex-[2] justify-center text-base" disabled={!fix || tooRough || busy} onClick={() => void start()}>
            {busy ? <Spinner className="h-5 w-5" /> : end ? <Sunset className="h-5 w-5" /> : <Sunrise className="h-5 w-5" />} {end ? (day ? (morning ? `End ${shortDay(day)}` : `End ${shortDay(day)} here`) : 'End my day here') : 'Start my day here'}
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
export function EndDayButton({ day }: { day?: string | null }) {
  const [open, setOpen] = useState(false)
  const ask = useAsk()
  // An earlier day ended: said, and today's Start my day is next (the user, 12 Nov).
  const said = () => {
    if (!day) return
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
    void ask.alert(`${shortDay(day)} ended`, `Start my day for ${shortDay(today)}`, 'success')
  }
  return (
    <>
      <button type="button" data-end-day className="h-12 w-full rounded-xl border border-orange-300 bg-orange-50 px-4 text-base font-semibold text-orange-800 hover:bg-orange-100 sm:w-auto sm:px-6" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap"><Sunset className="h-5 w-5" /> {day ? `End ${shortDay(day)}` : 'End my day'}</span>
      </button>
      {open && <StartConfirm end day={day} onStarted={said} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The drawn picture of a day's start, or with `end` its end: the sun going down over the road home. */
export function StartArt({ home, end = false }: { home: boolean; end?: boolean }) {
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="sd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" /><stop offset="0.6" stopColor="#fdba74" /><stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id="sd-dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c1d95" /><stop offset="0.55" stopColor="#c026d3" /><stop offset="1" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill={end ? 'url(#sd-dusk)' : 'url(#sd-sky)'} />
      <circle cx="80" cy={end ? 88 : 78} r="24" fill={end ? '#fdba74' : '#fff7ed'} opacity="0.95" />
      {!end && [-60, -30, 0, 30, 60].map(a => (
        <line key={a} x1="80" y1="78" x2={80 + Math.sin((a * Math.PI) / 180) * 40} y2={78 - Math.cos((a * Math.PI) / 180) * 40} stroke="#fff7ed" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      ))}
      <path d="M0 86 Q40 68 80 82 T160 78 V120 H0Z" fill={end ? '#3f6212' : '#65a30d'} />
      <path d="M0 96 Q50 84 100 96 T160 92 V120 H0Z" fill={end ? '#365314' : '#4d7c0f'} />
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
