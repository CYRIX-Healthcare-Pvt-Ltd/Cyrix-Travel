import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sunrise } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { placeName, whereAmI } from '@/lib/geo'
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

export function StartDayButton({ onStarted }: { onStarted?: (s: DayStart) => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const press = async () => {
    setBusy(true); setErr(null)
    try {
      // The local preview, with location off, starts at a sample spot (Vyttila).
      const fix = await whereAmI().catch(e => { if (startPreview) return { lat: 9.9667, lng: 76.3186, accuracy: 10 }; throw e })
      const place = await placeName(fix)
      if (!startPreview) {
        const { error } = await supabase.rpc('te_start_day', { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_place: place })
        if (error) throw new Error(friendlyError(error))
        await Promise.all(['te_my_day', 'te_my_starts'].map(k => qc.invalidateQueries({ queryKey: [k] })))
      }
      onStarted?.({ day: new Date().toLocaleDateString('en-CA'), at: new Date().toISOString(), lat: fix.lat, lng: fix.lng, place, home_m: null })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div>
      <button type="button" className="btn-primary btn-go h-12 w-full text-base sm:w-auto sm:px-6" disabled={busy} onClick={() => void press()}>
        {busy ? <Spinner className="h-5 w-5" /> : <Sunrise className="h-5 w-5" />} Start my day
      </button>
      {err && <div className="mt-2"><Alert kind="error">{err}</Alert></div>}
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
