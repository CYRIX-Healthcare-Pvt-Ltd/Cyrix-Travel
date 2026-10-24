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

export default function MonthCalendar({ value, onChange, min, max, marked = [], taken = {}, drafts = {}, approved = {}, legend = false }: {
  value: string; onChange: (v: string) => void; min: string; max: string; marked?: string[]
  /** Dates already in another claim, and which: shown struck through, not chosen (te_0060: one claim a day). */
  taken?: Record<string, string>
  /** Dates in a claim still open to change, and which: edged blue, and still chosen (te_0069; the user, 24 Oct:
      "24th should be in diff color ie draft"). */
  drafts?: Record<string, string>
  /** Dates in an approved or paid claim, and which: green, not chosen (te_0070). */
  approved?: Record<string, string>
  /** A row naming the colours under the days (the user, 24 Oct: "all should be unique" — "A, keep legend"). */
  legend?: boolean
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
          const used = taken[d], ok = approved[d], draft = drafts[d], off = d > max || d < min || !!used || !!ok, on = d === value
          // Each its own colour: today ringed pink, the chosen day violet, a draft's blue, one sent and waiting yellow, an
          // approved one green; all but a draft a tint inside their edge (the user, 24 Oct: "same as like green";
          // "make today pink and sent yellow").
          return (
            <button key={d} type="button" disabled={off} onClick={() => onChange(d)} title={used || ok ? `Claimed in ${used ?? ok}` : draft ? `In your ${draft}` : undefined}
              className={clsx('relative grid h-9 place-items-center rounded-lg text-sm',
                on ? (draft ? 'border-2 border-blue-500 bg-blue-500/15 font-semibold text-blue-800' : 'border-2 border-violet-500 bg-violet-500/15 font-semibold text-violet-800')
                  : ok ? 'border-2 border-green-500 bg-green-500/15 text-green-800' : used ? 'border-2 border-yellow-400 bg-yellow-400/15 text-yellow-800'
                  : off ? 'text-ink-300' : draft ? 'border-2 border-dashed border-blue-400 font-semibold text-blue-800 hover:bg-blue-500/10' : 'text-ink-800 hover:bg-ink-100',
                d === today && !on && 'ring-2 ring-pink-500')}>
              {Number(d.slice(8))}
              {marks.has(d) && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-teal-500" />}
            </button>
          )
        })}
      </div>
      {legend && (
        // Small type (the user, 24 Oct: "make legends small by 2 ie font size"); spread across, it looked worse.
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[9px] text-ink-500">
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded ring-2 ring-inset ring-pink-500" />Today</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded border-2 border-violet-500 bg-violet-500/15" />Picked</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded border-2 border-dashed border-blue-400" />Draft</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded border-2 border-yellow-400 bg-yellow-400/15" />Sent</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-3.5 rounded border-2 border-green-500 bg-green-500/15" />Approved</span>
        </div>
      )}
    </div>
  )
}
