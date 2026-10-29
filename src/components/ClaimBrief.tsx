import { ArrowRight } from 'lucide-react'
import { LEVEL, OBS, claimObservations } from '@/pages/ClaimPage'
import { MODES, dayName, km, money, rideAmount, type ClaimData } from '@/lib/claims'

const short = (s: string | null) => (s ? s.split(',')[0] : '—')

/*
  A claim opened out in Approvals (the user, 29 Oct: the director found it "very blank and less information"): why it is
  to check, each with its day; then day by day where the person went, how, the km, the visits, the DA and the rest; then
  the visit photos. What the approver is approving, without pressing View.
*/
export default function ClaimBrief({ data }: { data: ClaimData }) {
  const found = claimObservations(data).filter(o => OBS[o.kind].level !== 'info')
    .sort((a, b) => (OBS[a.kind].level === 'approve' ? 0 : 1) - (OBS[b.kind].level === 'approve' ? 0 : 1))
  const groups = [...found.reduce((m, o) => m.set(o.kind, (m.get(o.kind) ?? 0) + 1), new Map<keyof typeof OBS, number>())]
  const days = [...data.days].sort((a, b) => a.day.localeCompare(b.day))

  return (
    <div className="space-y-3 border-t border-ink-100 bg-ink-50/60 px-4 py-3">
      {/* By reason and how many, never one line each (the user, 29 Oct: "consider if there are 100 employees"). */}
      {groups.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {groups.map(([t, n]) => {
            const o = OBS[t], I = o.icon
            return <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL[o.level].chip}`}><I className="h-3.5 w-3.5" />{o.title}{n > 1 ? ` × ${n}` : ''}</span>
          })}
        </p>
      )}

      {days.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-surface ring-1 ring-ink-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="whitespace-nowrap text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-3 py-2">Day</th><th className="w-full px-3 py-2">Where</th><th className="px-3 py-2 text-right">Km</th>
                <th className="px-3 py-2 text-right">Travel</th><th className="px-3 py-2 text-right">DA</th>
                <th className="px-3 py-2 text-right">Other</th><th className="px-3 py-2 text-right">Day total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {days.map(d => {
                const travel = d.rides.reduce((t, r) => t + rideAmount(r, data.rule), 0)
                const kms = d.rides.reduce((t, r) => t + Number(r.claimed_km ?? 0), 0)
                const other = d.expenses.reduce((t, x) => t + Number(x.amount), 0) + (d.hotel && !d.room_by ? Number(d.hotel.amount) : 0)
                const modes = [...new Set(d.rides.map(r => r.mode))]
                const stops = d.rides.length ? [short(d.rides[0].from_name), ...d.rides.map(r => short(r.to_name))] : []
                return (
                  <tr key={d.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">{dayName(d.day)}</td>
                    {/* Where it began and ended, the stops between on one line however many (the user, 29 Oct). */}
                    <td className="max-w-0 px-3 py-2" title={stops.join(' → ')}>
                      {stops.length ? (
                        <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink-900">
                          <span className="truncate">{stops[0]}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-400" /><span className="truncate">{stops[stops.length - 1]}</span>
                          {d.rides.length > 1 && <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">{d.rides.length} rides</span>}
                        </span>
                      ) : <span className="text-ink-500">{d.place ?? 'No rides'}</span>}
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {[modes.map(m => MODES[m].label).join(', '), d.purpose, stops.length > 2 ? `via ${stops.slice(1, -1).join(', ')}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-700">{kms > 0 ? km(kms) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-700">{travel > 0 ? money(travel) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-700">{Number(d.da_amount) > 0 ? money(d.da_amount) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-700">{other > 0 ? money(other) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-900">{money(travel + Number(d.da_amount) + other)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
