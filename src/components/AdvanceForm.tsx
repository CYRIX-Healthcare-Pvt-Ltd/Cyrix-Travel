import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { House, MapPin, Save, Send } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { placeName } from '@/lib/geo'
import { areaOf, bestArea, money, rpc, searchAreas, type Area } from '@/lib/claims'
import { useAdvanceRefresh, type Advance } from '@/lib/advances'

/*
  The expense advance form (te_0063), for asking and — the same form, filled in — for the reporting manager's edit
  (te_0127; the user, 5 Nov: "manager need approve, edit, decline also, edit opens same form"). The project or cost
  centre is chosen from SW Admin's Projects and starts on the person's own (the user: "something KLBEMMP emp goes to
  PVTBEMP … default should be their current centre").
*/
export default function AdvanceForm({ home, advance, left, monthCount = 0, ownCentre, onClose }: {
  /** Asking: the person's home, where the advance is from. */
  home?: { lat: number; lng: number }
  /** Editing: the advance as asked. */
  advance?: Advance & { own_centre?: string | null }
  /** What the month has left to ask, when asking. */
  left?: number
  monthCount?: number
  ownCentre: string | null
  onClose: () => void
}) {
  const refresh = useAdvanceRefresh()
  const editing = !!advance
  const [amount, setAmount] = useState(advance ? String(advance.amount) : '')
  const [purpose, setPurpose] = useState(advance?.purpose ?? '')
  const [reason, setReason] = useState(advance?.reason ?? '')
  const [dest, setDest] = useState<Area | null>(advance && advance.dest_lat != null
    ? { name: advance.dest_name, lat: advance.dest_lat, lng: advance.dest_lng!, state: advance.dest_state, kind: 'city' } : null)
  const [typed, setTyped] = useState('')
  const [centre, setCentre] = useState(advance?.cost_centre ?? ownCentre ?? '')
  const [busy, setBusy] = useState(false)
  // Said beside the button, and again on a repeat press (errors where the button is).
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const fail = (text: string) => setErr(e => ({ text, n: (e?.n ?? 0) + 1 }))
  const { data: homeName } = useQuery({ enabled: !!home, queryKey: ['place', home?.lat, home?.lng], staleTime: Infinity, queryFn: () => placeName(home!) })
  const { data: homeArea } = useQuery({ enabled: !!home, queryKey: ['area', home?.lat, home?.lng], staleTime: Infinity, queryFn: () => areaOf(home!.lat, home!.lng) })
  const baseState = advance?.base_state ?? homeArea?.state ?? null
  const { data: projects = [] } = useQuery({
    queryKey: ['te_projects'], staleTime: 10 * 60_000,
    queryFn: async () => (((await supabase.rpc('te_projects')).data ?? []) as Array<{ label: string }>).map(x => x.label),
  })
  // Their own centre first, then the rest; one kept that has since left the list still shows.
  const centres = [...new Set([ownCentre, advance?.cost_centre, ...projects].filter((x): x is string => !!x))]
  const sameState = !!baseState && !!dest && baseState.toLowerCase() === dest.state.toLowerCase()

  const send = async () => {
    const amt = Math.round(Number(amount) || 0)
    if (amt <= 0) return fail('Enter the advance amount')
    if (left != null && amt > left) return fail(`Up to ${money(left)} more this month`)
    if (purpose.trim().length < 3) return fail('Enter the purpose — the work it is for')
    if (reason.trim().length < 3) return fail('Enter the reason for the advance')
    if (!baseState) return fail('The state of the home could not be found — try again')
    if (!centre) return fail('Choose the project or cost centre')
    if (!typed.trim() && !dest) return fail('Enter where the travel is to')
    setBusy(true); setErr(null)
    try {
      // Typed and not picked from the list: the city, district or state it names.
      let to = dest
      if (!to && typed.trim().length >= 2) { to = bestArea(await searchAreas(typed.trim()), typed); if (to) setDest(to) }
      if (!to) return fail(typed.trim() ? `No city, district or state called "${typed.trim()}"` : 'Enter where the travel is to')
      if (to.state.toLowerCase() === baseState.toLowerCase()) return fail(`An advance is only for travel outside ${baseState}`)
      if (editing) {
        await rpc('te_advance_edit', {
          p_advance: advance!.id, p_amount: amt, p_purpose: purpose, p_reason: reason,
          p_dest_name: to.name, p_dest_lat: to.lat, p_dest_lng: to.lng, p_dest_state: to.state, p_cost_centre: centre,
        })
      } else {
        await rpc('te_advance_request', {
          p_amount: amt, p_purpose: purpose, p_reason: reason, p_base_name: homeName ?? null, p_base_state: baseState,
          p_dest_name: to.name, p_dest_lat: to.lat, p_dest_lng: to.lng, p_dest_state: to.state, p_cost_centre: centre,
        })
      }
      await refresh()
      onClose()
    } catch (e) { fail((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <label className="block"><span className="label">Advance amount</span>
        {/* Digits only, and never more than the month has left (the user, 24 Oct). */}
        <input type="text" inputMode="numeric" className="input mt-1 sm:max-w-xs" value={amount} placeholder={left != null ? `Up to ${money(left)}` : ''}
          onChange={e => { const v = e.target.value.replace(/\D/g, '').replace(/^0+/, ''); if (left == null || Number(v || 0) <= left) setAmount(v) }} />
        {!editing && monthCount > 0 && left != null && <span className="mt-1 block text-xs font-medium text-amber-700">Only {money(left)} available to request this month</span>}</label>
      <label className="block"><span className="label">Purpose of Advance (Work details)</span>
        <textarea rows={2} className="input mt-1" value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
      <label className="block"><span className="label">Reason for advance</span>
        <textarea rows={2} className="input mt-1" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="label">Base Location</span>
          <div className="input mt-1 flex items-center gap-2 bg-ink-50 text-ink-700">
            <House className="h-4 w-4 shrink-0 text-teal-600" />
            <span className="min-w-0 truncate">{(advance ? advance.base_name : homeName) ?? 'Home'}{baseState ? ` · ${baseState}` : ''}</span>
          </div>
        </div>
        <div className="min-w-0">
          <span className="label">Travel Destination (To)</span>
          <AreaField value={dest} onChange={a => { setDest(a); setErr(null) }} onText={setTyped} />
          {sameState && <p className="mt-1 text-sm text-cyrixRed-700">An advance is only for travel outside {baseState}</p>}
        </div>
      </div>
      <label className="block sm:max-w-xs"><span className="label">Project or Cost Centre</span>
        <select className="input mt-1" value={centre} onChange={e => setCentre(e.target.value)}>
          {!centre && <option value="">Choose</option>}
          {centres.map(c => <option key={c} value={c}>{c === ownCentre ? `${c} (own centre)` : c}</option>)}
        </select></label>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void send()}>
          {busy ? <Spinner className="h-4 w-4" /> : editing ? <Save className="h-4 w-4" /> : <Send className="h-4 w-4" />} {editing ? 'Save changes' : 'Request advance'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
    </div>
  )
}

/** A city, district or state, offered as it is typed. */
function AreaField({ value, onChange, onText }: { value: Area | null; onChange: (a: Area | null) => void; onText: (t: string) => void }) {
  const [text, setText] = useState(value?.name ?? '')
  const [list, setList] = useState<Area[]>([])
  const [open, setOpen] = useState(false)
  const [looking, setLooking] = useState(false)
  const [none, setNone] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const q = text.trim()
    if (value || q.length < 2) { setList([]); setNone(false); return }
    let live = true
    const t = window.setTimeout(async () => {
      setLooking(true)
      try {
        const r = await searchAreas(q)
        if (!live) return
        const exact = r.find(a => a.name.toLowerCase() === q.toLowerCase() || a.name.split(',')[0].toLowerCase() === q.toLowerCase())
        if (exact) { onChange(exact); setOpen(false); return }
        setList(r); setNone(r.length === 0); setOpen(true)
      }
      catch { if (live) { setList([]); setNone(true) } }
      finally { if (live) setLooking(false) }
    }, 300)
    return () => { live = false; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value])
  // A press outside closes the list.
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [])
  return (
    <div ref={box} className="relative mt-1">
      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyrixRed-600" />
      <input className="input !pl-9 !pr-9" value={text} placeholder="City, district or state" autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={e => { setText(e.target.value); onText(e.target.value); if (value) onChange(null) }} />
      {looking && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
      {open && !value && (list.length > 0 || none) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink-200 bg-surface py-1 shadow-lg">
          {list.map(a => (
            <button key={a.name} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100"
              onClick={() => { onChange(a); setText(a.name); setOpen(false) }}>
              <span className="min-w-0 flex-1 truncate text-ink-900">{a.name}</span>
              <span className="shrink-0 text-xs text-ink-500">{a.kind === 'state' ? 'State' : a.kind === 'district' ? 'District' : 'City'}</span>
            </button>
          ))}
          {none && <p className="px-3 py-2 text-sm text-ink-500">No city, district or state by that name</p>}
        </div>
      )}
    </div>
  )
}
