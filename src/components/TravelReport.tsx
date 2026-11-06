import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { FileSpreadsheet, Search, X } from 'lucide-react'
import { Alert, PageLoader, SortHeader, Spinner, StatTile } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'
import { useBackCloses } from '@/lib/useBackCloses'

/*
  SW Admin's travel report (te_0095; the user, 2 Nov: "they need a report ie example map km, they claimed km … check how
  much % they claimed in average … custom date download option … squeeze the team members faking or claming excess
  claims"; "it should have function name, ecode name etc basic datas, reporting manager"): each person's km against the
  map's and the signs worth a look. A press on a person shows their rides and signs; the Excel holds the people shown,
  their rides and their signs. KPI's SW Admin keeps a copy of this file (src/pages/admin/TravelReport.tsx).
*/

const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendlyError(error))
  return data as T
}

type Kind = 'speed' | 'shared_phone' | 'same_spot' | 'clock' | 'other_phone' | 'late' | 'no_photo' | 'at_limit' | 'twice' | 'auto_high' | 'no_map' | 'home' | 'cut'
type Weight = 'red' | 'amber' | 'grey'
/** The signs, the hardest to explain away first; grey ones are for the picture, not counted as signs. */
const SIGNS: Array<[Kind, string, Weight]> = [
  ['speed', 'Too fast between photos', 'red'], ['shared_phone', 'Phone shared with another person', 'red'],
  ['same_spot', 'Exact same GPS point', 'red'], ['clock', 'Phone clock ahead', 'red'],
  ['other_phone', 'Photo on another phone', 'amber'], ['late', 'Photo uploaded late', 'amber'], ['no_photo', 'Ride without photo', 'amber'],
  ['at_limit', 'Km at the limit', 'amber'], ['twice', 'Same ride twice', 'amber'], ['auto_high', 'Auto fare high', 'amber'],
  ['no_map', 'No map km', 'amber'], ['home', 'Home moved', 'grey'], ['cut', 'Cut by approver', 'grey'],
]
const LOOK: Record<Weight, string> = { red: 'bg-cyrixRed-100 text-cyrixRed-800', amber: 'bg-amber-100 text-amber-800', grey: 'bg-ink-100 text-ink-700' }

interface Person {
  id: string; ecode: string; name: string; function: string | null; designation: string | null; grade: string | null; location: string | null
  manager: string | null; rides: number; checked: number; map_km: number; claimed_km: number; amount: number; extra_amount: number; over10: number
  signs: Partial<Record<Kind, number>>; cut: number
}
interface Ride {
  employee_id: string; day: string; number: string | null; way: string; mode: string; purpose: string | null; project: string | null
  map_km: number | null; claimed_km: number | null; top: number | null; amount: number | null
}
interface Sign { employee_id: string; day: string; kind: Kind; what: string; amount: number | null }
interface Report { tolerance: number; people: Person[]; rides: Ride[] | null; signs: Sign[] | null }
type Row = Person & { pct: number | null; flags: number }
type SortKey = 'name' | 'function' | 'manager' | 'rides' | 'map' | 'claimed' | 'pct' | 'extra' | 'signs'

const PERIODS = [['all', 'All time'], ['this', 'This month'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]
const isoDay = (d: Date) => d.toLocaleDateString('en-CA')
const today = () => isoDay(new Date())
const monthStart = () => { const t = new Date(); return isoDay(new Date(t.getFullYear(), t.getMonth(), 1)) }
const dayLong = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const dayShort = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const az = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const extraPct = (map: number | null, claimed: number | null) => (map && map > 0 && claimed != null ? ((claimed - map) / map) * 100 : null)
const kmText = (v: number | null) => (v == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('en-IN')} km`)
const rupee = (v: number | null) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`)
const pctText = (v: number | null) => (v == null ? '—' : `${v > 0.05 ? '+' : ''}${v.toFixed(1)}%`)
const pctTone = (v: number | null) => (v == null || v <= 10 ? 'text-ink-900' : v <= 25 ? 'text-amber-700' : 'text-cyrixRed-700')
const MODE: Record<string, string> = { bike: 'Bike', car: 'Car' }

