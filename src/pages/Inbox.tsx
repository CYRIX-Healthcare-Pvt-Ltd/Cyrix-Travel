import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ShieldAlert, TriangleAlert } from 'lucide-react'
import ApproveAll from '@/components/ApproveAll'
import { useAsk } from '@/components/Ask'
import { claimIssues } from '@/pages/ClaimPage'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import AdvanceApprovals from '@/components/AdvanceApprovals'
import { useAdvanceInbox } from '@/lib/advances'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { Alert, PageLoader } from '@/components/ui'
import { PlaceChips, useClaimFilter } from '@/components/ClaimRows'
import { STATUS, claimName, dayRange, km, money, rpc, useInbox, type ClaimData } from '@/lib/claims'

/**
 * Claims waiting on this person — manager, coordinator or Travel Desk — and the ones they passed on, still to
 * be paid or paid, each under its own tab (the user, 21 Oct: "if many claims come we should not have to go
 * down to see the others").
 */
// Named by what the person does (the user, 21 Oct: "does the manager know the waiting tab is for him, to approve?"); short enough to fit across a phone.
const TABS = [['waiting', 'To approve'], ['pending', 'To be paid'], ['paid', 'Paid']] as const
type Tab = typeof TABS[number][0]
const EMPTY: Record<Tab, string> = { waiting: 'Nothing for you to approve.', pending: 'Nothing waiting to be paid.', paid: 'Nothing paid yet.' }
// Each tab's count in its own colour while it has any (the user, 21 Oct: to approve red, to be paid yellow, paid green).
const COUNT: Record<Tab, string> = { waiting: 'bg-cyrixRed-600 text-white', pending: 'bg-amber-600 text-white', paid: 'bg-green-600 text-white' }
// The tab chosen is kept for this browser tab, so coming back from a claim finds it again (the user, 21 Oct).
const TAB_KEY = 'te.approvals.tab'
type Issues = ReturnType<typeof claimIssues>
/*
  What is out of policy or to check on each claim waiting on this person (the user, 23 Oct: "can we show it here
  also?"): each claim read a few at a time and kept in the cache, so the claim page and Approve all find it there.
*/
function useWaitingIssues(ids: string[]) {
  const qc = useQueryClient()
  const [map, setMap] = useState<Record<string, Issues>>({})
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    void (async () => {
      for (let i = 0; i < ids.length; i += 6) {
        const part = await Promise.all(ids.slice(i, i + 6).map(async id => {
          try { return [id, claimIssues(await qc.fetchQuery({ queryKey: ['te_claim', id], queryFn: () => rpc<ClaimData>('te_claim', { p_claim: id }), staleTime: 60_000 }))] as const }
          catch { return [id, [] as Issues] as const }
        }))
        if (!live) return
        setMap(m => ({ ...m, ...Object.fromEntries(part) }))
      }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}

const keptTab = (): Tab => { try { const t = sessionStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? (t as Tab) : 'waiting' } catch { return 'waiting' } }

export default function Inbox() {
  const { data, isLoading, error } = useInbox()
  const done = (useLocation().state as { done?: string } | null)?.done
  const find = useClaimFilter('te.approvals')
  const [tab, setTabState] = useState<Tab>(keptTab)
  const setTab = (t: Tab) => { setTabState(t); try { sessionStorage.setItem(TAB_KEY, t) } catch { /* only a convenience */ } }
  // Approve all, in its own window (the user, 23 Oct).
  const [approving, setApproving] = useState<NonNullable<typeof data> | null>(null)
  const ask = useAsk()
  const issues = useWaitingIssues((data ?? []).filter(c => c.waiting).map(c => c.id))
  // Claims, or advances (te_0063): the bell's advance messages open ?view=advances.
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'advances' ? 'advances' : 'claims'
  const { data: advances } = useAdvanceInbox()
  if (isLoading) return <PageLoader />
  const found = (data ?? []).filter(find.test)
  /*
    Passed on and not yet paid, and paid (the user, 21 Oct: "it is what the manager approves, the pending
    payment"); a claim sent back sits with the unpaid ones, its chip saying where it is.
  */
  const lists: Record<Tab, typeof found> = {
    waiting: found.filter(c => c.waiting),
    pending: found.filter(c => !c.waiting && c.status !== 'paid'),
    paid: found.filter(c => !c.waiting && c.status === 'paid'),
  }
  const shown = lists[tab]
  // The manager's own step: claims with the manager, waiting on this person.
  const managerOnes = lists.waiting.filter(c => c.status === 'with_manager')
  const Row = ({ c }: { c: NonNullable<typeof data>[number] }) => {
    const s = STATUS[c.status] ?? STATUS.draft
    return (
      // The same grid as My claims: on a phone the person and amount on top, the places and status under; on a computer fixed columns.
      <Link to={`/claim/${c.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-ink-100/60 sm:grid-cols-[minmax(0,1fr)_15rem_6rem_1rem] lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_15rem_6rem_1rem]">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{c.name} <span className="text-xs text-ink-500">{c.ecode}</span></p>
          <p className="truncate text-xs text-ink-600"><b className="text-ink-900">{c.number}</b> · {claimName(c.month, c.part)} · {dayRange(c.first_day, c.last_day)}{c.days > 1 ? ` · ${c.days} days` : ''}{c.km > 0 ? ` · ${km(c.km)}` : ''}</p>
        </div>
        <span className="text-right text-base font-semibold text-ink-900 sm:order-3">{money(c.total)}</span>
        {/* The places, in the middle on a computer, under the person on a phone (the user, 21 Oct). */}
        <span className={`col-span-2 min-w-0 sm:order-5 sm:col-span-4 lg:order-1 lg:col-span-1 ${c.places?.length ? '' : 'hidden lg:block'}`}><PlaceChips places={c.places} /></span>
        <span className="flex items-center gap-1.5 justify-self-start sm:order-2">
          <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
          {/* Out of policy (red) or something to check (grey, an amber mark: not the amber of With manager), beside the status; a press says what (the user, 23 Oct). */}
          {c.waiting && (issues[c.id]?.length ?? 0) > 0 && (() => {
            const list = issues[c.id], red = list.some(i => i.level === 'approve'), I = red ? ShieldAlert : TriangleAlert
            return (
              <span role="button" tabIndex={0} title={list.map(i => i.title).join(', ')}
                onClick={e => { e.preventDefault(); e.stopPropagation(); void ask.alert(`${c.number ?? ''} · ${red ? 'Out of policy' : 'To check'}`, list.map(i => i.title).join('\n'), red ? 'warn' : 'info') }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void ask.alert(`${c.number ?? ''} · ${red ? 'Out of policy' : 'To check'}`, list.map(i => i.title).join('\n'), red ? 'warn' : 'info') } }}
                className={`btn-press inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${red ? 'bg-cyrixRed-100 text-cyrixRed-700 hover:bg-cyrixRed-200' : 'bg-ink-100 text-ink-700 ring-1 ring-ink-200 hover:bg-ink-200'}`}>
                <I className={`h-3.5 w-3.5 ${red ? "" : "text-amber-600"}`} />{red ? 'Out of policy' : 'To check'}{list.length > 1 ? ` · ${list.length}` : ''}
              </span>
            )
          })()}
        </span>
        <ChevronRight className="h-4 w-4 justify-self-end text-ink-400 sm:order-4" />
      </Link>
    )
  }
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ClipboardCheck className="h-5 w-5 text-green-600" /> Approvals</h1>
      <div className="inline-flex rounded-xl bg-ink-100 p-1" role="tablist">
        {([['claims', 'Claims', (data ?? []).filter(c => c.waiting).length], ['advances', 'Advances', (advances ?? []).filter(a => a.waiting).length]] as const).map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setParams(k === 'advances' ? { view: 'advances' } : {}, { replace: true })}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold ${view === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>
            {l}{n > 0 && <span className="min-w-[1.25rem] rounded-full bg-cyrixRed-600 px-1.5 py-0.5 text-center text-xs font-bold text-white">{n}</span>}
          </button>
        ))}
      </div>
      {view === 'advances' ? <AdvanceApprovals /> : <>
      {done && <Alert kind="success">{done}</Alert>}
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      {(data?.length ?? 0) > 0 && find.bar}
      <div className="flex border-b border-ink-200" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 pb-2.5 pt-1 text-sm font-semibold sm:flex-none sm:px-4 ${tab === k ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {l}
            <span className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${lists[k].length > 0 ? COUNT[k] : 'bg-ink-100 text-ink-700'}`}>{lists[k].length}</span>
          </button>
        ))}
      </div>
      {tab === 'waiting' && managerOnes.length > 1 && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={() => setApproving(managerOnes)}>
            <CheckCheck className="h-4 w-4" /> Approve all
          </button>
        </div>
      )}
      {approving && <ApproveAll list={approving} onClose={() => setApproving(null)} />}
      {shown.length ? <div className="card divide-y divide-ink-100 overflow-hidden">{shown.map(c => <Row key={c.id} c={c} />)}</div>
        : <div className="card p-6 text-center text-sm text-ink-500">{find.active ? find.empty : EMPTY[tab]}</div>}
      </>}
    </div>
  )
}
