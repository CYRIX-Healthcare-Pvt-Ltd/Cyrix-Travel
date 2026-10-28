import { useState } from 'react'
import { ImageOff, X } from 'lucide-react'
import { usePhotoUrls } from '@/lib/visits'

/** A visit photo small beside its ride; a press shows it whole (approvers read the stamp on it). */
export default function VisitThumb({ path, label, className = 'h-10 w-10' }: { path: string | null; label: string; className?: string }) {
  const url = usePhotoUrls([path]).data?.[path ?? '']
  const [open, setOpen] = useState(false)
  if (!path) return <span className={`grid shrink-0 place-items-center rounded-md bg-ink-100 text-ink-400 ${className}`} title="Removed after payment"><ImageOff className="h-4 w-4" /></span>
  return (
    <>
      <button type="button" className={`shrink-0 overflow-hidden rounded-md bg-ink-100 ring-1 ring-ink-200 ${className}`} aria-label={`Open the visit photo of ${label}`} onClick={e => { e.stopPropagation(); setOpen(true) }}>
        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3" role="dialog" aria-label={label} onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between gap-2 text-white">
            <p className="min-w-0 truncate text-sm font-semibold">{label}</p>
            <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          {url && <img src={url} alt={label} className="mt-3 min-h-0 flex-1 object-contain" />}
        </div>
      )}
    </>
  )
}
