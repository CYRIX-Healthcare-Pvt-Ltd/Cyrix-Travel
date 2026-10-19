import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MODES, MODE_ORDER, type ModeCode } from '@/lib/claims'

/*
  The ride's mode as one compact dropdown (the user, 17 Oct: "only selected option need color, is it
  better in dropdown?"): the chosen mode in its colour; the list shows every mode with its icon.
*/
export default function ModePicker({ value, onChange, blocked }: { value: ModeCode; onChange: (m: ModeCode) => void; blocked?: (m: ModeCode) => boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const m = MODES[value], I = m.icon
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="btn-lift inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold" style={{ background: m.color + '1F', borderColor: m.color + '4D', color: m.color }}>
        <I className="h-4 w-4" />{m.label}<ChevronDown className="h-3.5 w-3.5 opacity-80" />
      </button>
      {/* Out of the grade's policy: a mark that cannot be missed (the user, 18 Oct). */}
      {blocked?.(value) && <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-cyrixRed-600 text-xs font-bold text-white ring-2 ring-[rgb(var(--surface))]" aria-label="Not in your grade's policy">!</span>}
      {open && (
        <div role="listbox" className="absolute left-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-ink-200 bg-surface py-1 shadow-lg">
          {MODE_ORDER.map(code => {
            const mm = MODES[code], Ic = mm.icon
            return (
              <button key={code} type="button" role="option" aria-selected={code === value}
                onClick={() => { onChange(code); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 ${code === value ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
                <Ic className="h-4 w-4" style={{ color: mm.color }} />{mm.label}
                {blocked?.(code) && <span className="ml-auto grid h-4 w-4 place-items-center rounded-full bg-cyrixRed-600 text-[10px] font-bold text-white" title="Not in your grade's policy">!</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
