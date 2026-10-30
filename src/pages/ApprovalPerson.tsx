import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, CheckCheck, MapPin, Target, FileSpreadsheet, History, ReceiptText, Route, ShieldAlert, TriangleAlert, Wallet } from 'lucide-react'
import ApproveAll from '@/components/ApproveAll'
import { exportApprovals } from '@/lib/exportApprovals'
import { initialsOf } from '@/components/Avatar'
import { useAsk } from '@/components/Ask'
import { PageLoader } from '@/components/ui'
import { STATUS, claimName, dayRange, km, money, rideAmount, useClaimAction, useInbox } from '@/lib/claims'
import { TABS, useClaimsData } from '@/pages/Inbox'
import { claimIssues } from '@/pages/ClaimPage'

/*
  One person's claims in Approvals (te_0080; the user, 27 Oct: "on click it should go the tab, instead of expanding
  down"): who and the cost centre, a short summary, each claim with its number, km, where it started and ended and its
  amount, View for the claim itself, and Approve all for this person's claims waiting on whoever looks.
*/
export default function ApprovalPerson() {
  const { id } = useParams()
  const ask = useAsk()
  const go = useNavigate()
  const { data, isLoading } = useInbox()
  // The tab the person was opened from in Approvals.
  const asked = useSearchParams()[0].get('tab')
  const tab = TABS.find(([k]) => k === asked)?.[0] ?? 'waiting'
  const [approving, setApproving] = useState(false)
  const act = useClaimAction()
  const [fail, setFail] = useState<string | null>(null)
  const failRef = useRef<HTMLParagraphElement>(null)
  const all = (data ?? []).filter(c => c.employee_id === id)
  const list = all.filter(c => (tab === 'waiting' ? c.waiting : tab === 'pending' ? !c.waiting && c.status !== 'paid' : !c.waiting && c.status === 'paid'))
  // Each claim whole, opened out under its row (the user, 29 Oct: the director found it "very blank").
  const full = useClaimsData(list.map(c => c.id))
  const issues = Object.fromEntries(list.filter(c => c.waiting && full[c.id]).map(c => [c.id, claimIssues(full[c.id]!)]))
  if (isLoading) return <PageLoader />
  const who = all[0]
  const sum = (k: 'total' | 'km' | 'travel' | 'da' | 'hotel' | 'other') => list.reduce((t, c) => t + Number(c[k] ?? 0), 0)
  const red = list.filter(c => issues[c.id]?.some(i => i.level === 'approve')).length
  // Every claim waiting on this person, at whichever step: manager, coordinator or Travel Desk (the user, 27 Oct: "whr is approval all?").
  const managerOnes = list.filter(c => c.waiting && !c.asks && ['with_manager', 'with_coordinator', 'with_desk'].includes(c.status))
  const tabName = TABS.find(([k]) => k === tab)?.[1] ?? ''
  // Each claim on its own: asks first (claim · person · amount, and what is out of policy), then approves (the user, 26 Oct: decisions ask first).
  const approveOne = async (c: typeof list[number], why: string[]) => {
    setFail(null)
    const what = c.number ?? claimName(c.month, c.part)
    if (!(await ask.confirm({ title: `Approve ${what}?`, body: [`${c.name} · ${money(c.total)}`, ...why].join('\n'), yes: 'Approve', icon: Check, go: true }))) return
    try {
      await act.mutateAsync({ fn: 'te_decide', args: { p_claim: c.id, p_approve: true, p_note: '' } })
      await ask.alert('Claim approved', `${what} · ${c.name} approved.`, 'success')
    } catch (e) { setFail((e as Error).message); window.setTimeout(() => failRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50) }
  }
  // By purpose: days and rupees, from each day's purpose; and the places most gone to, home and office aside.
  const short = (x: string | null) => (x ? x.split(',')[0].trim() : '')
  const byPurpose = new Map<string, { days: number; amount: number }>(), visits = new Map<string, number>()
  for (const c of list) {
    const d = full[c.id]; if (!d) continue
    for (const x of d.days) {
      const k = x.purpose || 'Not given'
      const amt = x.rides.reduce((t, r) => t + rideAmount(r, d.rule), 0) + Number(x.da_amount) + x.expenses.reduce((t, e) => t + Number(e.amount), 0) + (x.hotel && !x.room_by ? Number(x.hotel.amount) : 0)
      const v = byPurpose.get(k) ?? { days: 0, amount: 0 }; byPurpose.set(k, { days: v.days + 1, amount: v.amount + amt })
      for (const r of x.rides) { const to = short(r.to_name); if (to && !/^home$/i.test(to) && !/^cyrix/i.test(to)) visits.set(to, (visits.get(to) ?? 0) + 1) }
    }
  }
  const purposes = [...byPurpose].sort((a, b) => b[1].amount - a[1].amount)
  const topPlaces = [...visits].sort((a, b) => b[1] - a[1]).slice(0, 3)
  /*
    The summary as coloured tiles, each with its picture (the user, 27 Oct: "show total km also beautifully", "looks
    very plain"); hotel after the other expenses, as in the day.
  */
  // Km, then the claim with what it is made of, small inside it (the user, 27 Oct: "add km then claim ie travel + da inside as small").
  const parts = [
    { label: 'Travel', v: sum('travel'), dot: 'bg-sky-500' }, { label: 'DA', v: sum('da'), dot: 'bg-emerald-500' },
    { label: 'Other', v: sum('other'), dot: 'bg-amber-500' }, { label: 'Room stay', v: sum('hotel'), dot: 'bg-violet-500' },
  ].filter(p => p.v > 0)
  // This person's claims before these, as far as Approvals has them: the last three.
  const firstMonth = list.reduce((m, c) => (c.month < m ? c.month : m), list[0]?.month ?? '')
  const earlier = all.filter(c => !list.includes(c) && c.month < firstMonth).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3)
  const avg = earlier.length ? earlier.reduce((t, c) => t + Number(c.total), 0) / earlier.length : 0
  const per = list.length ? sum('total') / list.length : 0
  const change = avg > 0 ? `This claim ${per >= avg ? '+' : '−'}${Math.round(Math.abs(per - avg) / avg * 100)}%` : undefined
  // What the person was given in advance and no claim has taken yet (te_0063).
  const box = list.map(c => full[c.id]?.claim.advance_box).find(Boolean)
  const open = box ? Math.max(0, Number(box.given) - Number(box.before) - list.reduce((t, c) => t + Number(full[c.id]?.claim.advance ?? 0), 0)) : 0
  const tiles: Array<{ label: string; value: string; sub?: string; show: boolean; icon: typeof Route; tone: string; wide: boolean }> = [
    { label: 'Km', value: km(sum('km')), show: sum('km') > 0, icon: Route, tone: 'ink', wide: false },
    { label: 'Claim', value: money(sum('total')), show: true, icon: ReceiptText, tone: 'sky', wide: false },
    { label: earlier.length === 1 ? 'Last claim' : `Last ${earlier.length} claims, average`, value: money(avg), sub: change, show: earlier.length > 0, icon: History, tone: 'ink', wide: false },
    { label: 'Advance not settled', value: money(open), show: open > 0, icon: Wallet, tone: 'amber', wide: false },
    { label: 'Out of policy', value: `${red} ${red === 1 ? 'claim' : 'claims'}`, show: red > 0, icon: ShieldAlert, tone: 'cyrixRed', wide: true },
  ].filter(t => t.show)
  // Written out whole, so Tailwind keeps them.
  const TONE: Record<string, { tile: string; dot: string; ink: string }> = {
    // Km in grey, apart from the rupees (teal beside the DA's green read as one).
    ink: { tile: 'bg-ink-50 ring-ink-200', dot: 'bg-ink-100 text-ink-700', ink: 'text-ink-700' },
    sky: { tile: 'bg-sky-50 ring-sky-200', dot: 'bg-sky-100 text-sky-700', ink: 'text-sky-800' },
    amber: { tile: 'bg-amber-50 ring-amber-200', dot: 'bg-amber-100 text-amber-700', ink: 'text-amber-800' },
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
          <button type="button" className="btn-lift inline-flex items-center justify-center gap-2 rounded-lg border border-green-600/40 px-3 text-sm font-semibold text-green-700 hover:bg-green-50 h-10 w-full sm:w-auto" disabled={!list.length}
            onClick={() => void exportApprovals({ file: `${who.ecode} ${who.name} - Travel claims ${tabName}`, heading: `${who.name} (${who.ecode}) · Travel claims · ${tabName}`, rows: list, full })}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          {/* At the top, not under a hundred claims (the user, 27 Oct: "why approve all down? what if 100 entries?"). */}
          {managerOnes.length > 0 && (
            <button type="button" className="btn-primary btn-go w-full sm:w-auto" onClick={() => setApproving(true)}>
              <CheckCheck className="h-4 w-4" /> Approve all {managerOnes.length} · {money(managerOnes.reduce((t, c) => t + Number(c.total), 0))}
            </button>
          )}
          {/* The summary in the same card, small, so the claims start high on the page (the user, 30 Oct: "compact this and move summary up"). */}
          {list.length > 0 && (
            <div className="grid w-full gap-x-6 gap-y-3 border-t border-ink-100 pt-3 lg:grid-cols-[1.2fr_1fr_1fr]">
              <div className="grid grid-cols-2 gap-1.5">
                {tiles.map(t => {
                  const I = t.icon, c = TONE[t.tone]
                  return (
                    <div key={t.label} className={`min-w-0 rounded-lg px-2.5 py-1.5 ring-1 ${c.tile}`}>
                      <div className="min-w-0">
                        <p className={`flex items-center gap-1 truncate text-[11px] font-medium ${c.ink}`}><I className="h-3.5 w-3.5 shrink-0" />{t.label}</p>
                        <p className="truncate text-sm font-semibold tabular-nums text-ink-900">{t.value}{t.sub && <span className="ml-1 text-[11px] font-normal text-ink-500">{t.sub}</span>}</p>
                        {t.label === 'Claim' && parts.length > 0 && (
                          <p className="flex flex-wrap gap-x-2 text-[11px] text-ink-600">
                            {parts.map(p => <span key={p.label} className="inline-flex items-center gap-1 whitespace-nowrap"><span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />{p.label} {money(p.v)}</span>)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Each purpose and place a small chip, its figures beside its name (the user, 30 Oct: "why day 1 far away?"; the grid "looks bad"). */}
              {purposes.length > 0 && (
                <div className="min-w-0">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500"><Target className="h-3.5 w-3.5 text-violet-600" /> By purpose</p>
                  <div className="flex flex-wrap gap-1.5">
                    {purposes.slice(0, 4).map(([name, v]) => (
                      <span key={name} className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 text-sm ring-1 ring-violet-200/70">
                        <span className="truncate font-medium text-ink-900">{name}</span>
                        <span className="shrink-0 text-xs text-ink-500">{v.days} {v.days === 1 ? 'day' : 'days'}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-violet-800">{money(v.amount)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {topPlaces.length > 0 && (
                <div className="min-w-0">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500"><MapPin className="h-3.5 w-3.5 text-cyrixRed-600" /> Most visited</p>
                  <div className="flex flex-wrap gap-1.5">
                    {topPlaces.map(([name, n], i) => (
                      <span key={name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-rose-50 py-1 pl-1 pr-2.5 text-sm ring-1 ring-rose-200/70">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-rose-100 text-[11px] font-bold text-rose-700">{i + 1}</span>
                        <span className="truncate font-medium text-ink-900">{name}</span>
                        <span className="shrink-0 text-xs text-ink-500">{n} {n === 1 ? 'visit' : 'visits'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* One line a claim, as in the Excel, with its own Approve at the end (the user, 29 Oct). */}
        {list.length === 0 ? <div className="card p-6 text-center text-sm text-ink-500">Nothing {tabName.toLowerCase()} for {who.name.split(' ')[0]}.</div> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-ink-100 bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  <th className="px-3 py-2">Claim</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2 text-right">Km</th>
                  <th className="px-3 py-2 text-right">Travel</th><th className="px-3 py-2 text-right">DA</th><th className="px-3 py-2 text-right">Other</th>
                  <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2" /><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {list.map(c => {
                  const s = STATUS[c.status] ?? STATUS.draft
                  const found = issues[c.id] ?? [], bad = found.some(i => i.level === 'approve'), I = bad ? ShieldAlert : TriangleAlert
                  const mine = c.waiting && !c.asks && ['with_manager', 'with_coordinator', 'with_desk'].includes(c.status)
                  const other = Number(c.other ?? 0) + Number(c.hotel ?? 0)
                  return (
                    <tr key={c.id} role="link" tabIndex={0} className="cursor-pointer whitespace-nowrap transition-colors hover:bg-ink-50"
                      onClick={() => go(`/claim/${c.id}`)} onKeyDown={e => { if (e.key === 'Enter') go(`/claim/${c.id}`) }}>
                      <td className="px-3 py-2.5"><b className="font-semibold text-ink-900">{c.number}</b> <span className="text-xs text-ink-500">{claimName(c.month, c.part)}</span></td>
                      <td className="px-3 py-2.5 text-ink-700">{dayRange(c.first_day, c.last_day)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{c.km > 0 ? km(c.km) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{Number(c.travel) > 0 ? money(c.travel) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{Number(c.da) > 0 ? money(c.da) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{other > 0 ? money(other) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink-900">{money(c.total)}</td>
                      <td className="px-3 py-2.5">
                        {tab !== 'waiting' ? <span className={`badge ${s.tone}`}>{s.label}</span> : found.length > 0 && (
                          <button type="button" title={found.map(i => i.title).join(', ')} onClick={e => { e.stopPropagation(); void ask.alert(`${c.number ?? ''} · ${bad ? 'Out of policy' : 'To check'}`, found.map(i => i.title).join('\n'), bad ? 'warn' : 'info') }}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bad ? 'bg-cyrixRed-100 text-cyrixRed-700' : 'bg-ink-100 text-ink-700 ring-1 ring-ink-200'}`}>
                            <I className={`h-3.5 w-3.5 ${bad ? '' : 'text-amber-600'}`} />{found.length}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {c.asks && <span className="badge bg-orange-100 text-orange-900">{c.asks === 'edit' ? 'Asks to edit' : 'Asks to delete'}</span>}
                        {mine && (
                          <button type="button" className="btn-primary btn-go !px-3 !py-1.5 text-xs" disabled={act.isPending} onClick={e => { e.stopPropagation(); void approveOne(c, found.map(i => i.title)) }}>
                            <Check className="h-3.5 w-3.5" /> Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {fail && <p ref={failRef} className="rounded-lg bg-cyrixRed-50 px-3 py-2 text-sm text-cyrixRed-700 ring-1 ring-cyrixRed-200">{fail}</p>}

        {approving && <ApproveAll list={managerOnes} onClose={() => setApproving(false)} />}
      </>}
    </div>
  )
}
