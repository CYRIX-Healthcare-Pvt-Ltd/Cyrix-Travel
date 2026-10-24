import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HandCoins, House, MapPin, Plus, Send, Undo2 } from 'lucide-react'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { placeName } from '@/lib/geo'
import { areaOf, bestArea, money, monthName, rpc, searchAreas, type Area } from '@/lib/claims'
import { ADVANCE_STATUS, shortDate, useAdvanceRefresh, useMyAdvances, type Advance, type MyAdvances } from '@/lib/advances'

/*
  My advance (te_0063; the user, 24 Oct: "after my claim add my advance … manager should approve then travel desk
  should approve then only tm can see his amount, so need to show how much used"). Asked for here under HR's rules
  — out of the state only, two a month and ₹20,000 a month at most, none while one is unsettled — and each one
  given shows what the claims have taken of it and what is left.
*/
export default function Advances() {
  const { data, isLoading, error } = useMyAdvances()
  const nav = useNavigate()
  const [asking, setAsking] = useState(false)
  if (isLoading) return <PageLoader />
  const list = data?.advances ?? []
  const given = list.filter(a => a.status === 'given')
  const balance = given.reduce((t, a) => t + (a.left ?? 0), 0)
  const m = data?.month
  // The base is the home (the user: "if need to add then redirect to places and tell to set home").
  const request = () => (data?.home ? setAsking(true) : nav('/places', { state: { need: 'Set your home first — an advance is from your home' } }))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><HandCoins className="h-5 w-5 text-indigo-600" /> My advance</h1>
        {!asking && !data?.blocked && <button type="button" className="btn-primary" onClick={request}><Plus className="h-4 w-4" /> Request an advance</button>}
      </div>
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      {m && (
        <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ink-500">Balance</p>
            <p className="text-2xl font-bold text-ink-900">{money(balance)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">This month</p>
            <p className="text-lg font-semibold text-ink-900">{m.count} of {m.max_count}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-ink-500">Asked this month</p>
            <p className="text-lg font-semibold text-ink-900">{money(m.amount)} <span className="text-sm font-normal text-ink-500">of {money(m.max_amount)}</span></p>
          </div>
        </div>
      )}
      {data?.blocked && !asking && <Alert kind="warning">{data.blocked}</Alert>}
      {asking && data && <RequestForm data={data} onClose={() => setAsking(false)} />}
      {list.length === 0 && !asking
        ? <div className="card p-8 text-center text-sm text-ink-500">No advances yet.</div>
        : list.map(a => <AdvanceCard key={a.id} a={a} />)}
    </div>
  )
}

