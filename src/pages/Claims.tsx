import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ClipboardCheck, Inbox, ReceiptText, TriangleAlert } from 'lucide-react'
import { EmptyState, PageLoader, StatTile } from '@/components/ui'
import { km, rupees, statusLook, useTrips, type TripRow } from '@/lib/travel'
import { TONE_CLASS } from '@/lib/tones'
import { dayDate } from '@/lib/when'

type Period = 'month' | 'last_month' | 'all'
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'month', label: 'This month' }, { id: 'last_month', label: 'Last month' }, { id: 'all', label: 'All time' },
]
function inPeriod(iso: string, p: Period): boolean {
  if (p === 'all') return true
  const d = new Date(iso), now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - (p === 'last_month' ? 1 : 0), 1)
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1)
  return d >= first && d < next
}

/**
 * Claims in a list: one's own, or — for a manager — their people's, with
 * what waits for a decision first. Periods are calendar months.
 */
export default function Claims({ team = false }: { team?: boolean }) {
  const { data: trips, isLoading } = useTrips()
  const [period, setPeriod] = useState<Period>('month')
  const rows = useMemo(() => {
    const list = (trips ?? []).filter(t => (team ? !t.mine : t.mine) && inPeriod(t.started_at, period))
    // What waits on a manager's decision comes first; then newest.
    return team ? [...list].sort((a, b) => Number(b.status === 'submitted') - Number(a.status === 'submitted')) : list
  }, [trips, team, period])

  if (isLoading) return <PageLoader />
  const approved = rows.filter(t => t.status === 'approved')
  const waiting = rows.filter(t => t.status === 'submitted')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{team ? 'Approvals' : 'My claims'}</h1>
          <p className="mt-0.5 text-sm text-ink-500">{team ? 'Your people’s trips. Open one to see its legs, stops and photographs.' : 'Every trip you have made, and where its claim stands.'}</p>
        </div>
        <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5" role="group" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}
              className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', period === p.id ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Trips" value={rows.length} />
        <StatTile label={team ? 'Waiting on you' : 'With manager'} value={waiting.length} tone={team && waiting.length ? 'brand' : 'default'} />
        <StatTile label="Approved" value={rupees(approved.reduce((a, t) => a + t.total_amount, 0))} sub={`${approved.length} claim${approved.length === 1 ? '' : 's'}`} />
        <StatTile label="Distance" value={km(rows.reduce((a, t) => a + t.total_km, 0))} sub="all modes" />
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Inbox} title={team ? 'No claims from your people here' : 'No trips here'}>
              {team ? 'When somebody under you submits a trip, it shows here for your decision.' : 'Start a trip from the Trip tab; it shows here once it has begun.'}
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map(t => <Row key={t.id} t={t} team={team} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ t, team }: { t: TripRow; team: boolean }) {
  const look = statusLook(t)
  return (
    <li>
      {/* Two lines on a phone — the claim and what it comes to, then whose and when — and one on a computer. */}
      <Link to={`/claims/${t.id}`} state={{ back: team ? '/approvals' : '/claims' }} className="block px-4 py-3 hover:bg-ink-50 sm:flex sm:items-center sm:gap-3">
        <span className="flex items-center gap-2.5 sm:w-28 sm:shrink-0">
          {team ? <ClipboardCheck className="h-4 w-4 shrink-0 text-ink-300" /> : <ReceiptText className="h-4 w-4 shrink-0 text-ink-300" />}
          <span className="font-mono text-sm font-semibold text-ink-900">{t.code}</span>
          {/* On a phone the status and the amount sit on the first line, at its end. */}
          <span className="ml-auto flex items-center gap-2 sm:hidden">
            <span className={clsx('badge', TONE_CLASS[look.tone])}>{look.label}</span>
            <span className="text-sm font-semibold tabular-nums text-ink-900">{rupees(t.total_amount)}</span>
          </span>
        </span>
        <span className="mt-1 block min-w-0 flex-1 text-sm text-ink-600 sm:mt-0 sm:truncate">
          {team && <>{t.employee_name} <span className="text-ink-400">{t.employee_ecode}</span> · </>}
          {dayDate(t.started_at)} · {t.stops} stop{t.stops === 1 ? '' : 's'} · {km(t.total_km)}
        </span>
        {t.flags > 0 && (
          <span className="badge mt-1.5 bg-cyrixRed-100 text-cyrixRed-900 sm:mt-0"><TriangleAlert className="mr-1 h-3.5 w-3.5" /> {t.flags} to check</span>
        )}
        <span className={clsx('badge hidden sm:inline-flex', TONE_CLASS[look.tone])}>{look.label}</span>
        <span className="hidden w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-900 sm:block">{rupees(t.total_amount)}</span>
      </Link>
    </li>
  )
}
