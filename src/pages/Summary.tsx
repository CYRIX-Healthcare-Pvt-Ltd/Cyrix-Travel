import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, CalendarDays, ChevronRight } from 'lucide-react'
import Budget, { budgetLines, monthLong } from '@/components/Budget'
import AddClaim from '@/components/AddClaim'
import Patterns from '@/components/Patterns'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'
import { Alert, PageLoader } from '@/components/ui'
import { km, money, todayIso, useSummary } from '@/lib/claims'

/*
  Summary (te_0026; the user, 18 Oct: "need a summary tab also"): calendar months only — This month,
  All time, or any two dates on a calendar (the user, 19 Oct: "need date filter also", "need calendar only,
  because I may want to search from 15th of some month"): the days travelled between them (te_0031).
  The person's own claims: what was claimed and where it stands, by kind, and the month's budget; then,
  for whoever approves, one row for each person they see. Add a claim at the top, as Revive Lab's
  dashboard has Raise ticket.
*/
// No Last month (the user, 19 Oct): Custom reaches any month.
const PERIODS = [['this', 'This month'], ['all', 'All time'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]

const firstOf = (back: number) => { const t = new Date(todayIso() + 'T00:00:00'); return new Date(t.getFullYear(), t.getMonth() - back, 1).toLocaleDateString('en-CA') }
/** "15 Aug 2026" */
const dayLong = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
/** As far back as the calendar goes: two years. */
const EARLIEST = firstOf(24)

function range(p: Period, custom: [string, string]): [string | null, string | null] {
  if (p === 'all') return [null, null]
  if (p === 'custom') return custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  return [firstOf(0), todayIso()]
}
const kept = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback } }
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* the choice is only a convenience */ } }

export default function Summary() {
  const [period, setPeriod] = useState<Period>(() => { const p = kept<string>('te.summary.period2', 'this'); return PERIODS.some(([k]) => k === p) ? (p as Period) : 'this' })
  const [custom, setCustom] = useState<[string, string]>(() => kept<[string, string]>('te.summary.dates', [firstOf(0), todayIso()]))
  // Which end of the range the calendar is choosing.
  const [choosing, setChoosing] = useState<0 | 1 | null>(null)
  const [from, to] = range(period, custom)
  const { data, isLoading, error } = useSummary(from, to)
  const pick = (p: Period) => { setPeriod(p); keep('te.summary.period2', p) }
  const setRange = (next: [string, string]) => { setCustom(next); keep('te.summary.dates', next) }
  const m = data?.mine
  const kinds = m ? [['Travel', m.travel], ['DA', m.da], ['Hotel', m.hotel], ['Other', m.other]] as const : []
  const kindMax = Math.max(1, ...kinds.map(k => k[1]))
  const where = !from ? 'all time' : period === 'this' ? monthLong(from) : from === to ? dayLong(from) : `${dayLong(from)} – ${dayLong(to!)}`
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><BarChart3 className="h-5 w-5 text-sky-600" /> Summary</h1>
        <AddClaim />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-ink-200 sm:w-auto">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => pick(k)}
              className={`h-10 px-2 text-sm font-semibold sm:px-4 ${period === k ? 'bg-ink-900 text-[color:rgb(var(--surface))]' : 'text-ink-700 hover:bg-ink-100'}`}>{l}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            {(['From', 'To'] as const).map((l, i) => (
              <button key={l} type="button" onClick={() => setChoosing(i as 0 | 1)}
                className="btn-lift flex h-10 items-center gap-2 rounded-lg border border-ink-200 px-3 text-left text-sm hover:bg-ink-100">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{l}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-900">{dayLong(custom[i])}</span>
                <CalendarDays className="h-4 w-4 shrink-0 text-ink-400" />
              </button>
            ))}
          </div>
        )}
        {choosing !== null && (
          <Dialog title={choosing === 0 ? 'From' : 'To'} icon={<CalendarDays className="h-5 w-5 text-sky-600" />} onClose={() => setChoosing(null)}>
            <div className="mt-3">
              <MonthCalendar value={custom[choosing]} min={choosing === 0 ? EARLIEST : custom[0]} max={choosing === 0 ? custom[1] : todayIso()}
                onChange={v => { setRange(choosing === 0 ? [v, custom[1]] : [custom[0], v]); setChoosing(null) }} />
            </div>
          </Dialog>
        )}
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
              {([['Paid', m.paid], ['Approved', m.approved], ['With approvers', m.pending], ['Sent back', m.sent_back]] as const).map(([l, v]) => (
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
          {period === 'this' && from && (
            <Budget title={`Left in ${monthLong(from)}`}
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

          {/* ---- patterns across the people this person sees (te_0049) ---- */}
          {data.team.length > 0 && <Patterns from={from} to={to} where={where} />}
        </>
      )}
    </div>
  )
}