function RequestForm({ data, onClose }: { data: MyAdvances; onClose: () => void }) {
  const refresh = useAdvanceRefresh()
  const home = data.home!
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [reason, setReason] = useState('')
  const [dest, setDest] = useState<Area | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  // Said beside Request, and again on a repeat press (the user, 24 Oct: errors where the button is).
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const fail = (text: string) => setErr(e => ({ text, n: (e?.n ?? 0) + 1 }))
  const { data: homeName } = useQuery({ queryKey: ['place', home.lat, home.lng], staleTime: Infinity, queryFn: () => placeName(home) })
  const { data: homeArea } = useQuery({ queryKey: ['area', home.lat, home.lng], staleTime: Infinity, queryFn: () => areaOf(home.lat, home.lng) })
  // HR's rule 1: out of the state only — said under the destination as soon as it is chosen.
  const sameState = !!homeArea?.state && !!dest && homeArea.state.toLowerCase() === dest.state.toLowerCase()
  const left = data.month.max_amount - data.month.amount
  const send = async () => {
    const amt = Math.round(Number(amount) || 0)
    if (amt <= 0) return fail('Enter the advance amount')
    if (amt > left) return fail(`Up to ${money(left)} more this month`)
    if (purpose.trim().length < 3) return fail('Enter the purpose — the work it is for')
    if (reason.trim().length < 3) return fail('Enter the reason for the advance')
    if (!homeArea?.state) return fail('The state of your home could not be found — try again')
    // Every field is needed (the user, 24 Oct), the cost centre HR maps too.
    if (!data.cost_centre) return fail('Your cost centre is not mapped — ask HR to set it')
    if (!typed.trim() && !dest) return fail('Enter where you are travelling to')
    setBusy(true); setErr(null)
    try {
      // Typed and not picked from the list: the city, district or state it names.
      let to = dest
      if (!to && typed.trim().length >= 2) { to = bestArea(await searchAreas(typed.trim()), typed); if (to) setDest(to) }
      if (!to) return fail(typed.trim() ? `No city, district or state called "${typed.trim()}"` : 'Enter where you are travelling to')
      if (to.state.toLowerCase() === homeArea.state.toLowerCase()) return fail(`An advance is only for travel outside ${homeArea.state}`)
      await rpc('te_advance_request', {
        p_amount: amt, p_purpose: purpose, p_reason: reason, p_base_name: homeName ?? null, p_base_state: homeArea.state,
        p_dest_name: to.name, p_dest_lat: to.lat, p_dest_lng: to.lng, p_dest_state: to.state,
      })
      await refresh()
      onClose()
    } catch (e) { fail((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card space-y-4 p-4">
      <h2 className="text-base font-semibold text-ink-900">Expense advance request</h2>
      <label className="block"><span className="label">Advance amount</span>
        {/* Digits only, and never more than the month has left (the user, 24 Oct: "if typed greater than 20000, it shouldnt type it"). */}
        <input type="text" inputMode="numeric" className="input mt-1 sm:max-w-xs" value={amount} placeholder={`Up to ${money(left)}`}
          onChange={e => { const v = e.target.value.replace(/\D/g, '').replace(/^0+/, ''); if (Number(v || 0) <= left) setAmount(v) }} />
        {/* The month's second request says what is left of it (the user, 24 Oct: "on 2nd request, under amount
            field say only this much available in this month to request"). */}
        {data.month.count > 0 && <span className="mt-1 block text-xs font-medium text-amber-700">Only {money(left)} available to request this month</span>}</label>
      <label className="block"><span className="label">Purpose of Advance (Work details)</span>
        <textarea rows={2} className="input mt-1" value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
      <label className="block"><span className="label">Reason for advance</span>
        <textarea rows={2} className="input mt-1" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="label">Base Location</span>
          <div className="input mt-1 flex items-center gap-2 bg-ink-50 text-ink-700">
            <House className="h-4 w-4 shrink-0 text-teal-600" />
            <span className="min-w-0 truncate">{homeName ?? 'Home'}{homeArea?.state ? ` · ${homeArea.state}` : ''}</span>
          </div>
        </div>
        <div className="min-w-0">
          <span className="label">Travel Destination (To)</span>
          <AreaField value={dest} onChange={a => { setDest(a); setErr(null) }} onText={setTyped} />
          {sameState && <p className="mt-1 text-sm text-cyrixRed-700">An advance is only for travel outside {homeArea!.state}</p>}
        </div>
      </div>
      <div className="sm:max-w-xs">
        <span className="label">Project or Cost Centre</span>
        <div className="input mt-1 bg-ink-50 text-ink-700">{data.cost_centre ?? 'Not mapped'}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void send()}>
          {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Request advance
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

function AdvanceCard({ a }: { a: Advance }) {
  const ask = useAsk()
  const refresh = useAdvanceRefresh()
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const s = ADVANCE_STATUS[a.status]
  const pct = a.amount > 0 ? Math.min(1, a.used / a.amount) : 0
  const withdraw = async () => {
    if (!(await ask.confirm({ title: `Withdraw ${a.number}?`, body: `${money(a.amount)} to ${a.dest_name}`, yes: 'Withdraw', danger: true }))) return
    try { await rpc('te_advance_cancel', { p_advance: a.id }); await refresh() } catch (e) { setErr(x => ({ text: (e as Error).message, n: (x?.n ?? 0) + 1 })) }
  }
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{a.number} · {money(a.amount)}</p>
          <p className="truncate text-xs text-ink-500">{a.base_state} → {a.dest_name}{a.cost_centre ? ` · ${a.cost_centre}` : ''} · {shortDate(a.created_at)}</p>
        </div>
        <span className={`badge shrink-0 whitespace-nowrap ${s.tone}`}>{s.label}</span>
      </div>
      <p className="text-sm text-ink-800">{a.purpose}<span className="text-ink-500"> · {a.reason}</span></p>
      {a.status === 'given' && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-600">{money(a.used)} used</span>
            <span className="font-semibold text-ink-900">{money(a.left)} left</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-indigo-100">
            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${pct * 100}%`, minWidth: a.used > 0 ? 4 : 0 }} />
          </div>
          {a.uses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.uses.map(u => (
                <Link key={u.claim_id} to={`/claim/${u.claim_id}`} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700 hover:bg-ink-200">
                  {u.number ?? monthName(u.month)} · {money(u.amount)}{u.paid ? ' · paid' : ''}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      {(a.manager_at || a.desk_at || a.declined_at) && (
        <p className="text-xs text-ink-500">
          {a.manager_at && <>{a.manager_name} approved {shortDate(a.manager_at)}{a.manager_note ? ` — ${a.manager_note}` : ''}</>}
          {a.desk_at && <> · {a.desk_name} (Travel Desk) {shortDate(a.desk_at)}{a.desk_note ? ` — ${a.desk_note}` : ''}</>}
          {a.declined_at && <span className="text-cyrixRed-700">{a.manager_at ? ' · ' : ''}Declined by {a.declined_name} {shortDate(a.declined_at)}: {a.decline_note}</span>}
        </p>
      )}
      {(a.status === 'with_manager' || a.status === 'with_desk') && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => void withdraw()}><Undo2 className="h-4 w-4" /> Withdraw</button>
        </div>
      )}
      {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
    </div>
  )
}
