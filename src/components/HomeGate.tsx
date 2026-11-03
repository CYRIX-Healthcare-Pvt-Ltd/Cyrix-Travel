import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { House, LocateFixed, Map as MapIcon } from 'lucide-react'
import PlacePicker from '@/components/PlacePicker'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useHomeChanges } from '@/lib/travel'
import { placeName, whereAmI } from '@/lib/geo'
import type { Place } from '@/lib/claims'

/*
  Home first (te_0102; the user, 3 Nov: "from 2mrw, when travel module is opening, show pop up for those who havnt set
  home location, after setting it only they can continue, mark it on map or use this location, after done only they
  can close that page"). It stands in for every page until a home is saved; the header stays, so signing out still
  works. Locally, ?home-preview shows it to anyone, to look at before the day.
*/
const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('home-preview')

export default function HomeGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const ask = useAsk()
  const { data: needed, isLoading } = useQuery({
    queryKey: ['te_home_needed'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('te_home_needed')
      if (error) throw error
      return data as boolean
    },
  })
  const changes = useHomeChanges()
  const [shown, setShown] = useState(preview)
  const [busy, setBusy] = useState(false)
  const [onMap, setOnMap] = useState(false)
  const [err, setErr] = useState<{ at: 'here' | 'map'; text: string; n: number } | null>(null)
  const fail = (at: 'here' | 'map', text: string) => setErr(x => ({ at, text, n: (x?.n ?? 0) + 1 }))

  if (isLoading && !preview) return <PageLoader />
  if (!needed && !shown) return <>{children}</>

  const save = async (at: { lat: number; lng: number }, how: 'here' | 'map', name: string) => {
    if (!(await ask.confirm({ title: 'Set your home here?', body: name, yes: 'Set home', icon: House, go: true }))) return
    const { error } = await supabase.rpc('travel_set_home', { p_lat: at.lat, p_lng: at.lng, p_how: how })
    if (error) throw new Error(error.message)
    await Promise.all(['te_home', 'te_home_needed'].map(k => qc.invalidateQueries({ queryKey: [k] })))
    await ask.alert('Home saved', name, 'success')
    setShown(false)
  }
  const here = async () => {
    setBusy(true); setErr(null)
    try {
      const at = await whereAmI()
      await save(at, 'here', (await placeName(at)) ?? `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`)
    } catch (e) { fail('here', (e as Error).message) } finally { setBusy(false) }
  }
  const fromMap = async (p: Place) => {
    setOnMap(false); setErr(null)
    try { await save(p, 'map', p.name && p.name !== '…' ? p.name : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`) }
    catch (e) { fail('map', (e as Error).message) }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-2 pt-6 text-center sm:pt-12">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><House className="h-8 w-8" /></span>
      <h1 className="mt-4 text-2xl font-semibold text-ink-900">Set your home</h1>
      <p className="mt-1 text-sm text-ink-600">Every claim starts from your home.</p>
      {/* The user, 3 Nov: "show alert, max 3 time home can be changed in a month" (te_0103). */}
      <div className="mt-5 w-full text-left"><Alert kind="warning">Home can be changed only {changes?.limit ?? 3} times a month</Alert></div>
      <div className="mt-5 w-full space-y-3">
        <div>
          <button type="button" className="btn-primary btn-go h-14 w-full justify-center rounded-xl text-base" disabled={busy} onClick={() => void here()}>
            {busy ? <Spinner className="h-5 w-5" /> : <LocateFixed className="h-5 w-5" />} I'm at home — use this location
          </button>
          {err?.at === 'here' && <div className="mt-2 text-left"><Alert key={err.n} kind="error">{err.text}</Alert></div>}
        </div>
        <div>
          <button type="button" className="btn-secondary h-14 w-full justify-center rounded-xl text-base" disabled={busy} onClick={() => { setErr(null); setOnMap(true) }}>
            <MapIcon className="h-5 w-5" /> Mark it on the map
          </button>
          {err?.at === 'map' && <div className="mt-2 text-left"><Alert key={err.n} kind="error">{err.text}</Alert></div>}
        </div>
      </div>
      {onMap && (
        <PlacePicker title="Your home" start={null} quick={[]} plain yes="Set as home"
          onPick={p => void fromMap(p)} onClose={() => setOnMap(false)} />
      )}
    </div>
  )
}
