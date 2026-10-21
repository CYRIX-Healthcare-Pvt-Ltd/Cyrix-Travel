import { useState } from 'react'
import { CalendarDays, MapPin, Search, X } from 'lucide-react'
import { monthLong } from '@/components/Budget'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'
import { MODES, STATUS, claimName, dayRange, todayIso, type ModeCode } from '@/lib/claims'

/*
  What My claims and Approvals share (the user, 21 Oct: "only the claim number is not good, we need a place
  name, it will be tough to know; and add a search bar, in that anything can be searched; same for the
  manager in approvals"; "need custom date filter also"): the places on each row, one box that finds a claim
  by any of its words, and the days to look at — all time, this month, or any two dates on a calendar.
*/
export interface Findable {
  number: string | null; month: string; part: number; status: string; total: number
  first_day: string | null; last_day: string | null; places?: string[]; find?: string; name?: string; ecode?: string; modes?: ModeCode[]
}

/** Every word typed must be somewhere in the claim: its places, tickets, rides, hotels, remarks, number, month, dates, amount, modes or person. */
export function matches(c: Findable, q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [c.find, c.number, c.name, c.ecode, STATUS[c.status]?.label, claimName(c.month, c.part), monthLong(c.month),
    dayRange(c.first_day, c.last_day), String(Math.round(c.total)), Math.round(c.total).toLocaleString('en-IN'), ...(c.modes ?? []).map(m => MODES[m]?.label)]
    .filter(Boolean).join(' ').toLowerCase()
  return words.every(w => hay.includes(w))
}

const PERIODS = [['all', 'All time'], ['this', 'This month'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]
const firstOf = (back: number) => { const t = new Date(todayIso() + 'T00:00:00'); return new Date(t.getFullYear(), t.getMonth() - back, 1).toLocaleDateString('en-CA') }
const dayLong = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const EARLIEST = firstOf(24)
const kept = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback } }
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* the choice is only a convenience */ } }

/** The search and the days for one list; the days chosen are remembered on this phone for that list. */
export function useClaimFilter(key: string) {
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState<Period>(() => { const p = kept<string>(`${key}.period`, 'all'); return PERIODS.some(([k]) => k === p) ? (p as Period) : 'all' })
  const [custom, setCustom] = useState<[string, string]>(() => kept<[string, string]>(`${key}.dates`, [firstOf(0), todayIso()]))
  const [choosing, setChoosing] = useState<0 | 1 | null>(null)
  const [from, to] = period === 'all' ? [null, null] : period === 'this' ? [firstOf(0), todayIso()] : custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  const pick = (p: Period) => { setPeriod(p); keep(`${key}.period`, p) }
  const setRange = (next: [string, string]) => { setCustom(next); keep(`${key}.dates`, next) }

  // A claim is in the days when any of its days is; one with no days yet only under All time.
  const test = (c: Findable) => matches(c, q) && (!from || (!!c.first_day && c.first_day <= to! && (c.last_day ?? c.first_day) >= from))
  const empty = q.trim() ? `No claim has “${q.trim()}”${from ? ' in these days' : ''}.` : 'No claim in these days.'
  const bar = (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative min-w-0 lg:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input className="input pl-9 pr-9" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search place, ticket, claim no" aria-label="Search claims" />
        {q && <button type="button" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-500 hover:bg-ink-100" aria-label="Clear the search" onClick={() => setQ('')}><X className="h-4 w-4" /></button>}
      </div>
      <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-ink-200 lg:w-auto">
        {PERIODS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => pick(k)}
            className={`h-10 whitespace-nowrap px-2 text-sm font-semibold lg:px-4 ${period === k ? 'bg-ink-900 text-[color:rgb(var(--surface))]' : 'text-ink-700 hover:bg-ink-100'}`}>{l}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="grid w-full grid-cols-2 gap-2 lg:w-auto">
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
  )
  return { test, bar, empty, active: !!q.trim() || !!from }
}

/** The places visited, in the order first visited: three shown, the rest counted. */
export function PlaceChips({ places }: { places?: string[] }) {
  if (!places?.length) return null
  const more = places.length - 3
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5" title={places.join(' · ')}>
      {places.slice(0, 3).map(p => (
        <span key={p} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-800">
          <MapPin className="h-3 w-3 shrink-0 text-cyrixRed-600" /><span className="truncate">{p}</span>
        </span>
      ))}
      {more > 0 && <span className="text-xs text-ink-500">+{more}</span>}
    </span>
  )
}
