import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { initialsOf } from '@/components/Avatar'
import { claimIssues } from '@/pages/ClaimPage'
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import AdvanceApprovals from '@/components/AdvanceApprovals'
import DeputationApprovals from '@/components/DeputationApprovals'
import { useDepInbox } from '@/lib/deputation'
import { useAdvanceInbox } from '@/lib/advances'
import { CheckCheck, ChevronRight, ClipboardCheck, FileSpreadsheet, IndianRupee, ReceiptText, Route, Users, type LucideIcon } from 'lucide-react'
import ApproveAll from '@/components/ApproveAll'
import { exportApprovals } from '@/lib/exportApprovals'
import { Alert, PageLoader } from '@/components/ui'
import { useClaimFilter } from '@/components/ClaimRows'
import { claimName, km, money, rpc, useInbox, type ClaimData } from '@/lib/claims'

/**
 * Claims waiting on this person — manager, coordinator or Travel Desk — and the ones they passed on, still to
 * be paid or paid, each under its own tab (the user, 21 Oct: "if many claims come we should not have to go
 * down to see the others").
 */
// Named by what the person does (the user, 21 Oct: "does the manager know the waiting tab is for him, to approve?"); short enough to fit across a phone.
export const TABS = [['waiting', 'To approve'], ['pending', 'To be paid'], ['paid', 'Paid']] as const
type Tab = typeof TABS[number][0]
const EMPTY: Record<Tab, string> = { waiting: 'Nothing for you to approve.', pending: 'Nothing waiting to be paid.', paid: 'Nothing paid yet.' }
// Each tab's count in its own colour while it has any (the user, 21 Oct: to approve red, to be paid yellow, paid green).
const COUNT: Record<Tab, string> = { waiting: 'bg-cyrixRed-600 text-white', pending: 'bg-amber-600 text-white', paid: 'bg-green-600 text-white' }
// The tab chosen is kept for this browser tab, so coming back from a claim finds it again (the user, 21 Oct); opened
// afresh, Approvals is on To approve (the user, 27 Oct: "it should be in to approve sub tab isnt?").
const TAB_KEY = 'te.approvals.tab'
type Issues = ReturnType<typeof claimIssues>
/*
  What is out of policy or to check on each claim waiting on this person (the user, 23 Oct: "can we show it here
  also?"): each claim read a few at a time and kept in the cache, so the claim page and Approve all find it there.
*/
export function useWaitingIssues(ids: string[]) {
  const full = useClaimsData(ids)
  return Object.fromEntries(Object.entries(full).map(([id, d]) => [id, d ? claimIssues(d) : []])) as Record<string, Issues>
}