export default function TravelReport() {
  const [period, setPeriod] = useState<Period>('all')
  const [custom, setCustom] = useState<[string, string]>(() => [monthStart(), today()])
  const [from, to] = period === 'all' ? ['2000-01-01', '2999-12-31'] : period === 'this' ? [monthStart(), today()] : custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  const label = period === 'all' ? 'All time' : `${dayLong(from)} – ${dayLong(to)}`
  const { data, isLoading, error } = useQuery({
    queryKey: ['te_km_report', from, to],
    queryFn: () => rpc<Report>('te_km_report', { p_from: from, p_to: to }),
  })
  const [q, setQ] = useState('')
  const [fn, setFn] = useState('')
  const [mgr, setMgr] = useState('')
  const [onlySigns, setOnlySigns] = useState(false)
  const [sort, setSort] = useState<SortKey>('pct')
  const [asc, setAsc] = useState(false)
  const [open, setOpen] = useState<Row | null>(null)
  const [xl, setXl] = useState<'busy' | string | null>(null)

  const rows = useMemo<Row[]>(() => (data?.people ?? []).map(p => ({
    ...p, pct: extraPct(p.map_km, p.claimed_km),
    flags: SIGNS.reduce((t, [k, , w]) => t + (w === 'grey' ? 0 : p.signs[k] ?? 0), 0),
  })), [data])
  const functions = useMemo(() => [...new Set(rows.map(r => r.function).filter((x): x is string => !!x))].sort(az.compare), [rows])
  const managers = useMemo(() => [...new Set(rows.map(r => r.manager).filter((x): x is string => !!x))].sort(az.compare), [rows])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter(r => (!fn || r.function === fn) && (!mgr || r.manager === mgr) && (!onlySigns || r.flags > 0)
      && words.every(w => [r.name, r.ecode, r.function, r.manager, r.designation, r.location].join(' ').toLowerCase().includes(w)))
    const v = (r: Row): string | number | null => ({
      name: r.name, function: r.function, manager: r.manager, rides: r.rides, map: r.map_km, claimed: r.claimed_km, pct: r.pct, extra: r.extra_amount, signs: r.flags,
    })[sort]
    // Blanks last whichever way it is sorted.
    return [...list].sort((a, b) => {
      const x = v(a), y = v(b)
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : az.compare(String(x), String(y))
      return asc ? c : -c
    })
  }, [rows, q, fn, mgr, onlySigns, sort, asc])
  const onSort = (k: SortKey) => { if (k === sort) setAsc(!asc); else { setSort(k); setAsc(k === 'name' || k === 'function' || k === 'manager') } }

  const t = shown.reduce((s, r) => ({ map: s.map + r.map_km, claimed: s.claimed + r.claimed_km, extra: s.extra + r.extra_amount }), { map: 0, claimed: 0, extra: 0 })
  const download = async () => {
    setXl('busy')
    try {
      const full = await rpc<Report>('te_km_report', { p_from: from, p_to: to, p_detail: true })
      const ids = new Set(shown.map(r => r.id))
      await exportReport(label, shown, (full.rides ?? []).filter(x => ids.has(x.employee_id)), (full.signs ?? []).filter(x => ids.has(x.employee_id)))
      setXl(null)
    } catch (e) { setXl((e as Error).message) }
  }

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
        <div className="lg:ml-auto">
          <button type="button" disabled={xl === 'busy' || !shown.length} onClick={() => void download()}
            className="btn-lift inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-green-600/40 px-3 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50 lg:w-auto">
            {xl === 'busy' ? <Spinner className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />} Download Excel
          </button>
          {xl && xl !== 'busy' && <div className="mt-2"><Alert kind="error">{xl}</Alert></div>}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:min-w-[14rem] sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input h-10 pl-9 pr-9" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, E-code, manager" aria-label="Search people" />
          {q && <button type="button" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-500 hover:bg-ink-100" aria-label="Clear the search" onClick={() => setQ('')}><X className="h-4 w-4" /></button>}
        </div>
        <select className="input h-10 sm:w-48" value={fn} onChange={e => setFn(e.target.value)} aria-label="Function">
          <option value="">All functions</option>
          {functions.map(f => <option key={f}>{f}</option>)}
        </select>
        <select className="input h-10 sm:w-60" value={mgr} onChange={e => setMgr(e.target.value)} aria-label="Reporting manager">
          <option value="">All reporting managers</option>
          {managers.map(m => <option key={m}>{m}</option>)}
        </select>
        <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-200 px-3 text-sm font-medium text-ink-800">
          <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={onlySigns} onChange={e => setOnlySigns(e.target.checked)} /> Only with signs
        </label>
      </div>

      {isLoading ? <PageLoader /> : error ? <Alert kind="error">{(error as Error).message}</Alert> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="col-span-2 sm:col-span-1"><StatTile tone="brand" label="Extra over map" value={<span className={pctTone(extraPct(t.map, t.claimed))}>{pctText(extraPct(t.map, t.claimed))}</span>} /></div>
            <StatTile label="Map km" value={kmText(t.map)} />
            <StatTile label="Claimed km" value={kmText(t.claimed)} />
            <StatTile label="Extra km" value={kmText(t.claimed - t.map)} />
            <StatTile label="Extra ₹" value={rupee(t.extra)} />
          </div>

          {!shown.length ? (
            <div className="card p-8 text-center text-sm text-ink-500">{rows.length ? 'No one matches.' : 'No claims in these days.'}</div>
          ) : (
            <>
              {/* A phone: a card a person, the extra on the right. */}
              <div className="card divide-y divide-ink-100 overflow-hidden sm:hidden">
                {shown.map(r => (
                  <button key={r.id} type="button" onClick={() => setOpen(r)} className="block w-full px-4 py-3 text-left active:bg-ink-50">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">{r.name}</span>
                        <span className="block truncate text-xs text-ink-500">{[r.ecode, r.function].filter(Boolean).join(' · ')}</span>
                        {r.manager && <span className="block truncate text-xs text-ink-500">Manager: {r.manager}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={clsx('block text-lg font-bold tabular-nums', pctTone(r.pct))}>{pctText(r.pct)}</span>
                        <span className="block text-xs text-ink-500">{rupee(r.extra_amount)}</span>
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-ink-600">Map {kmText(r.map_km)} · Claimed {kmText(r.claimed_km)} · {r.rides} rides</span>
                    <Chips signs={r.signs} className="mt-2" />
                  </button>
                ))}
              </div>
              <div className="card hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs">
                    <tr>
                      <SortHeader label="Person" col="name" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Function" col="function" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Reporting manager" col="manager" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Rides" col="rides" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Map km" col="map" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Claimed km" col="claimed" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Extra" col="pct" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Extra ₹" col="extra" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                      <SortHeader label="Signs" col="signs" sortKey={sort} asc={asc} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {shown.map(r => (
                      <tr key={r.id} tabIndex={0} onClick={() => setOpen(r)} onKeyDown={e => { if (e.key === 'Enter') setOpen(r) }} className="cursor-pointer hover:bg-ink-50">
                        <td className="px-4 py-2.5"><p className="whitespace-nowrap font-semibold text-ink-900">{r.name}</p><p className="whitespace-nowrap text-xs text-ink-500">{[r.ecode, r.designation].filter(Boolean).join(' · ')}</p></td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{r.function ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{r.manager ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.rides}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{kmText(r.map_km)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{kmText(r.claimed_km)}</td>
                        <td className={clsx('whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums', pctTone(r.pct))}>{pctText(r.pct)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{rupee(r.extra_amount)}</td>
                        <td className="min-w-[10rem] px-4 py-2.5"><Chips signs={r.signs} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {open && <PersonPage row={open} from={from} to={to} label={label} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Chips({ signs, className }: { signs: Partial<Record<Kind, number>>; className?: string }) {
  const on = SIGNS.filter(([k]) => signs[k])
  if (!on.length) return <span className={clsx('block text-xs text-ink-400', className)}>No signs</span>
  return (
    <span className={clsx('flex flex-wrap gap-1', className)}>
      {on.map(([k, l, w]) => (
        <span key={k} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', LOOK[w])}>{l}<span className="tabular-nums">{signs[k]}</span></span>
      ))}
    </span>
  )
}

/** One person: who they are, their km, their signs and every bike and car ride. */
function PersonPage({ row, from, to, label, onClose }: { row: Row; from: string; to: string; label: string; onClose: () => void }) {
  useBackCloses(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const { data, isLoading, error } = useQuery({
    queryKey: ['te_km_report', from, to, row.id],
    queryFn: () => rpc<Report>('te_km_report', { p_from: from, p_to: to, p_employee: row.id, p_detail: true }),
  })
  const signs = data?.signs ?? []
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={row.name} onClick={e => e.stopPropagation()}
        className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-4 sm:max-w-4xl sm:rounded-b-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink-900">{row.name} <span className="text-sm font-medium text-ink-500">{row.ecode}</span></p>
            <p className="text-sm text-ink-600">{[row.designation, row.grade && `Grade ${row.grade}`, row.function, row.location].filter(Boolean).join(' · ')}</p>
            {row.manager && <p className="text-sm text-ink-600">Reporting manager: {row.manager}</p>}
            <p className="text-xs text-ink-500">{label}</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([['Extra over map', <span key="p" className={pctTone(row.pct)}>{pctText(row.pct)}</span>], ['Map km', kmText(row.map_km)], ['Claimed km', kmText(row.claimed_km)], ['Extra ₹', rupee(row.extra_amount)]] as const).map(([l, v]) => (
            <div key={l} className="rounded-xl border border-ink-200 px-3 py-2">
              <p className="text-xs font-medium text-ink-500">{l}</p>
              <p className="text-lg font-semibold tabular-nums text-ink-900">{v}</p>
            </div>
          ))}
        </div>

        {isLoading ? <div className="grid place-items-center py-10"><Spinner className="h-6 w-6" /></div> : error ? <div className="mt-3"><Alert kind="error">{(error as Error).message}</Alert></div> : (
          <>
            <h3 className="mt-5 text-sm font-semibold text-ink-900">Signs</h3>
            {!signs.length ? <p className="mt-1 text-sm text-ink-500">No signs.</p> : (
              <div className="mt-2 space-y-3">
                {SIGNS.filter(([k]) => signs.some(s => s.kind === k)).map(([k, l, w]) => (
                  <div key={k}>
                    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', LOOK[w])}>{l}<span className="tabular-nums">{signs.filter(s => s.kind === k).length}</span></span>
                    <ul className="mt-1 space-y-1">
                      {signs.filter(s => s.kind === k).map((s, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-14 shrink-0 tabular-nums text-ink-500">{dayShort(s.day)}</span>
                          <span className="min-w-0 flex-1 text-ink-800">{s.what}</span>
                          {s.amount != null && s.amount > 0 && <span className="shrink-0 tabular-nums text-ink-600">{rupee(s.amount)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mt-5 text-sm font-semibold text-ink-900">Bike and car rides</h3>
            {!data?.rides?.length ? <p className="mt-1 text-sm text-ink-500">No bike or car rides.</p> : (
              <div className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200">
                {data.rides.map((r, i) => {
                  const p = extraPct(r.map_km, r.claimed_km)
                  return (
                    <div key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 text-sm">
                      <span className="tabular-nums text-ink-500">{dayShort(r.day)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-ink-900">{r.way}</span>
                        <span className="block truncate text-xs text-ink-500">{[MODE[r.mode] ?? r.mode, r.purpose, r.number].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="text-right">
                        <span className="block whitespace-nowrap tabular-nums text-ink-900">{kmText(r.map_km)} → {kmText(r.claimed_km)}</span>
                        <span className={clsx('block text-xs font-semibold tabular-nums', pctTone(p))}>{pctText(p)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** The Excel: the people shown, every bike and car ride of theirs, every sign — the grid and colours of the claim exports. */
async function exportReport(label: string, people: Row[], rides: Ride[], signs: Sign[]) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  type Cell = string | number | null
  type Fmt = 'text' | 'km' | 'int' | 'pct'
  const heading = `Travel report · ${label}`

  const sheet = (name: string, cols: Array<[string, Fmt]>, body: Cell[][], total: Cell[] | null) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.addRow([heading]); ws.mergeCells(1, 1, 1, cols.length)
    ws.addRow([name]); ws.mergeCells(2, 1, 2, cols.length)
    ws.addRow(cols.map(([h]) => h))
    for (const r of body) ws.addRow(r)
    const tot = total ? ws.addRow(total) : null
    ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
      if (cn > cols.length) return
      const f = cols[cn - 1][1]
      cell.font = { name: 'Calibri', size: 10, bold: rn <= 3 || row === tot }
      // Nothing wraps: each column is as wide as what it holds.
      cell.alignment = { vertical: 'middle', wrapText: false, horizontal: rn > 3 && f !== 'text' ? 'right' : undefined }
      if (rn >= 3) cell.border = grid
      if (rn > 3 && typeof cell.value === 'number') cell.numFmt = f === 'km' ? '#,##0.0' : f === 'pct' ? '0.0"%"' : '#,##0'
      if (rn === 1) { cell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill('FF111111') }
      if (rn === 3) cell.fill = fill('FFF3F4F6')
      if (row === tot) cell.fill = fill('FFF3F4F6')
    }))
    ws.getRow(1).height = 24
    ws.columns = cols.map(([h], i) => ({ width: Math.min(70, Math.max(8, h.length + 3, ...[...body, ...(total ? [total] : [])].map(r => String(r[i] ?? '').length + 2))) }))
  }
  const date = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB')
  const one = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
  const sum = <T,>(list: T[], f: (x: T) => number | null) => list.reduce((s, x) => s + (f(x) ?? 0), 0)
  const who = new Map(people.map(p => [p.id, p]))
  const base = (id: string): Cell[] => { const p = who.get(id); return [p?.ecode ?? '', p?.name ?? '', p?.function ?? '', p?.manager ?? ''] }

  const map = sum(people, p => p.map_km), claimed = sum(people, p => p.claimed_km)
  sheet('By person', [
    ['E-code', 'text'], ['Name', 'text'], ['Function', 'text'], ['Designation', 'text'], ['Grade', 'text'], ['Location', 'text'], ['Reporting manager', 'text'],
    ['Rides', 'int'], ['Map km', 'km'], ['Claimed km', 'km'], ['Extra km', 'km'], ['Extra %', 'pct'], ['Extra ₹', 'int'], ['Rides over map +10%', 'int'],
    ...SIGNS.map(([, l]) => [l, 'int'] as [string, Fmt]), ['Cut ₹', 'int'],
  ], people.map(p => [
    p.ecode, p.name, p.function, p.designation, p.grade, p.location, p.manager,
    p.rides, one(p.map_km), one(p.claimed_km), one(p.claimed_km - p.map_km), p.pct == null ? null : Math.round(p.pct * 10) / 10, Math.round(p.extra_amount), p.over10,
    ...SIGNS.map(([k]) => p.signs[k] ?? 0), Math.round(p.cut),
  ]), ['TOTAL', null, null, null, null, null, null,
    sum(people, p => p.rides), one(map), one(claimed), one(claimed - map), map > 0 ? Math.round(((claimed - map) / map) * 1000) / 10 : null,
    Math.round(sum(people, p => p.extra_amount)), sum(people, p => p.over10),
    ...SIGNS.map(([k]) => sum(people, p => p.signs[k] ?? 0)), Math.round(sum(people, p => p.cut))])

  const rMap = sum(rides, r => (r.map_km && r.claimed_km != null ? r.map_km : null)), rClaimed = sum(rides, r => (r.map_km && r.claimed_km != null ? r.claimed_km : null))
  sheet('Bike and car rides', [
    ['E-code', 'text'], ['Name', 'text'], ['Function', 'text'], ['Reporting manager', 'text'], ['Date', 'text'], ['Claim', 'text'], ['Ride', 'text'], ['Mode', 'text'],
    ['Purpose', 'text'], ['Call centre', 'text'], ['Map km', 'km'], ['Claimed km', 'km'], ['Extra km', 'km'], ['Extra %', 'pct'], ['Most allowed km', 'km'], ['Amount ₹', 'int'],
  ], rides.map(r => {
    const p = extraPct(r.map_km, r.claimed_km)
    return [...base(r.employee_id), date(r.day), r.number, r.way, MODE[r.mode] ?? r.mode, r.purpose, r.project, one(r.map_km), one(r.claimed_km),
      r.map_km != null && r.claimed_km != null ? one(r.claimed_km - r.map_km) : null, p == null ? null : Math.round(p * 10) / 10, one(r.top), r.amount == null ? null : Math.round(r.amount)]
  }), ['TOTAL', null, null, null, null, null, null, null, null, null, one(rMap), one(rClaimed), one(rClaimed - rMap),
    rMap > 0 ? Math.round(((rClaimed - rMap) / rMap) * 1000) / 10 : null, null, Math.round(sum(rides, r => r.amount))])

  sheet('Warning signs', [
    ['E-code', 'text'], ['Name', 'text'], ['Function', 'text'], ['Reporting manager', 'text'], ['Date', 'text'], ['Sign', 'text'], ['What', 'text'], ['₹', 'int'],
  ], signs.map(s => [...base(s.employee_id), date(s.day), SIGNS.find(([k]) => k === s.kind)?.[1] ?? s.kind, s.what, s.amount]), null)

  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `Travel report ${label}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
