import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useAsk } from '@/components/Ask'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { money, rpc } from '@/lib/claims'
import { ADVANCE_STATUS, shortDate, useAdvanceInbox, useAdvanceRefresh, type InboxAdvance } from '@/lib/advances'

/*
  Advances waiting on this person (te_0063): the reporting manager's step, then the Travel Desk's. Each says how
  the person's month stands — a second advance is seen as one — and an approved one what is left of it.
*/
const TABS = [['waiting', 'To approve'], ['done', 'Approved'], ['declined', 'Declined']] as const
type Tab = typeof TABS[number][0]
const EMPTY: Record<Tab, string> = { waiting: 'No advance for you to approve.', done: 'Nothing approved yet.', declined: 'Nothing declined.' }
const COUNT: Record<Tab, string> = { waiting: 'bg-cyrixRed-600 text-white', done: 'bg-green-600 text-white', declined: 'bg-ink-600 text-white' }

export default function AdvanceApprovals() {
  const { data, isLoading, error } = useAdvanceInbox()
  const { isDesk } = useAuth()
  const [tab, setTab] = useState<Tab>('waiting')
  if (isLoading) return <PageLoader />
  const all = data ?? []
  const lists: Record<Tab, InboxAdvance[]> = {
    waiting: all.filter(a => a.waiting),
    // Past this person's own step: given, for the Travel Desk; with the Travel Desk or given, for a manager. One still
    // with the manager is approved by nobody yet (the user, 24 Oct: "why showing in travel desk approved? before
    // reporting manager approving?").
    done: all.filter(a => !a.waiting && (a.status === 'given' || (a.status === 'with_desk' && !isDesk))),
    declined: all.filter(a => a.status === 'declined'),
  }
  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      <div className="flex border-b border-ink-200" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 pb-2.5 pt-1 text-sm font-semibold sm:flex-none sm:px-4 ${tab === k ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {l}
            <span className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${lists[k].length > 0 ? COUNT[k] : 'bg-ink-100 text-ink-700'}`}>{lists[k].length}</span>
          </button>
        ))}
      </div>
      {lists[tab].length
        ? <div className="card divide-y divide-ink-100 overflow-hidden">{lists[tab].map(a => <Row key={a.id} a={a} />)}</div>
        : <div className="card p-6 text-center text-sm text-ink-500">{EMPTY[tab]}</div>}
    </div>
  )
}

function Row({ a }: { a: InboxAdvance }) {
  const ask = useAsk()
  const refresh = useAdvanceRefresh()
  const [busy, setBusy] = useState(false)
  // Said in the row whose button was pressed (errors where the button is).
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const s = ADVANCE_STATUS[a.status]
  const decide = async (approve: boolean) => {
    let note: string | null = null
    // Approving asks first too (the user, 26 Oct: "check for all pop up").
    if (approve && !(await ask.confirm({ title: `Approve ${a.number}?`, body: `${a.name} · ${money(a.amount)}`, yes: 'Approve', icon: Check, go: true }))) return
    if (!approve) {
      note = await ask.prompt({ title: `Decline ${a.number}?`, body: `${a.name} · ${money(a.amount)}`, label: 'Why is it declined?', yes: 'Decline' })
      if (!note) return
    }
    setBusy(true); setErr(null)
    try { await rpc('te_advance_decide', { p_advance: a.id, p_approve: approve, p_note: note }); await refresh() }
    catch (e) { setErr(x => ({ text: (e as Error).message, n: (x?.n ?? 0) + 1 })) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{a.name} <span className="text-xs text-ink-500">{a.ecode}</span></p>
          <p className="truncate text-xs text-ink-600"><b className="text-ink-900">{a.number}</b> · {a.base_state} → {a.dest_name}{a.cost_centre ? ` · ${a.cost_centre}` : ''} · {shortDate(a.created_at)}</p>
        </div>
        <span className="shrink-0 text-right text-base font-semibold text-ink-900">{money(a.amount)}</span>
      </div>
      <p className="text-sm text-ink-800">{a.purpose}<span className="text-ink-500"> · {a.reason}</span></p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
        <span>{a.month_count} this month · {money(a.month_amount)}</span>
        {a.status === 'given' && <span>{money(a.used)} used · <b className="text-ink-800">{money(a.left)} left</b></span>}
        {a.manager_at && a.status !== 'with_manager' && <span>{a.manager_name} approved {shortDate(a.manager_at)}</span>}
        {a.declined_at && <span className="text-cyrixRed-700">Declined by {a.declined_name}: {a.decline_note}</span>}
      </div>
      {a.waiting && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary !py-1.5 text-sm" disabled={busy} onClick={() => void decide(true)}>
            {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Approve
          </button>
          <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => void decide(false)}><X className="h-4 w-4" /> Decline</button>
        </div>
      )}
      {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
    </div>
  )
}
