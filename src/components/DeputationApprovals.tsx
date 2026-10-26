import { useState } from 'react'
import { BriefcaseBusiness, Check, CornerUpLeft, FileText } from 'lucide-react'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { money, rpc } from '@/lib/claims'
import { clockTime } from '@/lib/when'
import { DEP_STATUS, depDays, depRange, letterUrl, useDepInbox, useDepRefresh, useMyDeputations, type InboxDeputation } from '@/lib/deputation'

/*
  Deputations waiting on the reporting manager (te_0075): a new one, or a change to the approved one, said beside
  what it changes. Send back asks why; both ask first (the user, 26 Oct: "check for all pop up").
*/
const TABS = [['waiting', 'To approve'], ['done', 'Approved'], ['returned', 'Sent back']] as const
type Tab = typeof TABS[number][0]
const EMPTY: Record<Tab, string> = { waiting: 'No deputation for you to approve.', done: 'Nothing approved yet.', returned: 'Nothing sent back.' }
const COUNT: Record<Tab, string> = { waiting: 'bg-cyrixRed-600 text-white', done: 'bg-green-600 text-white', returned: 'bg-ink-600 text-white' }

export default function DeputationApprovals() {
  const { data, isLoading, error } = useDepInbox()
  const [tab, setTab] = useState<Tab>('waiting')
  if (isLoading) return <PageLoader />
  const all = data ?? []
  const lists: Record<Tab, InboxDeputation[]> = {
    waiting: all.filter(d => d.waiting),
    done: all.filter(d => d.status === 'approved' || d.status === 'replaced'),
    returned: all.filter(d => d.status === 'returned'),
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
        ? <div className="card divide-y divide-ink-100 overflow-hidden">{lists[tab].map(d => <Row key={d.id} d={d} />)}</div>
        : <div className="card p-6 text-center text-sm text-ink-500">{EMPTY[tab]}</div>}
    </div>
  )
}

function Row({ d }: { d: InboxDeputation }) {
  const ask = useAsk()
  const refresh = useDepRefresh()
  const { data: mine } = useMyDeputations()
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  // Said in the row whose button was pressed (errors where the button is).
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const first = d.name.split(' ')[0]
  const what = `${d.state} · ${depRange(d.from_day, d.to_day)}`
  const s = DEP_STATUS[d.status]
  const decide = async (approve: boolean) => {
    let note: string | null = null
    if (approve) {
      if (!(await ask.confirm({ title: `Approve ${first}'s deputation?`, body: `${what} · DA ${money(mine?.da ?? 800)} a day`, yes: 'Approve', icon: Check, go: true }))) return
    } else {
      note = await ask.prompt({ title: `Send ${first}'s deputation back?`, body: what, label: 'Why is it going back?', yes: 'Send back' })
      if (!note) return
    }
    setBusy(true); setErr(null)
    try {
      await rpc('te_dep_decide', { p_id: d.id, p_approve: approve, p_note: note })
      await refresh()
      await ask.alert(approve ? 'Deputation approved' : 'Deputation sent back', `${d.name} · ${what}`, approve ? 'success' : 'info')
    } catch (e) { setErr(x => ({ text: (e as Error).message, n: (x?.n ?? 0) + 1 })) }
    finally { setBusy(false) }
  }
  const openLetter = async () => {
    const url = await letterUrl(d.letter_path)
    if (url) setViewing({ url, name: d.letter_name ?? 'Deputation letter' })
    else setErr(x => ({ text: 'The letter could not be opened', n: (x?.n ?? 0) + 1 }))
  }
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{d.name} <span className="text-xs text-ink-500">{d.ecode}</span></p>
          <p className="flex items-center gap-1.5 text-sm text-ink-800"><BriefcaseBusiness className="h-4 w-4 shrink-0 text-violet-600" /><span className="min-w-0 truncate"><b>{d.state}</b> · {depRange(d.from_day, d.to_day)} · {depDays(d.from_day, d.to_day)} days</span></p>
        </div>
        <button type="button" className="btn-secondary shrink-0 !py-1.5 text-sm" onClick={() => void openLetter()}><FileText className="h-4 w-4" /> Letter</button>
      </div>
      {d.was && <p className="text-xs text-ink-600">Change from {d.was.state} · {depRange(d.was.from_day, d.was.to_day)}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
        <span>Asked {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, {clockTime(d.created_at)}</span>
        {d.decided_name && d.status !== 'with_manager' && <span>{d.status === 'returned' ? 'Sent back' : 'Approved'} by {d.decided_name} ({d.decided_ecode})</span>}
        {d.note && <span className={d.status === 'returned' ? 'text-cyrixRed-700' : ''}>“{d.note}”</span>}
      </div>
      {d.waiting && (
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex">
          <button type="button" className="btn-secondary !border-amber-300 !bg-amber-50 !py-1.5 text-sm !text-amber-800 hover:!bg-amber-100" disabled={busy} onClick={() => void decide(false)}><CornerUpLeft className="h-4 w-4" /> Send back</button>
          <button type="button" className="btn-primary btn-go !py-1.5 text-sm" disabled={busy} onClick={() => void decide(true)}>
            {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Approve
          </button>
        </div>
      )}
      {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}
