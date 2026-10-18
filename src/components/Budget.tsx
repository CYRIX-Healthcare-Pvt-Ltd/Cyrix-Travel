import { CircleAlert, Smartphone, TriangleAlert, type LucideIcon } from 'lucide-react'
import { MODES, money, type Day, type Rule } from '@/lib/claims'

/*
  The month's budget, as meters (the user, 18 Oct: "this is the budget isn't it? so in each claim
  when they apply it should show the balance also, they have in month"): the grade's bike or car km a
  month, and the auto and phone allowances. The fill turns amber from 80% and red past the limit,
  always with words beside it, never colour alone.
*/
export interface BudgetLine { key: string; label: string; icon: LucideIcon; color: string; used: number; limit: number; unit: 'km' | '₹' }
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

/** What one day spends of the month's budget. */
export function dayUse(d: Day | undefined): Used {
  const u = { bike: 0, car: 0, auto: 0, phone: 0 }
  if (!d) return u
  for (const r of d.rides) {
    if (r.mode === 'bike') u.bike += r.claimed_km ?? 0
    if (r.mode === 'car') u.car += r.claimed_km ?? 0
    if (r.mode === 'auto') u.auto += r.fare ?? 0
  }
  for (const x of d.expenses) if (x.category === 'Phone') u.phone += x.amount || 0
  return u
}

export const monthLong = (iso: string) => new Date(iso.slice(0, 7) + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long' })

export default function Budget({ title, lines }: { title: string; lines: BudgetLine[] }) {
  if (!lines.length) return null
  return (
    <div className="card p-3 sm:p-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {lines.map(l => <Meter key={l.key} l={l} />)}
      </div>
    </div>
  )
}

function Meter({ l }: { l: BudgetLine }) {
  const pct = l.limit > 0 ? l.used / l.limit : 0
  const left = l.limit - l.used
  const state = pct > 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok'
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
      <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${state === 'over' ? 'bg-cyrixRed-100' : state === 'near' ? 'bg-amber-100' : 'bg-teal-100'}`}>
        <div className={`h-full rounded-full ${state === 'over' ? 'bg-cyrixRed-600' : state === 'near' ? 'bg-amber-600' : 'bg-teal-600'}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-500">{fmt(l.used)} of {fmt(l.limit)}</p>
    </div>
  )
}
