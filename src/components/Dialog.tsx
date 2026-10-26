import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * A small question over the page: the expected date when a repair is
 * accepted, a confirmation before scrap, a bill to attach.
 *
 * A sheet from the bottom on a phone, where the thumb is; a card in the
 * middle on a computer. Escape or the cross closes it — a tap outside does not, so a question or a place half
 * chosen is not lost to a stray tap (the user, 22 Oct) — and
 * the page behind does not scroll while it is open.
 */
export default function Dialog({
  title, icon, children, onClose, wide = false, huge = false,
}: {
  /** A map: much wider on a computer (the user, 17 Oct), and one screen tall with no scroll — the map takes what the
      rest leaves, so the buttons under it are always in sight (the user, 26 Oct: "we dont need scroll in map pop up,
      bcz something the below buttons not visible, same for mobile also"). */
  huge?: boolean
  title: string
  icon?: ReactNode
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    // The first field, so a date or an amount can be typed straight away.
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-shade/60 sm:items-center sm:p-4"
    >
      <div
        ref={panel}
        onClick={e => e.stopPropagation()}
        className={`animate-pop-in w-full rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl ${huge ? 'flex h-[90dvh] flex-col overflow-y-auto sm:max-w-5xl' : wide ? 'max-h-[90vh] overflow-y-auto sm:max-w-xl' : 'max-h-[90vh] overflow-y-auto sm:max-w-md'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-base font-semibold text-ink-900">{icon}{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-press -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={huge ? 'mt-4 flex min-h-0 flex-1 flex-col' : 'mt-4 space-y-3'}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
