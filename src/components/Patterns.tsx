import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronDown } from 'lucide-react'
import { money, rpc } from '@/lib/claims'

/*
  Patterns (te_0049, te_0050; the user, 21 Oct: "this app is for monitoring engineers' expenses … patterns
  over months is very useful", "auto fare also, it can be compared"). One row a person over the days chosen;
  each figure set against the average of the people shown — half as much again amber, twice red — and the
  most unusual first. A colour is a reason to look, not a finding.
*/
interface Row {
  ecode: string; name: string; function: string | null; days: number; claimed: number; tickets: number
  km: number; km_claimed: number | null; km_map: number | null; rides_over: number
  auto_fare: number | null; auto_km: number | null; auto_rides: number; out_days: number; cut: number
}
type Tone = 'red' | 'amber' | null
const TONE = { red: 'bg-cyrixRed-100 font-semibold text-cyrixRed-800', amber: 'bg-amber-100 font-semibold text-amber-900' } as const

// The average of the people shown (the user, 29 Oct: "you mean average? then change to average").
const average = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null }
const byAverage = (x: number | null, mid: number | null): Tone => (x == null || !mid || mid <= 0 ? null : x >= mid * 2 ? 'red' : x >= mid * 1.5 ? 'amber' : null)

export default function Patterns({ from, to, where }: { from: string | null; to: string | null; where: string }) {
  // Closed on the average, a press opens everyone (the user, 29 Oct: "what if 100 persons ... make them expandable").
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: ['te_patterns', from, to], queryFn: () => rpc<Row[]>('te_patterns', { p_from: from, p_to: to }) })
  if (!data?.length) return null
  const rows = data.map(r => ({
    r,
    perDay: r.days ? r.claimed / r.days : null,
    perTicket: r.tickets ? r.claimed / r.tickets : null,
    kmDay: r.days ? r.km / r.days : null,
    over: r.km_map && r.km_claimed != null ? ((r.km_claimed - r.km_map) / r.km_map) * 100 : null,
    autoKm: r.auto_km && r.auto_fare ? r.auto_fare / r.auto_km : null,
    out: r.days ? (r.out_days / r.days) * 100 : null,
    cutPct: r.claimed + r.cut > 0 ? (r.cut / (r.claimed + r.cut)) * 100 : 0,
  }))
  const mid = {
    perDay: average(rows.map(x => x.perDay ?? NaN)), perTicket: average(rows.map(x => x.perTicket ?? NaN)), kmDay: average(rows.map(x => x.kmDay ?? NaN)),
    autoKm: average(rows.map(x => x.autoKm ?? NaN)), out: average(rows.map(x => x.out ?? NaN)), over: average(rows.map(x => x.over ?? NaN)),
  }
  const toned = rows.map(x => {
    const t = {
      perDay: byAverage(x.perDay, mid.perDay), kmDay: byAverage(x.kmDay, mid.kmDay),
      autoKm: byAverage(x.autoKm, mid.autoKm),
      cut: x.cutPct >= 15 ? 'red' : x.cutPct >= 5 ? 'amber' : null,
    } as Record<string, Tone>
    const score = Object.values(t).reduce((s, v) => s + (v === 'red' ? 2 : v === 'amber' ? 1 : 0), 0)
    return { ...x, t, score }
  }).sort((a, b) => b.score - a.score || b.r.claimed - a.r.claimed)
  const n = rows.length
  const avgDays = average(rows.map(x => x.r.days))
  const totalCut = rows.reduce((t, x) => t + Number(x.r.cut ?? 0), 0)
  const times = (x: number | null, m: number | null) => (x != null && m ? `${(x / m).toFixed(1)}× the average of ${n}` : undefined)
  const cell = (tone: Tone, text: string, title?: string) => <td title={title} className="px-2 py-2 text-right tabular-nums"><span className={`rounded-md px-1.5 py-0.5 ${tone ? TONE[tone] : 'text-ink-800'}`}>{text}</span></td>
  const f1 = (v: number | null, s = '') => (v == null ? '—' : `${v.toFixed(1)}${s}`)
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><Activity className="h-4 w-4 text-violet-600" /> Patterns · {where}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 text-left">Person</th><th className="px-2 py-2 text-right">Days</th><th className="px-2 py-2 text-right">₹ a day</th>
              <th className="px-2 py-2 text-right">Km a day</th>
              <th className="px-2 py-2 text-right">Auto ₹/km</th><th className="px-2 py-2 text-right">Cut</th>
            </tr>
          </thead>
          <tbody>
            <tr role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o) }}
              className={`cursor-pointer bg-violet-50/60 transition-colors hover:bg-violet-100/70 ${open ? 'border-b border-ink-100' : ''}`}>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-1.5 font-semibold text-ink-900"><ChevronDown className={`h-4 w-4 text-violet-600 transition-transform ${open ? 'rotate-180' : ''}`} />Average</span>
                <span className="block pl-[1.375rem] text-xs text-ink-500">{n} {n === 1 ? 'person' : 'people'}</span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums text-ink-700">{f1(avgDays)}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink-900">{mid.perDay == null ? '—' : money(mid.perDay)}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink-900">{f1(mid.kmDay)}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink-900">{mid.autoKm == null ? '—' : `₹${mid.autoKm.toFixed(1)}`}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink-900">{totalCut ? money(totalCut) : '—'}</td>
            </tr>
            {open && toned.map(x => (
              <tr key={x.r.ecode} className="border-b border-ink-100 transition-colors last:border-0 hover:bg-ink-50">
                <td className="px-3 py-2"><span className="block font-medium text-ink-900">{x.r.name}</span><span className="text-xs text-ink-500">{[x.r.ecode, x.r.function].filter(Boolean).join(' · ')}</span></td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-700">{x.r.days}</td>
                {cell(x.t.perDay, x.perDay == null ? '—' : money(x.perDay), times(x.perDay, mid.perDay))}
                {cell(x.t.kmDay, f1(x.kmDay), times(x.kmDay, mid.kmDay))}
                {cell(x.t.autoKm, x.autoKm == null ? '—' : `₹${x.autoKm.toFixed(1)}`, x.autoKm != null ? `${x.r.auto_rides} auto ride${x.r.auto_rides === 1 ? '' : 's'}${times(x.autoKm, mid.autoKm) ? ' · ' + times(x.autoKm, mid.autoKm) : ''}` : undefined)}
                {cell(x.t.cut, x.r.cut ? money(x.r.cut) : '—', x.r.cut ? `${x.cutPct.toFixed(0)}% of what was claimed` : undefined)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
