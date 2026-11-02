import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { TONE_SOFT, type Tone } from '@/lib/tones'
import { useBackCloses } from '@/lib/useBackCloses'

export interface PickOption { value: string; label: string; icon: LucideIcon; tone: Tone; hint?: string }

/*
  A dropdown in the app's own dress (the user, 2 Nov: "Make dropdown beautiful"): the choice on the box with its icon
  and colour. On a phone the list rises from the bottom as large rows a thumb can hit; on a computer it drops under the
  box, and the arrow keys and Enter work as in a plain dropdown.
*/
export default function PickList({ id, value, options, placeholder, title, onChange, alarm = false, tall = false, label }: {
  /** For the form's "bring it into view": the box itself carries it. */
  id?: string
  value: string | null | undefined
  options: PickOption[]
  placeholder: string
  /** The sheet's heading on a phone: "Purpose of ride 2". */
  title: string
  onChange: (value: string) => void
  /** Pointed at by the form (Add another ride): red. */
  alarm?: boolean
  tall?: boolean
  label: string
}) {
  const [open, setOpen] = useState<null | 'sheet' | 'drop'>(null)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState({ up: false, right: false })
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const chosen = options.find(o => o.value === value) ?? null
  const Icon = chosen?.icon

  const show = () => {
    const r = button.current?.getBoundingClientRect()
    if (r) {
      const room = Math.min(options.length * 44 + 12, 320)
      setPlace({ up: window.innerHeight - r.bottom < room && r.top > window.innerHeight - r.bottom, right: r.left + 240 > window.innerWidth - 8 })
    }
    setActive(Math.max(0, options.findIndex(o => o.value === value)))
    setOpen(window.matchMedia('(max-width: 639px)').matches ? 'sheet' : 'drop')
  }
  const close = () => setOpen(null)
  const pick = (v: string) => { if (v !== value) onChange(v); setOpen(null); button.current?.focus() }

  // A press anywhere else shuts the list on a computer.
  useEffect(() => {
    if (open !== 'drop') return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  // The row the arrows are on stays in sight.
  useEffect(() => {
    if (open === 'drop') list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKey = (e: React.KeyboardEvent) => {
    if (open !== 'drop') {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[active]; if (o) pick(o.value) }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(null)
  }

  return (
    <div ref={box} className="relative min-w-0">
      <button
        ref={button}
        id={id}
        type="button"
        aria-label={`${label}: ${chosen?.label ?? 'not chosen'}`}
        aria-haspopup="listbox"
        aria-expanded={!!open}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        className={`input flex w-full min-w-0 items-center gap-2 !pr-2 text-left text-sm [background-color:Field] ${tall ? 'h-11' : 'h-10'} ${chosen ? '' : '!border-amber-400'} ${alarm ? '!border-cyrixRed-500 ring-2 ring-cyrixRed-500' : ''}`}
      >
        {chosen && Icon
          ? <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${TONE_SOFT[chosen.tone]}`}><Icon className="h-3.5 w-3.5" /></span>
          : null}
        <span className={`min-w-0 flex-1 truncate ${chosen ? 'font-medium text-ink-900' : 'text-ink-500'}`}>{chosen?.label ?? placeholder}</span>
        {chosen?.hint && <span className="shrink-0 text-xs font-semibold text-ink-500">{chosen.hint}</span>}
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open === 'drop' && (
        <div
          ref={list}
          role="listbox"
          aria-label={label}
          className={`pick-drop absolute z-30 max-h-80 w-full min-w-[14rem] overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1 shadow-xl ${place.up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${place.right ? 'right-0' : 'left-0'}`}
        >
          {options.map((o, i) => {
            const On = o.icon, picked = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={picked}
                data-i={i}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${i === active ? 'bg-ink-100' : ''} ${picked ? 'font-semibold text-ink-900' : 'text-ink-800'}`}
              >
                <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TONE_SOFT[o.tone]}`}><On className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs font-medium text-ink-500">{o.hint}</span>}
                <Check aria-hidden className={`h-4 w-4 shrink-0 text-ink-900 ${picked ? '' : 'invisible'}`} strokeWidth={3} />
              </button>
            )
          })}
        </div>
      )}

      {open === 'sheet' && <Sheet title={title} options={options} value={value} onPick={pick} onClose={close} />}
    </div>
  )
}

/** The phone's list: a sheet from the bottom, a row a choice, the phone's Back shuts it. */
function Sheet({ title, options, value, onPick, onClose }: {
  title: string; options: PickOption[]; value: string | null | undefined; onPick: (v: string) => void; onClose: () => void
}) {
  useBackCloses(onClose)
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return createPortal(
    <div className="ask-shade fixed inset-0 z-50 flex items-end bg-shade/60" onClick={onClose}>
      <div
        role="listbox"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="ask-panel max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-surface px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 shadow-2xl"
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-ink-200" />
        <p className="px-2 pb-2 text-base font-semibold text-ink-900">{title}</p>
        {options.map(o => {
          const On = o.icon, picked = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={picked}
              onClick={() => onPick(o.value)}
              className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl px-2 text-left text-base active:bg-ink-100 ${picked ? 'bg-ink-50 font-semibold text-ink-900' : 'text-ink-800'}`}
            >
              <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONE_SOFT[o.tone]}`}><On className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">{o.label}</span>
              {o.hint && <span className="shrink-0 text-sm font-medium text-ink-500">{o.hint}</span>}
              {picked && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900"><Check className="h-4 w-4" style={{ color: 'rgb(var(--surface))' }} strokeWidth={3} /></span>}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
