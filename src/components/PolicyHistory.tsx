import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Search } from 'lucide-react'
import { Alert, PageLoader, SortHeader } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

/*
  Travel policy's History tab (te_0098; the user, 3 Nov: "if any travel policy is edited we need history also who
  edited what date and time"): every change to allowances, settings, purposes, projects, expense types, coordinators
  and the desks, newest first, with what it was and what it became. KPI's SW Admin keeps a copy of this file (src/pages/admin/PolicyHistory.tsx).
*/
interface Change { id: number; at: string; by: string | null; area: string; item: string | null; field: string | null; action: 'changed' | 'added' | 'removed'; before: string | null; after: string | null }

const PERIODS = [['all', 'All time'], ['this', 'This month'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]
const isoDay = (d: Date) => d.toLocaleDateString('en-CA')
const today = () => isoDay(new Date())
const monthStart = () => { const t = new Date(); return isoDay(new Date(t.getFullYear(), t.getMonth(), 1)) }
const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
const az = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

// Fields the Travel policy page does not name in its own lists.
const MORE: Record<string, string> = {
  flight: 'Flight', taxi: 'Taxi car', gives_da: 'Gives DA', is_active: 'In use', photo_needed: 'Visit photo needed', bill_always: 'Bill always',
  label: 'Name', coordinator_id: 'Coordinator', role: 'Role', value: 'Value',
  visit_photos: 'Visit photos', photo_after: 'Photo after the limit', photo_skips: 'Photo not possible a month', photo_near_m: 'Photo within, metres',
  photo_keep_days: 'Keep photos after paid, days', photo_speed_on: 'Travel time check', photo_speeds: 'Travel time speeds',
}
const ACTION: Record<Change['action'], { label: string; tone: string }> = {
  changed: { label: 'Changed', tone: 'bg-amber-100 text-amber-900' },
  added: { label: 'Added', tone: 'bg-green-100 text-green-900' },
  removed: { label: 'Removed', tone: 'bg-cyrixRed-100 text-cyrixRed-900' },
}
type SortKey = 'at' | 'by' | 'area' | 'item'

export default function PolicyHistory({ names }: { names: Record<string, string> }) {
  const [period, setPeriod] = useState<Period>('all')
  const [custom, setCustom] = useState<[string, string]>([monthStart(), today()])
  const [from, to] = period === 'all' ? [null, null] : period === 'this' ? [monthStart(), today()] : custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  const { data, isLoading, error } = useQuery({
    queryKey: ['te_policy_history', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('te_policy_history', { p_from: from, p_to: to })
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as Change[]
    },
  })
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [by, setBy] = useState('')
  const [sort, setSort] = useState<SortKey>('at')
  const [asc, setAsc] = useState(false)
  const onSort = (k: SortKey) => { if (k === sort) setAsc(!asc); else { setSort(k); setAsc(k !== 'at') } }

  const name = (k: string | null) => (k ? names[k] ?? MORE[k] ?? k : '')
  // A setting is named by its key; everything else by its own name (a grade, a purpose, a person).
  const itemText = (c: Change) => (c.area === 'Settings' ? name(c.item) : c.item ?? '')
  const value = (v: string | null): string => {
    if (v == null || v === '') return '—'
    if (v === 'true') return 'On'
    if (v === 'false') return 'Off'
    try {
      const j = JSON.parse(v)
      if (Array.isArray(j)) return j.join(', ')
      if (j && typeof j === 'object') return Object.entries(j).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${name(k)}: ${value(String(x))}`).join(' · ')
    } catch { /* plain text */ }
    return v
  }
  const what = (c: Change) => (c.area === 'Settings' || !c.field ? '' : name(c.field))

  const all = data ?? []
  const areas = useMemo(() => [...new Set(all.map(c => c.area))].sort(az.compare), [all])
  const people = useMemo(() => [...new Set(all.map(c => c.by ?? '—'))].sort(az.compare), [all])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = all.filter(c => (!area || c.area === area) && (!by || (c.by ?? '—') === by)
      && (!s || [c.by, c.area, itemText(c), what(c), value(c.before), value(c.after)].join(' ').toLowerCase().includes(s)))
    const key = (c: Change) => (sort === 'at' ? c.at : sort === 'by' ? c.by ?? '' : sort === 'area' ? c.area : itemText(c))
    return [...list].sort((a, b) => (asc ? 1 : -1) * az.compare(key(a), key(b)) || b.id - a.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, area, by, sort, asc])

  const change = (c: Change) => c.action === 'changed'
    ? <span><span className="text-ink-500 line-through decoration-ink-300">{value(c.before)}</span> → <b className="text-ink-900">{value(c.after)}</b></span>
    : <span className="text-ink-700">{value(c.action === 'added' ? c.after : c.before)}</span>

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={clsx('h-9 rounded-full px-3.5 text-sm font-medium', period === k ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>{l}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            {(['From', 'To'] as const).map((l, i) => (
              <label key={l} className="flex min-w-0 items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{l}</span>
                <input type="date" className="input h-9 min-w-0" value={custom[i]} max={i === 0 ? custom[1] : today()} min={i === 1 ? custom[0] : undefined}
                  onChange={e => e.target.value && setCustom(i === 0 ? [e.target.value, custom[1]] : [custom[0], e.target.value])} />
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input h-10 pl-9" value={q} placeholder="Search" onChange={e => setQ(e.target.value)} />
        </label>
        <select className="input h-10" value={area} onChange={e => setArea(e.target.value)}>
          <option value="">Every part</option>
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input h-10" value={by} onChange={e => setBy(e.target.value)}>
          <option value="">Everyone</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {isLoading ? <PageLoader />
        : error ? <Alert kind="error">{(error as Error).message}</Alert>
        : !shown.length ? <div className="card p-8 text-center text-sm text-ink-500">No changes.</div>
        : <>
          {/* Phone: one card a change. */}
          <div className="space-y-2 sm:hidden">
            {shown.map(c => (
              <div key={c.id} className="card px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium text-ink-900">{c.area} · {itemText(c)}{what(c) && <span className="font-normal text-ink-500"> · {what(c)}</span>}</p>
                  <span className={`badge shrink-0 ${ACTION[c.action].tone}`}>{ACTION[c.action].label}</span>
                </div>
                <p className="mt-1 break-words">{change(c)}</p>
                <p className="mt-1 text-xs text-ink-500">{c.by ?? '—'} · {dateText(c.at)}, {timeText(c.at)}</p>
              </div>
            ))}
          </div>
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs">
                <tr>
                  <SortHeader label="Date" col="at" sortKey={sort} asc={asc} onSort={onSort} />
                  <th className="px-3 py-2 font-semibold text-ink-600">Time</th>
                  <SortHeader label="Changed by" col="by" sortKey={sort} asc={asc} onSort={onSort} />
                  <SortHeader label="Part" col="area" sortKey={sort} asc={asc} onSort={onSort} />
                  <SortHeader label="Item" col="item" sortKey={sort} asc={asc} onSort={onSort} />
                  <th className="px-3 py-2 font-semibold text-ink-600">Field</th>
                  <th className="px-3 py-2 font-semibold text-ink-600">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {shown.map(c => (
                  <tr key={c.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">{dateText(c.at)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-600">{timeText(c.at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{c.by ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{c.area}</td>
                    <td className="px-3 py-2 font-medium">{itemText(c)}</td>
                    <td className="px-3 py-2 text-ink-600">{what(c)}</td>
                    <td className="min-w-[12rem] px-3 py-2"><span className={`badge mr-2 ${ACTION[c.action].tone}`}>{ACTION[c.action].label}</span>{change(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
    </div>
  )
}