/** Each claim whole (te_claim), read a few at a time and kept in the cache; null where it could not be read. */
export function useClaimsData(ids: string[]) {
  const qc = useQueryClient()
  const [map, setMap] = useState<Record<string, ClaimData | null>>({})
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    void (async () => {
      for (let i = 0; i < ids.length; i += 6) {
        const part = await Promise.all(ids.slice(i, i + 6).map(async id => {
          try { return [id, await qc.fetchQuery({ queryKey: ['te_claim', id], queryFn: () => rpc<ClaimData>('te_claim', { p_claim: id }), staleTime: 60_000 })] as const }
          catch { return [id, null] as const }
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

export const keptTab = (): Tab => { try { const t = sessionStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? (t as Tab) : 'waiting' } catch { return 'waiting' } }

export default function Inbox() {
  const { data, isLoading, error } = useInbox()
  const sent = useLocation().state as { done?: string; tab?: Tab } | null
  const done = sent?.done
  const find = useClaimFilter('te.approvals')
  const back = useNavigationType() === 'POP'
  // Back from a person's page (its arrow) on the tab it was opened from.
  const [tab, setTabState] = useState<Tab>(() => { const t = back ? keptTab() : sent?.tab ?? 'waiting'; try { sessionStorage.setItem(TAB_KEY, t) } catch { /* only a convenience */ } return t })
  const setTab = (t: Tab) => { setTabState(t); try { sessionStorage.setItem(TAB_KEY, t) } catch { /* only a convenience */ } }
  const issues = useWaitingIssues((data ?? []).filter(c => c.waiting).map(c => c.id))
  // Claims, or advances (te_0063): the bell's advance messages open ?view=advances.
  const [params, setParams] = useSearchParams()
  // Deputations too (te_0075): the bell's deputation messages open ?view=deputation.
  const view = params.get('view') === 'advances' ? 'advances' : params.get('view') === 'deputation' ? 'deputation' : 'claims'
  const { data: advances } = useAdvanceInbox()
  const { data: deputations } = useDepInbox()
  const [approving, setApproving] = useState(false)
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
  /*
    One row per person, as the KPI team view (te_0080; the user, 27 Oct: "Emp name, cost centre, total claim total exp,
    then on click it should show each claim by him"): a press opens that person's claims.
  */
  const people = [...shown.reduce((m, c) => m.set(c.employee_id, [...(m.get(c.employee_id) ?? []), c]), new Map<string, typeof shown>())]
    .map(([id, cs]) => ({
      id, name: cs[0].name, ecode: cs[0].ecode, cost: cs[0].cost_centre, n: cs.length,
      km: cs.reduce((t, c) => t + Number(c.km), 0), total: cs.reduce((t, c) => t + Number(c.total), 0),
      red: cs.filter(c => issues[c.id]?.some(i => i.level === 'approve')).length,
      check: cs.filter(c => issues[c.id]?.length && !issues[c.id].some(i => i.level === 'approve')).length,
      // The reasons, most common first (the user, 29 Oct: the director found the list "very blank").
      why: [...cs.flatMap(c => issues[c.id] ?? []).reduce((m, i) => m.set(i.title, (m.get(i.title) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      months: [...new Set(cs.map(c => claimName(c.month, c.part)))],
      days: cs.reduce((t, c) => t + Number(c.days ?? 0), 0),
      places: new Set(cs.flatMap(c => c.places ?? [])).size,
      parts: [['bg-sky-500', 'Travel', cs.reduce((t, c) => t + Number(c.travel ?? 0), 0)], ['bg-emerald-500', 'DA', cs.reduce((t, c) => t + Number(c.da ?? 0), 0)],
        ['bg-amber-500', 'Other', cs.reduce((t, c) => t + Number(c.other ?? 0), 0)], ['bg-violet-500', 'Hotel', cs.reduce((t, c) => t + Number(c.hotel ?? 0), 0)]] as Array<[string, string, number]>,
    }))
  // Everyone's claims waiting on this person, as on each person's page (the user, 29 Oct: "here also keep approve all").
  const approvable = tab === 'waiting' ? shown.filter(c => ['with_manager', 'with_coordinator', 'with_desk'].includes(c.status)) : []
  // Each figure in its own colour with its picture, as on a person's page (the user, 29 Oct: light mode "looks blank").
  const strip: Array<[string, string, LucideIcon, string, string]> = [
    ['Claims', String(shown.length), ReceiptText, 'bg-sky-50 ring-sky-200', 'bg-sky-100 text-sky-700'],
    ['People', String(people.length), Users, 'bg-teal-50 ring-teal-200', 'bg-teal-100 text-teal-700'],
    ['Km', km(shown.reduce((t, c) => t + Number(c.km), 0)), Route, 'bg-violet-50 ring-violet-200', 'bg-violet-100 text-violet-700'],
    ['Amount', money(shown.reduce((t, c) => t + Number(c.total), 0)), IndianRupee, 'bg-amber-50 ring-amber-200', 'bg-amber-100 text-amber-700'],
  ]
  const Person = ({ p }: { p: typeof people[number] }) => (
    <Link to={`/approvals/person/${p.id}?tab=${tab}`} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 px-4 py-3 hover:bg-ink-100/60 sm:grid-cols-[2.25rem_minmax(0,1fr)_9rem_12rem_7rem_1rem]">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">{initialsOf(p.name)}</span>
      <div className="min-w-0">
        <p className="truncate font-medium text-ink-900">{p.name} <span className="text-xs text-ink-500">{p.ecode}</span></p>
        <p className="truncate text-xs text-ink-500">
          {p.n} {p.n === 1 ? 'claim' : 'claims'} · {p.months.join(', ')}{p.days > 0 ? ` · ${p.days} ${p.days === 1 ? 'day' : 'days'}` : ''}{p.places > 0 ? ` · ${p.places} ${p.places === 1 ? 'place' : 'places'}` : ''}<span className="sm:hidden">{p.cost ? ` · ${p.cost}` : ''}{p.km > 0 ? ` · ${km(p.km)}` : ''}</span>
          {p.red > 0 && <span className="ml-1.5 rounded-full bg-cyrixRed-100 px-1.5 py-0.5 font-semibold text-cyrixRed-700 sm:hidden">{p.red} out of policy</span>}
        </p>
      </div>
      <span className="hidden truncate text-sm text-ink-600 sm:block">{p.cost ?? '—'}</span>
      <span className="hidden items-center gap-1.5 whitespace-nowrap text-sm text-ink-600 sm:flex">{p.km > 0 ? km(p.km) : '—'}{p.red > 0 && <span className="whitespace-nowrap rounded-full bg-cyrixRed-100 px-1.5 py-0.5 text-xs font-semibold text-cyrixRed-700">{p.red} out of policy</span>}</span>
      <span className="text-right text-base font-semibold text-ink-900">{money(p.total)}</span>
      <ChevronRight className="h-4 w-4 justify-self-end text-ink-400" />
    </Link>
  )
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ClipboardCheck className="h-5 w-5 text-green-600" /> Approvals</h1>
      <div className="inline-flex rounded-xl bg-ink-100 p-1" role="tablist">
        {([['claims', 'Claims', (data ?? []).filter(c => c.waiting).length], ['advances', 'Advances', (advances ?? []).filter(a => a.waiting).length],
           ...((deputations ?? []).length ? [['deputation', 'Deputation', deputations!.filter(x => x.waiting).length] as const] : [])] as const).map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setParams(k === 'claims' ? {} : { view: k }, { replace: true })}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold sm:px-4 ${view === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>
            {l}{n > 0 && <span className="min-w-[1.25rem] rounded-full bg-cyrixRed-600 px-1.5 py-0.5 text-center text-xs font-bold text-white">{n}</span>}
          </button>
        ))}
      </div>
      {view === 'advances' ? <AdvanceApprovals /> : view === 'deputation' ? <DeputationApprovals /> : <>
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
      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
          {strip.map(([l, v, I, tile, dot]) => (
            <div key={l} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1 ${tile}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${dot}`}><I className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="text-xs font-medium text-ink-600">{l}</p><p className="truncate text-base font-semibold tabular-nums text-ink-900">{v}</p></div>
            </div>
          ))}
          <button type="button" className="btn-lift inline-flex items-center justify-center gap-2 rounded-lg border border-green-600/40 px-3 text-sm font-semibold text-green-700 hover:bg-green-50 col-span-2 h-10 sm:col-span-1 sm:h-auto" onClick={() => void exportApprovals({ file: `Travel approvals - ${TABS.find(([k]) => k === tab)?.[1]}`, heading: `Travel claims · ${TABS.find(([k]) => k === tab)?.[1]}`, rows: shown })}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          {approvable.length > 0 && (
            <button type="button" className="btn-primary btn-go col-span-2 sm:col-span-1 sm:h-auto" onClick={() => setApproving(true)}>
              <CheckCheck className="h-4 w-4" /> Approve all {approvable.length} · {money(approvable.reduce((t, c) => t + Number(c.total), 0))}
            </button>
          )}
        </div>
      )}
      {/* Approve all is inside each person now (ApprovalPerson). */}
      {people.length ? <div className="card divide-y divide-ink-100 overflow-hidden shadow-sm">{people.map(p => <Person key={p.id} p={p} />)}</div>
        : <div className="card p-6 text-center text-sm text-ink-500">{find.active ? find.empty : EMPTY[tab]}</div>}
      {approving && <ApproveAll list={approvable} onClose={() => setApproving(false)} />}
      </>}
    </div>
  )
}
