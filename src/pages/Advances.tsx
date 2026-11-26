import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, HandCoins, PencilLine, Plus, Undo2 } from 'lucide-react'
import { useAsk } from '@/components/Ask'
import AdvanceForm from '@/components/AdvanceForm'
import AdvanceDetail from '@/components/AdvanceDetail'
import { Alert, PageLoader } from '@/components/ui'
import { money, monthName, rpc } from '@/lib/claims'
import { ADVANCE_STATUS, shortDate, useAdvanceRefresh, useMyAdvances, type Advance } from '@/lib/advances'

/*
  My advance (te_0063; the user, 24 Oct: "after my claim add my advance … manager should approve then travel desk
  should approve then only tm can see his amount, so need to show how much used"). Asked for here under HR's rules
  — out of the state only, two a month and ₹20,000 a month at most, none while one is unsettled — and each one
  given shows what the claims have taken of it and what is left.
*/
export default function Advances({ inProfile = false }: { inProfile?: boolean }) {
  const { data, isLoading, error } = useMyAdvances()
  const nav = useNavigate()
  const [asking, setAsking] = useState(false)
  if (isLoading) return <PageLoader />
  const list = data?.advances ?? []
  const given = list.filter(a => a.status === 'given')
  const balance = given.reduce((t, a) => t + (a.left ?? 0), 0)
  const m = data?.month
  // The base is the home (the user: "if need to add then redirect to places and tell to set home").
  const request = () => (data?.home ? setAsking(true) : nav('/profile', { state: { need: 'Set your home first — an advance is from your home' } }))
  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-3 ${inProfile ? 'justify-end' : 'justify-between'}`}>
        {!inProfile && <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><HandCoins className="h-5 w-5 text-indigo-600" /> My advance</h1>}
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
      {asking && data?.home && (
        <div className="card p-4">
          <h2 className="mb-4 text-base font-semibold text-ink-900">Expense advance request</h2>
          <AdvanceForm home={data.home} left={data.month.max_amount - data.month.amount} monthCount={data.month.count}
            ownCentre={data.cost_centre} onClose={() => setAsking(false)} />
        </div>
      )}
      {list.length === 0 && !asking
        ? <div className="card p-8 text-center text-sm text-ink-500">No advances yet.</div>
        : list.map(a => <AdvanceCard key={a.id} a={a} />)}
    </div>
  )
}

function AdvanceCard({ a }: { a: Advance }) {
  const ask = useAsk()
  const refresh = useAdvanceRefresh()
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const [open, setOpen] = useState(false)
  const s = ADVANCE_STATUS[a.status]
  const pct = a.amount > 0 ? Math.min(1, a.used / a.amount) : 0
  const withdraw = async () => {
    if (!(await ask.confirm({ title: `Withdraw ${a.number}?`, body: `${money(a.amount)} to ${a.dest_name}`, yes: 'Withdraw', danger: true }))) return
    try { await rpc('te_advance_cancel', { p_advance: a.id }); await refresh() } catch (e) { setErr(x => ({ text: (e as Error).message, n: (x?.n ?? 0) + 1 })) }
  }
  return (
    <div className="card space-y-3 p-4">
      <button type="button" onClick={() => setOpen(true)} className="block w-full space-y-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">{a.number} · {money(a.amount)}</p>
            <p className="truncate text-xs text-ink-500">{a.base_state} → {a.dest_name}{a.cost_centre ? ` · ${a.cost_centre}` : ''} · {shortDate(a.created_at)}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
            <ChevronRight className="h-4 w-4 text-ink-400" />
          </span>
        </div>
        <p className="text-sm text-ink-800">{a.purpose}<span className="text-ink-500"> · {a.reason}</span></p>
      </button>
      {a.edited_at && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <PencilLine className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Edited by {a.edited_name} {shortDate(a.edited_at)} · {a.edit_note}
        </p>
      )}
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
      {open && <AdvanceDetail a={a} onClose={() => setOpen(false)} />}
    </div>
  )
}
