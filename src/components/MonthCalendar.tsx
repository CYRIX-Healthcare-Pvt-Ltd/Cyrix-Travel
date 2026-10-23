import { useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/*
  A calendar shown open, so a day is one tap (the user, 17 Oct: "show calendar, bcz for calendar I
  need to click calendar again"). Today is ringed, the chosen day filled; days after `max` and
  before `min` cannot be chosen; days already claimed carry a dot.
*/
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const iso = (d: Date) => d.toLocaleDateString('en-CA')

export default function MonthCalendar({ value, onChange, min, max, marked = [], taken = {} }: {
  value: string; onChange: (v: string) => void; min: string; max: string; marked?: string[]
  /** Dates already in another claim, and which: shown struck through, not chosen (te_0060: one claim a day). */
  taken?: Record<string, string>
}) {
  const [view, setView] = useState(() => { const d = new Date((value || max) + 'T00:00:00'); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(view.getFullYear(), view.getMonth(), i + 1)))]
  const today = iso(new Date())
  const canPrev = iso(new Date(view.getFullYear(), view.getMonth(), 0)) >= min
  const canNext = iso(new Date(view.getFullYear(), view.getMonth() + 1, 1)) <= max
  const marks = new Set(marked)
  return (
    <div className="select-none rounded-xl border border-ink-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="btn-icon" disabled={!canPrev} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} aria-label="Earlier month"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold text-ink-900">{view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="btn-icon" disabled={!canNext} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} aria-label="Later month"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map(d => <span key={d} className="py-1 text-[11px] font-semibold text-ink-400">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const used = taken[d], off = d > max || d < min || !!used, on = d === value
          return (
            <button key={d} type="button" disabled={off} onClick={() => onChange(d)} title={used ? `Claimed in ${used}` : undefined}
              className={clsx('relative grid h-9 place-items-center rounded-lg text-sm',
                on ? 'bg-amber-500 font-semibold text-white' : used ? 'bg-ink-100 text-ink-400 line-through' : off ? 'text-ink-300' : 'text-ink-800 hover:bg-ink-100',
                d === today && !on && 'ring-2 ring-amber-400')}>
              {Number(d.slice(8))}
              {marks.has(d) && <span className={clsx('absolute bottom-1 h-1 w-1 rounded-full', on ? 'bg-white' : 'bg-teal-500')} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
