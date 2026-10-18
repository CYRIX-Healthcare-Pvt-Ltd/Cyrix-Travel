import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ChevronRight } from 'lucide-react'
import Budget, { budgetLines, monthLong } from '@/components/Budget'
import { Alert, PageLoader } from '@/components/ui'
import { km, money, todayIso, useSummary } from '@/lib/claims'

/*
  Summary (te_0026; the user, 18 Oct: "need a summary tab also"): calendar months only — This month,
  Last month, All time. The person's own claims: what was claimed and where it stands, by kind, and
  the month's budget; then, for whoever approves, one row for each person they see.
*/
const PERIODS = [['this', 'This month'], ['last', 'Last month'], ['all', 'All time']] as const
type Period = typeof PERIODS[number][0]

function range(p: Period): [string | null, string | null] {
  if (p === 'all') return [null, null]
  const t = new Date(todayIso() + 'T00:00:00')
  const m = new Date(t.getFullYear(), t.getMonth() - (p === 'last' ? 1 : 0), 1).toLocaleDateString('en-CA')
  return [m, m]
}

export default function Summary() {
  const [period, setPeriod] = useState<Period>(() => { try { return (localStorage.getItem('te.summary.period') as Period) || 'this' } catch { return 'this' } })
  const [from, to] = range(period)
  const { data, isLoading, error } = useSummary(from, to)
  const pick = (p: Period) => { setPeriod(p); try { localStorage.setItem('te.summary.period', p) } catch { /* the choice is only a convenience */ } }
  const m = data?.mine
  const kinds = m ? [['Travel', m.travel], ['DA', m.da], ['Hotel', m.hotel], ['Other', m.other]] as const : []
  const kindMax = Math.max(1, ...kinds.map(k => k[1]))
  const where = from ? monthLong(from) : 'all months'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><BarChart3 className="h-5 w-5 text-sky-600" /> Summary</h1>
        <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-ink-200 sm:w-auto">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => pick(k)}
              className={`h-10 px-4 text-sm font-semibold ${period === k ? 'bg-ink-900 text-[color:rgb(var(--surface))]' : 'text-ink-700 hover:bg-ink-100'}`}>{l}</button>
          ))}
        </div>
      </div>
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      {isLoading || !data || !m ? <PageLoader /> : (
        <>
          {/* ---- mine ---- */}
          <div className="card space-y-5 p-4">
            <div>
              <p className="text-sm text-ink-500">Claimed in {where}</p>
              <p className="text-5xl font-semibold text-ink-900">{money(m.claimed)}</p>
              <p className="mt-1 text-sm text-ink-500">{[`${m.days} day${m.days === 1 ? '' : 's'}`, km(m.km), `${m.tickets} ticket${m.tickets === 1 ? '' : 's'}`].join(' · ')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([['Paid', m.paid], ['Approved', m.approved], ['With approvers', m.pending], ['Not sent', m.not_sent]] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl border border-ink-200 p-3">
                  <p className="text-xs text-ink-500">{l}</p>
                  <p className="mt-0.5 text-lg font-semibold text-ink-900">{money(v)}</p>
                </div>
              ))}
            </div>
            {m.claimed > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">By kind</p>
                <div className="space-y-2">
                  {kinds.map(([l, v]) => (
                    <div key={l} className="grid grid-cols-[4.5rem_1fr_5rem] items-center gap-3 text-sm" title={`${l} ${money(v)} · ${Math.round((v / m.claimed) * 100)}% of the claimed`}>
                      <span className="text-ink-700">{l}</span>
                      <span className="h-3 rounded-r" style={{ width: `${(v / kindMax) * 100}%`, minWidth: v > 0 ? 4 : 0 }}>
                        <span className="block h-full rounded-r bg-teal-600" />
                      </span>
                      <span className="text-right font-medium tabular-nums text-ink-900">{money(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- the month's budget ---- */}
          {from && (
            <Budget title={`${period === 'this' ? 'Left' : 'Budget'} in ${monthLong(from)}`}
              lines={budgetLines(
                { bike_rate: data.limits.bike_km ? 1 : null, bike_km_month: data.limits.bike_km, car_rate: data.limits.car_km ? 1 : null, car_km_month: data.limits.car_km },
                { auto_month: data.limits.auto, phone_month: data.limits.phone },
                { bike: m.bike_km, car: m.car_km, auto: m.auto, phone: m.phone })} />
          )}

          {/* ---- the people this person approves for ---- */}
          {data.team.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">{data.scope === 'all' ? 'Everyone' : 'Your team'} · {where}</h2>
              <div className="card overflow-hidden">
                <div className="hidden grid-cols-[1fr_3.5rem_6rem_7rem_6rem_1.25rem] gap-3 border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 sm:grid">
                  <span>Person</span><span className="text-right">Claims</span><span className="text-right">Claimed</span><span className="text-right">With approvers</span><span className="text-right">Paid</span><span />
                </div>
                {data.team.map(p => (
                  <Link key={p.ecode} to="/approvals" className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-3 last:border-0 hover:bg-ink-100/60 sm:grid-cols-[1fr_3.5rem_6rem_7rem_6rem_1.25rem]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">{p.name} <span className="text-xs font-normal text-ink-500">{p.ecode}</span></span>
                      {p.waiting > 0 && <span className="text-xs font-semibold text-amber-800">{p.waiting} waiting on you</span>}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-ink-900 sm:hidden">{money(p.claimed)}</span>
                    <span className="col-span-2 text-xs text-ink-500 sm:hidden">{p.claims} claim{p.claims === 1 ? '' : 's'} · with approvers {money(p.pending)} · paid {money(p.paid)}</span>
                    <span className="hidden text-right tabular-nums text-ink-700 sm:block">{p.claims}</span>
                    <span className="hidden text-right font-semibold tabular-nums text-ink-900 sm:block">{money(p.claimed)}</span>
                    <span className="hidden text-right tabular-nums text-ink-700 sm:block">{money(p.pending)}</span>
                    <span className="hidden text-right tabular-nums text-ink-700 sm:block">{money(p.paid)}</span>
                    <ChevronRight className="hidden h-4 w-4 text-ink-400 sm:block" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
