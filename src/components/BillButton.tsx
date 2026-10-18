import { useRef, useState } from 'react'
import { Copy, FileText, Paperclip, X } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { billUrl, readBill, uploadBill, money, type Bill } from '@/lib/claims'
import { supabase } from '@/lib/supabase'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'

/*
  The bills on one ride, hotel night or expense. Attaching reads the amount off a photo with the
  free reader in the phone (the user, 17 Oct) and hands it back to fill the amount; the same file
  twice is refused, naming the claim it was used on; a look-alike is flagged for the approvers.
*/
export default function BillButton({ claimId, kind, ownerId, bills, needed, editable, onRead, onChange, compact = false, large = false }: {
  compact?: boolean
  /** Thumb-sized, for the day form on a phone. */
  large?: boolean
  claimId: string
  kind: Bill['owner_kind']
  ownerId: string
  bills: Bill[]
  needed: boolean
  editable: boolean
  onRead?: (amount: number) => void
  onChange: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const ask = useAsk()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const mine = bills.filter(b => b.owner_id === ownerId)

  const pick = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    try {
      setBusy('Reading the bill…')
      const read = await readBill(f).catch(() => ({ amount: null, date: null, billno: null }))
      if (read.amount && onRead) onRead(read.amount)
      setBusy('Attaching…')
      await uploadBill(claimId, kind, ownerId, f, read)
      onChange()
    } catch (e) { setErr((e as Error).message); if (compact) void ask.alert('Bill not attached', (e as Error).message) } finally { setBusy(null) }
  }
  // Opened in the app, never in another tab (the user, 17 Oct).
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const open = async (b: Bill) => { const u = await billUrl(b.path); if (u) setViewing({ url: u, name: b.name ?? 'Bill' }) }
  const viewer = viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />
  const remove = async (b: Bill) => {
    const { data: path, error } = await supabase.rpc('te_remove_bill', { p_bill: b.id })
    if (error) { setErr(error.message); return }
    if (path) await supabase.storage.from('te-bills').remove([path as string])
    onChange()
  }

  if (compact) return (
    <span className="inline-flex items-center gap-1">
      {mine.map(b => (
        <button key={b.id} type="button" onClick={() => void open(b)} title={b.twin ? `Looks like ${b.twin}` : b.name ?? 'Bill'}
          className={`${editable ? `grid ${large ? 'h-10 w-10 rounded-lg' : 'h-7 w-7 rounded-md'} place-items-center` : 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold'} ${b.twin ? 'bg-cyrixRed-100 text-cyrixRed-700' : 'bg-green-100 text-green-700'}`}><FileText className="h-3.5 w-3.5" />{!editable && 'Bill'}</button>
      ))}
      {editable && (
        <button type="button" disabled={!!busy} onClick={() => input.current?.click()} title={busy ?? (needed ? 'Bill needed' : 'Attach bill')} aria-label="Attach bill"
          className={`grid ${large ? 'h-10 w-10 rounded-lg' : 'h-7 w-7 rounded-md'} shrink-0 place-items-center border ${needed && !mine.length ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-ink-200 text-ink-500 hover:bg-ink-100'}`}>
          {busy ? <Spinner className="h-3 w-3" /> : <Paperclip className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
        </button>
      )}
      {!editable && needed && !mine.length && <span className="text-xs text-amber-700">No bill</span>}
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      {err && <span className="text-xs font-bold text-cyrixRed-700" title={err}>!</span>}
      {viewer}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.map(b => (
        <span key={b.id} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${b.twin ? 'bg-cyrixRed-100 text-cyrixRed-900' : 'bg-green-100 text-green-900'}`}>
          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => void open(b)} title={b.name ?? 'Bill'}>
            <FileText className="h-3.5 w-3.5" /> Bill{b.ocr_amount ? ` · ${money(b.ocr_amount)}` : ''}
          </button>
          {b.twin && <span className="inline-flex items-center gap-0.5 font-semibold"><Copy className="h-3 w-3" /> Looks like {b.twin}</span>}
          {editable && <button type="button" onClick={() => void remove(b)} aria-label="Remove bill" className="ml-0.5 opacity-70 hover:opacity-100"><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {editable && (
        <>
          <button type="button" disabled={!!busy} onClick={() => input.current?.click()}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${needed && !mine.length ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}>
            {busy ? <Spinner className="h-3 w-3" /> : <Paperclip className="h-3.5 w-3.5" />}
            {busy ?? (mine.length ? 'Another bill' : needed ? 'Bill needed' : 'Attach bill')}
          </button>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
        </>
      )}
      {!editable && needed && !mine.length && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No bill</span>}
      {err && <span className="w-full text-xs text-cyrixRed-700">{err}</span>}
      {viewer}
    </div>
  )
}
