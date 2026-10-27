import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCheck, ReceiptText, Route, ShieldAlert, TriangleAlert } from 'lucide-react'
import ApproveAll from '@/components/ApproveAll'
import { initialsOf } from '@/components/Avatar'
import { useAsk } from '@/components/Ask'
import { PageLoader } from '@/components/ui'
import { STATUS, claimName, km, money, useInbox } from '@/lib/claims'
import { TABS, useWaitingIssues } from '@/pages/Inbox'

/*
  One person's claims in Approvals (te_0080; the user, 27 Oct: "on click it should go the tab, instead of expanding
  down"): who and the cost centre, a short summary, each claim with its number, km, where it started and ended and its
  amount, View for the claim itself, and Approve all for this person's claims waiting on whoever looks.
*/
export default function ApprovalPerson() {
  const { id } = useParams()
  const ask = useAsk()
  const { data, isLoading } = useInbox()
  // The tab the person was opened from in Approvals.
  const asked = useSearchParams()[0].get('tab')
  const tab = TABS.find(([k]) => k === asked)?.[0] ?? 'waiting'
  const [approving, setApproving] = useState(false)
  const all = (data ?? []).filter(c => c.employee_id === id)
  const list = all.filter(c => (tab === 'waiting' ? c.waiting : tab === 'pending' ? !c.waiting && c.status !== 'paid' : !c.waiting && c.status === 'paid'))
  const issues = useWaitingIssues(list.filter(c => c.waiting).map(c => c.id))
  if (isLoading) return <PageLoader />
  const who = all[0]
  const sum = (k: 'total' | 'km' | 'travel' | 'da' | 'hotel' | 'other') => list.reduce((t, c) => t + Number(c[k] ?? 0), 0)
  const red = list.filter(c => issues[c.id]?.some(i => i.level === 'approve')).length
  // Every claim waiting on this person, at whichever step: manager, coordinator or Travel Desk (the user, 27 Oct: "whr is approval all?").
  const managerOnes = list.filter(c => c.waiting && ['with_manager', 'with_coordinator', 'with_desk'].includes(c.status))
  const tabName = TABS.find(([k]) => k === tab)?.[1] ?? ''
  /*
    The summary as coloured tiles, each with its picture (the user, 27 Oct: "show total km also beautifully", "looks
    very plain"); hotel after the other expenses, as in the day.
  */
  // Km, then the claim with what it is made of, small inside it (the user, 27 Oct: "add km then claim ie travel + da inside as small").
  const parts = [
    { label: 'Travel', v: sum('travel'), dot: 'bg-sky-500' }, { label: 'DA', v: sum('da'), dot: 'bg-emerald-500' },
    { label: 'Other', v: sum('other'), dot: 'bg-amber-500' }, { label: 'Hotel', v: sum('hotel'), dot: 'bg-violet-500' },
  ].filter(p => p.v > 0)
  const tiles = [
    { label: 'Km', value: km(sum('km')), show: sum('km') > 0, icon: Route, tone: 'ink', wide: false },
    { label: 'Claim', value: money(sum('total')), show: true, icon: ReceiptText, tone: 'sky', wide: false },
    { label: 'Out of policy', value: `${red} ${red === 1 ? 'claim' : 'claims'}`, show: red > 0, icon: ShieldAlert, tone: 'cyrixRed', wide: true },
  ].filter(t => t.show)
  // Written out whole, so Tailwind keeps them.
  const TONE: Record<string, { tile: string; dot: string; ink: string }> = {
    // Km in grey, apart from the rupees (teal beside the DA's green read as one).
    ink: { tile: 'bg-ink-50 ring-ink-200', dot: 'bg-ink-100 text-ink-700', ink: 'text-ink-700' },
    sky: { tile: 'bg-sky-50 ring-sky-200', dot: 'bg-sky-100 text-sky-700', ink: 'text-sky-800' },
    cyrixRed: { tile: 'bg-cyrixRed-50 ring-cyrixRed-200', dot: 'bg-cyrixRed-100 text-cyrixRed-700', ink: 'text-cyrixRed-800' },
  }

  return (
    <div className="space-y-4">
      <Link to="/approvals" state={{ tab }} className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Approvals</Link>
      {!who ? <div className="card p-6 text-center text-sm text-ink-500">Nothing here now.</div> : <>
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-100 text-sm font-semibold text-teal-800">{initialsOf(who.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink-900">{who.name} <span className="text-xs font-normal text-ink-500">{who.ecode}</span></p>
            <p className="truncate text-xs text-ink-500">{who.cost_centre ?? 'No cost centre'} · {list.length} {list.length === 1 ? 'claim' : 'claims'} {tabName.toLowerCase()}</p>
          </div>
          <span className="text-right text-lg font-semibold text-ink-900">{money(sum('total'))}</span>
          {/* At the top, not under a hundred claims (the user, 27 Oct: "why approve all down? what if 100 entries?"). */}
          {managerOnes.length > 0 && (
            <button type="button" className="btn-primary btn-go w-full sm:w-auto" onClick={() => setApproving(true)}>
              <CheckCheck className="h-4 w-4" /> Approve all {managerOnes.length} · {money(managerOnes.reduce((t, c) => t + Number(c.total), 0))}
            </button>
          )}
        </div>

        {/* Very brief: what it is spent on, and how many claims are out of policy (the user: "need good summary very brief"). */}
        {list.length > 0 && (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {tiles.map(t => {
              const I = t.icon, c = TONE[t.tone]
              return (
                <div key={t.label} className={`flex items-center gap-2.5 rounded-xl p-3 ring-1 ${c.tile} ${t.wide ? 'col-span-2 lg:col-span-1' : ''}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${c.dot}`}><I className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className={`truncate text-xs font-medium ${c.ink}`}>{t.label}</p>
                    <p className="truncate text-base font-semibold tabular-nums text-ink-900">{t.value}</p>
                    {t.label === 'Claim' && parts.length > 0 && (
                      <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-ink-600">
                        {parts.map(p => <span key={p.label} className="inline-flex items-center gap-1 whitespace-nowrap"><span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />{p.label} {money(p.v)}</span>)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {list.length === 0 ? <div className="card p-6 text-center text-sm text-ink-500">Nothing {tabName.toLowerCase()} for {who.name.split(' ')[0]}.</div> : (
          <div className="card divide-y divide-ink-100 overflow-hidden">
            {list.map(c => {
              const s = STATUS[c.status] ?? STATUS.draft
              const found = issues[c.id] ?? [], bad = found.some(i => i.level === 'approve'), I = bad ? ShieldAlert : TriangleAlert
              return (
                <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[7rem_5rem_minmax(0,1fr)_6rem_auto]">
                  <p className="min-w-0 truncate text-sm"><b className="font-semibold text-ink-900">{c.number}</b> <span className="text-xs text-ink-500">{claimName(c.month, c.part)}</span></p>
                  <span className="text-right text-sm font-semibold text-ink-900 sm:order-4">{money(c.total)}</span>
                  <span className="text-xs text-ink-600 sm:order-2 sm:text-sm">{c.km > 0 ? km(c.km) : '—'}</span>
                  {/* Where it started and where it ended, the place before home when it ended there. */}
                  <span className="col-span-2 flex min-w-0 items-center gap-1 text-xs text-ink-700 sm:order-3 sm:col-span-1 sm:text-sm">
                    {c.route_from || c.route_to ? <><span className="truncate">{c.route_from ?? '—'}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-400" /><span className="truncate">{c.route_to ?? '—'}</span></> : <span className="text-ink-400">No rides</span>}
                  </span>
                  <span className="col-span-2 flex items-center justify-end gap-1.5 sm:order-5 sm:col-span-1">
                    {tab !== 'waiting' && <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>}
                    {c.waiting && found.length > 0 && (
                      <button type="button" title={found.map(i => i.title).join(', ')} onClick={() => void ask.alert(`${c.number ?? ''} · ${bad ? 'Out of policy' : 'To check'}`, found.map(i => i.title).join('\n'), bad ? 'warn' : 'info')}
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${bad ? 'bg-cyrixRed-100 text-cyrixRed-700' : 'bg-ink-100 text-ink-700 ring-1 ring-ink-200'}`}>
                        <I className={`h-3.5 w-3.5 ${bad ? '' : 'text-amber-600'}`} />{bad ? 'Out of policy' : 'To check'}
                      </button>
                    )}
                    <Link to={`/claim/${c.id}`} className="btn-secondary !px-3 !py-1.5 text-xs">View</Link>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {approving && <ApproveAll list={managerOnes} onClose={() => setApproving(false)} />}
      </>}
    </div>
  )
}
