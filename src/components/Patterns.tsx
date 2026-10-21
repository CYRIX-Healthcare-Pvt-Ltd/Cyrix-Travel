import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { money, rpc } from '@/lib/claims'

/*
  Patterns (te_0049, te_0050; the user, 21 Oct: "this app is for monitoring engineers' expenses … patterns
  over months is very useful", "auto fare also, it can be compared"). One row a person over the days chosen;
  each figure set against the middle of the people shown — half as much again amber, twice red — and the
  most unusual first. A colour is a reason to look, not a finding.
*/
interface Row {
  ecode: string; name: string; function: string | null; days: number; claimed: number; tickets: number
  km: number; km_claimed: number | null; km_map: number | null; rides_over: number
  auto_fare: number | null; auto_km: number | null; auto_rides: number; out_days: number; cut: number
}
type Tone = 'red' | 'amber' | null
const TONE = { red: 'bg-cyrixRed-100 font-semibold text-cyrixRed-800', amber: 'bg-amber-100 font-semibold text-amber-900' } as const

const median = (xs: number[]) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 }
const byMedian = (x: number | null, mid: number | null): Tone => (x == null || !mid || mid <= 0 ? null : x >= mid * 2 ? 'red' : x >= mid * 1.5 ? 'amber' : null)

export default function Patterns({ from, to, where }: { from: string | null; to: string | null; where: string }) {
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
    perDay: median(rows.map(x => x.perDay ?? NaN)), perTicket: median(rows.map(x => x.perTicket ?? NaN)), kmDay: median(rows.map(x => x.kmDay ?? NaN)),
    autoKm: median(rows.map(x => x.autoKm ?? NaN)), out: median(rows.map(x => x.out ?? NaN)), over: median(rows.map(x => x.over ?? NaN)),
  }
  const toned = rows.map(x => {
    const t = {
      perDay: byMedian(x.perDay, mid.perDay), perTicket: byMedian(x.perTicket, mid.perTicket), kmDay: byMedian(x.kmDay, mid.kmDay),
      autoKm: byMedian(x.autoKm, mid.autoKm), out: byMedian(x.out, mid.out),
      // Km over the map is already allowed 10% a ride: over 5% across a period is a habit, over 15% a strong one.
      over: x.over == null ? null : x.over >= 15 ? 'red' : x.over >= 5 ? 'amber' : null,
      cut: x.cutPct >= 15 ? 'red' : x.cutPct >= 5 ? 'amber' : null,
    } as Record<string, Tone>
    const score = Object.values(t).reduce((s, v) => s + (v === 'red' ? 2 : v === 'amber' ? 1 : 0), 0)
    return { ...x, t, score }
  }).sort((a, b) => b.score - a.score || b.r.claimed - a.r.claimed)
  const n = rows.length
  const times = (x: number | null, m: number | null) => (x != null && m ? `${(x / m).toFixed(1)}× the middle of ${n}` : undefined)
  const cell = (tone: Tone, text: string, title?: string) => <td title={title} className="px-2 py-2 text-right tabular-nums"><span className={`rounded-md px-1.5 py-0.5 ${tone ? TONE[tone] : 'text-ink-800'}`}>{text}</span></td>
  const f0 = (v: number | null, s = '') => (v == null ? '—' : `${Math.round(v).toLocaleString('en-IN')}${s}`)
  const f1 = (v: number | null, s = '') => (v == null ? '—' : `${v.toFixed(1)}${s}`)
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><Activity className="h-4 w-4 text-violet-600" /> Patterns · {where}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 text-left">Person</th><th className="px-2 py-2 text-right">Days</th><th className="px-2 py-2 text-right">₹ a day</th>
              <th className="px-2 py-2 text-right">₹ a ticket</th><th className="px-2 py-2 text-right">Km a day</th><th className="px-2 py-2 text-right">Over map</th>
              <th className="px-2 py-2 text-right">Auto ₹/km</th><th className="px-2 py-2 text-right">Out-station</th><th className="px-2 py-2 text-right">Cut</th>
            </tr>
          </thead>
          <tbody>
            {toned.map(x => (
              <tr key={x.r.ecode} className="border-b border-ink-100 last:border-0">
                <td className="px-3 py-2"><span className="block font-medium text-ink-900">{x.r.name}</span><span className="text-xs text-ink-500">{[x.r.ecode, x.r.function].filter(Boolean).join(' · ')}</span></td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-700">{x.r.days}</td>
                {cell(x.t.perDay, x.perDay == null ? '—' : money(x.perDay), times(x.perDay, mid.perDay))}
                {cell(x.t.perTicket, x.perTicket == null ? '—' : money(x.perTicket), times(x.perTicket, mid.perTicket))}
                {cell(x.t.kmDay, f1(x.kmDay), times(x.kmDay, mid.kmDay))}
                {cell(x.t.over, x.over == null ? '—' : `${x.over > 0 ? '+' : ''}${x.over.toFixed(0)}%`, x.r.rides_over ? `${x.r.rides_over} ride${x.r.rides_over === 1 ? '' : 's'} over the 10%` : undefined)}
                {cell(x.t.autoKm, x.autoKm == null ? '—' : `₹${x.autoKm.toFixed(1)}`, x.autoKm != null ? `${x.r.auto_rides} auto ride${x.r.auto_rides === 1 ? '' : 's'}${times(x.autoKm, mid.autoKm) ? ' · ' + times(x.autoKm, mid.autoKm) : ''}` : undefined)}
                {cell(x.t.out, f0(x.out, '%'), times(x.out, mid.out))}
                {cell(x.t.cut, x.r.cut ? money(x.r.cut) : '—', x.r.cut ? `${x.cutPct.toFixed(0)}% of what was claimed` : undefined)}
              </tr>
            ))}
            {n > 1 && (
              <tr className="bg-ink-50 text-xs text-ink-500">
                <td className="px-3 py-2 font-semibold uppercase tracking-wide">Middle</td><td />
                <td className="px-2 py-2 text-right tabular-nums">{mid.perDay == null ? '—' : money(mid.perDay)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mid.perTicket == null ? '—' : money(mid.perTicket)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{f1(mid.kmDay)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mid.over == null ? '—' : `${mid.over.toFixed(0)}%`}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mid.autoKm == null ? '—' : `₹${mid.autoKm.toFixed(1)}`}</td>
                <td className="px-2 py-2 text-right tabular-nums">{f0(mid.out, '%')}</td><td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
