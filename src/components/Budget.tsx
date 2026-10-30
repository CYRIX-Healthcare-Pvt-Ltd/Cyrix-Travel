import type { CSSProperties } from 'react'
import { CircleAlert, HandCoins, Smartphone, TriangleAlert, type LucideIcon } from 'lucide-react'
import { MODES, expenseRole, money, type Day, type Rule } from '@/lib/claims'

/*
  The month's budget, as meters (the user, 18 Oct: "this is the budget isn't it? so in each claim
  when they apply it should show the balance also, they have in month"): the grade's bike or car km a
  month, and the auto and phone allowances. Each fill wears its mode's colour; from 80% the words
  beside it turn amber, and red past the limit, each with an icon.
*/
export interface BudgetLine { key: string; label: string; icon: LucideIcon; color: string; used: number; limit: number; unit: 'km' | '₹'; plain?: boolean }
export interface Used { bike: number; car: number; auto: number; phone: number }

export function budgetLines(rule: Pick<Rule, 'bike_rate' | 'bike_km_month' | 'car_rate' | 'car_km_month'>, policy: Record<string, unknown>, used: Used): BudgetLine[] {
  const out: BudgetLine[] = []
  if (rule.bike_rate && rule.bike_km_month) out.push({ key: 'bike', label: 'Bike', icon: MODES.bike.icon, color: MODES.bike.color, used: used.bike, limit: rule.bike_km_month, unit: 'km' })
  if (rule.car_rate && rule.car_km_month) out.push({ key: 'car', label: 'Car', icon: MODES.car.icon, color: MODES.car.color, used: used.car, limit: rule.car_km_month, unit: 'km' })
  const auto = Number(policy.auto_month ?? 0), phone = Number(policy.phone_month ?? 0)
  if (auto) out.push({ key: 'auto', label: 'Auto', icon: MODES.auto.icon, color: MODES.auto.color, used: used.auto, limit: auto, unit: '₹' })
  if (phone) out.push({ key: 'phone', label: 'Phone', icon: Smartphone, color: '#64748B', used: used.phone, limit: phone, unit: '₹' })
  return out
}

/*
  The advance left (te_0063; the user, 24 Oct: "after phone need to show advance amount also … in next month also
  balance should show"): every advance given of the claim's month or before, less what earlier claims took and
  what this one takes.
*/
export function advanceLine(box: { given: number; before: number } | null | undefined, takes: number): BudgetLine | null {
  if (!box || box.given <= 0) return null
  return { key: 'advance', label: 'Advance', icon: HandCoins, color: '#4F46E5', used: Math.min(box.given, box.before + Math.max(0, takes)), limit: box.given, unit: '₹', plain: true }
}
/** What this claim takes of the advance left: what it pays, up to what is left. */
export const advanceTakes = (box: { given: number; before: number } | null | undefined, pays: number) =>
  box ? Math.max(0, Math.min(box.given - box.before, pays)) : 0

/** What one day spends of the month's budget. */
export function dayUse(d: Day | undefined): Used {
  const u = { bike: 0, car: 0, auto: 0, phone: 0 }
  if (!d) return u
  for (const r of d.rides) {
    if (r.mode === 'bike') u.bike += r.claimed_km ?? 0
    if (r.mode === 'car') u.car += r.claimed_km ?? 0
    if (r.mode === 'auto') u.auto += r.fare ?? 0
  }
  for (const x of d.expenses) if (expenseRole(x.category) === 'phone') u.phone += x.amount || 0
  return u
}

export const monthLong = (iso: string) => new Date(iso.slice(0, 7) + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long' })

export default function Budget({ title, lines }: { title: string; lines: BudgetLine[] }) {
  if (!lines.length) return null
  return (
    <div className="card p-3 sm:p-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {/* As many columns as meters, so they fill the card (the user, 18 Oct: "stretch this to fit the container"); on a phone two a row, an odd last one full width. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6 sm:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]" style={{ '--n': lines.length } as CSSProperties}>
        {lines.map((l, i) => <div key={l.key} className={lines.length % 2 && i === lines.length - 1 ? 'col-span-2 sm:col-span-1' : ''}><Meter l={l} /></div>)}
      </div>
    </div>
  )
}

function Meter({ l }: { l: BudgetLine }) {
  const pct = l.limit > 0 ? l.used / l.limit : 0
  const left = l.limit - l.used
  const state = l.plain ? 'ok' : pct > 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok'
  const fmt = (n: number) => (l.unit === 'km' ? `${(Math.round(n * 10) / 10).toLocaleString('en-IN')} km` : money(n))
  const I = l.icon
  return (
    <div className="min-w-0" title={`${l.label}: ${fmt(l.used)} of ${fmt(l.limit)} used`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink-800"><I className="h-4 w-4 shrink-0" style={{ color: l.color }} />{l.label}</span>
        <span className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${state === 'over' ? 'text-cyrixRed-700' : state === 'near' ? 'text-amber-800' : 'text-ink-900'}`}>
          {state === 'over' ? <><TriangleAlert className="h-3.5 w-3.5" />Over {fmt(-left)}</> : <>{state === 'near' && <CircleAlert className="h-3.5 w-3.5" />}{fmt(left)} left</>}
        </span>
      </div>
      {/* The fill in the mode's own colour, on a pale track of it (the user, 18 Oct); near or over is said in words above. */}
      <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: l.color + '33' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, minWidth: l.used > 0 ? 4 : 0, background: l.color }} />
      </div>
      <p className="mt-1 text-xs text-ink-500">{fmt(l.used)} of {fmt(l.limit)}</p>
    </div>
  )
}
