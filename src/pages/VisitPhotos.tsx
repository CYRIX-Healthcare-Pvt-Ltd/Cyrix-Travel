import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, CloudUpload, LayoutGrid, MapPin, Trash2, X } from 'lucide-react'
import VisitCamera from '@/components/VisitCamera'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { clock, deletePhoto, flushQueue, lateBy, queued, useMyPhotos, usePhotoUrls, useVisitSetup, type VisitPhoto } from '@/lib/visits'

/*
  Visit photos (te_0082): a photo of each hospital reached, taken here in the app's camera; a ride for a purpose that
  needs one picks it up by itself when it is the same day and near where the ride went. This month, or From – To
  (the user, 28 Oct: "Never need last month, custom").
*/
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const now = new Date(), today = ymd(now)
const thisMonth = { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
/*
  Photos per row, 2 to 5, kept on this phone (the user, 30 Oct: "add photo grid size option also ie 2 per row, 3,4,5").
  From 4 a row the photo carries only its time; a press opens it with the place.
*/
const COLS = { 2: 'grid-cols-2 gap-2', 3: 'grid-cols-3 gap-2', 4: 'grid-cols-4 gap-1.5', 5: 'grid-cols-5 gap-1' } as const
type Cols = keyof typeof COLS
const COLS_KEY = 'te.photoCols'
const keptCols = (): Cols => { try { const n = Number(localStorage.getItem(COLS_KEY)); return n in COLS ? (n as Cols) : 2 } catch { return 2 } }

export default function VisitPhotos() {
  const { employee } = useAuth()
  const ask = useAsk()
  const qc = useQueryClient()
  const { data: setup, isLoading: loadingSetup } = useVisitSetup()
  const [custom, setCustom] = useState(false)
  const [span, setSpan] = useState({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: today })
  const { from, to } = custom ? (span.from <= span.to ? span : { from: span.to, to: span.from }) : thisMonth
  const { data, isLoading } = useMyPhotos(from, to)
  const urls = usePhotoUrls((data ?? []).map(p => p.path)).data ?? {}
  const [camera, setCamera] = useState(false)
  const [note, setNote] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [open, setOpen] = useState<VisitPhoto | null>(null)
  const [cols, setCols] = useState<Cols>(keptCols)
  const pickCols = (n: Cols) => { setCols(n); try { localStorage.setItem(COLS_KEY, String(n)) } catch { /* kept for this visit only */ } }

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['te_my_photos'] }), [qc])
  // What waited for a signal goes when the page opens and whenever the phone comes back online.
  const flush = useCallback(async () => {
    if (!employee) return
    const { sent, refused } = await flushQueue(employee.id)
    setWaiting((await queued(employee.id)).length)
    if (sent) { await refresh(); setNote({ kind: 'success', text: sent === 1 ? 'The waiting photo is sent' : `${sent} waiting photos are sent` }) }
    if (refused.length) setNote({ kind: 'error', text: refused.join('\n') })
  }, [employee, refresh])
  useEffect(() => {
    void flush()
    const on = () => void flush()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [flush])

  if (loadingSetup) return <PageLoader />
  if (!setup?.on) return <Navigate to="/" replace />

  const remove = async (p: VisitPhoto) => {
    if (!(await ask.confirm({ title: 'Delete this photo?', body: `${p.place ?? 'Visit photo'} · ${clock(p.shot_at)}`, yes: 'Delete', danger: true }))) return
    try { await deletePhoto(p.id); setOpen(null); await refresh() } catch (e) { await ask.alert('Not deleted', (e as Error).message, 'warn') }
  }
  const days = [...new Set((data ?? []).map(p => p.day))]

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><Camera className="h-5 w-5 text-rose-600" /> Visit photos</h1>
      <button type="button" className="btn-primary btn-go h-12 w-full text-base sm:w-auto sm:px-6" onClick={() => { setNote(null); setCamera(true) }}>
        <Camera className="h-5 w-5" /> Take visit photo
      </button>
      {note && <Alert kind={note.kind}>{note.text}</Alert>}
      {waiting > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          <CloudUpload className="h-4 w-4" />{waiting === 1 ? '1 photo waiting for signal' : `${waiting} photos waiting for signal`}
          <button type="button" className="ml-auto text-sm font-semibold underline" onClick={() => void flush()}>Send now</button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl bg-ink-100 p-1" role="tablist">
          {([[false, 'This month'], [true, 'Custom']] as const).map(([k, l]) => (
            <button key={l} type="button" role="tab" aria-selected={custom === k} onClick={() => setCustom(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold sm:px-4 ${custom === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>{l}</button>
          ))}
        </div>
        <div className="inline-flex items-center rounded-xl bg-ink-100 p-1" role="group" aria-label="Photos per row">
          <LayoutGrid className="mx-1.5 h-4 w-4 text-ink-500" aria-hidden />
          {([2, 3, 4, 5] as const).map(n => (
            <button key={n} type="button" aria-pressed={cols === n} aria-label={`${n} photos per row`} onClick={() => pickCols(n)}
              className={`h-8 w-8 rounded-lg text-sm font-semibold ${cols === n ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>{n}</button>
          ))}
        </div>
      </div>
      {custom && (
        <div className="grid max-w-md grid-cols-2 gap-2">
          <label className="block"><span className="label">From</span>
            <input type="date" className="input mt-1" max={today} value={span.from} onChange={e => e.target.value && setSpan({ ...span, from: e.target.value })} /></label>
          <label className="block"><span className="label">To</span>
            <input type="date" className="input mt-1" max={today} value={span.to} onChange={e => e.target.value && setSpan({ ...span, to: e.target.value })} /></label>
        </div>
      )}

      {isLoading ? <PageLoader /> : days.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">No visit photos {custom ? 'in these dates' : 'this month'}.</div>
      ) : days.map(day => {
        const list = (data ?? []).filter(p => p.day === day)
        return (
          <section key={day} className="space-y-2">
            <h2 className="text-sm font-semibold text-ink-700">
              {new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              <span className="ml-2 text-xs font-normal text-ink-500">{list.length} {list.length === 1 ? 'photo' : 'photos'}</span>
            </h2>
            <div className={`grid ${COLS[cols]}`}>
              {list.map(p => {
                const late = lateBy(p)
                return (
                  <button key={p.id} type="button" className={`card overflow-hidden text-left ${cols >= 4 ? '!rounded-lg' : ''}`} onClick={() => setOpen(p)}>
                    <div className={`relative bg-ink-100 ${cols >= 4 ? 'aspect-square' : 'aspect-[4/3]'}`}>
                      {p.path && urls[p.path] ? <img src={urls[p.path]} alt={p.place ?? 'Visit photo'} className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center p-1 text-center text-xs text-ink-400">{p.path ? '' : cols >= 4 ? '' : 'Removed after payment'}</div>}
                      {cols >= 4 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-medium leading-4 text-white">{clock(p.shot_at)}</span>}
                    </div>
                    {cols < 4 && <div className={`space-y-0.5 ${cols === 3 ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                      <p className="truncate text-sm font-semibold text-ink-900">{p.place ?? 'Place not named'}</p>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
                        {clock(p.shot_at)}
                        {p.on && <span className={`rounded px-1.5 py-px font-semibold ${p.on === 'draft' ? 'bg-ink-100 text-ink-700' : 'bg-sky-100 text-sky-800'}`}>{p.on === 'draft' ? 'On a draft' : `On ${p.on}`}</span>}
                        {late && <span className="font-semibold text-amber-700">{late}</span>}
                      </p>
                    </div>}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3" role="dialog" aria-label="Visit photo" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between gap-2 text-white" onClick={e => e.stopPropagation()}>
            <p className="min-w-0 truncate text-sm font-semibold"><MapPin className="mr-1 inline h-4 w-4" />{open.place ?? 'Place not named'} · {clock(open.shot_at)}</p>
            <span className="flex shrink-0 gap-2">
              {(!open.on || open.on === 'draft') && <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/15" aria-label="Delete this photo" onClick={() => void remove(open)}><Trash2 className="h-4 w-4" /></button>}
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/15" aria-label="Close" onClick={() => setOpen(null)}><X className="h-4 w-4" /></button>
            </span>
          </div>
          {open.path && urls[open.path] && <img src={urls[open.path]} alt={open.place ?? 'Visit photo'} className="mt-3 min-h-0 flex-1 object-contain" />}
        </div>
      )}

      {camera && <VisitCamera onClose={() => setCamera(false)} onDone={(text, q) => { setCamera(false); setNote({ kind: q ? 'info' : 'success', text }); void refresh(); if (q && employee) void queued(employee.id).then(l => setWaiting(l.length)) }} />}
    </div>
  )
}
