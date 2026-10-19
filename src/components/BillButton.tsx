import { useRef, useState } from 'react'
import { Copy, FileText, Paperclip, TriangleAlert, X } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { billUrl, inkVars, readBill, uploadBill, money, type Bill } from '@/lib/claims'
import { supabase } from '@/lib/supabase'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'

/*
  The bills on one ride, hotel night or expense. Attaching reads the amount off a photo with the
  free reader in the phone (the user, 17 Oct) and hands it back to fill the amount; the same file
  twice is refused, naming the claim it was used on; a look-alike is flagged for the approvers.
*/
export default function BillButton({ claimId, kind, ownerId, bills, needed, editable, onRead, onChange, compact = false, large = false, claimed, part = 'both', accent }: {
  /** Only the paperclip, or only the bills (the day form shows the bills on their own line). */
  part?: 'both' | 'attach' | 'bills'
  /** The colour a needed bill's paperclip wears: a ride's mode, instead of amber. */
  accent?: { color: string; onDark: string }
  /** The amount claimed, to set against what the bill reads (the user, 18 Oct). */
  claimed?: number | null
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

  // On a line of figures the clip comes first, so the clips stand in one column (the user, 19 Oct).
  const clip = editable && part !== 'bills' && (
    <button type="button" disabled={!!busy} onClick={() => input.current?.click()} title={busy ?? (needed ? 'Bill needed' : 'Attach bill')} aria-label="Attach bill"
      style={needed && !mine.length && accent ? { borderColor: accent.color + '99', background: accent.color + '14', ...inkVars(accent) } : undefined}
      className={`grid ${large ? 'h-10 w-10 rounded-lg' : 'h-7 w-7 rounded-md'} shrink-0 place-items-center border ${needed && !mine.length ? (accent ? 'mode-ink' : 'border-amber-400 bg-amber-50 text-amber-700') : 'border-ink-200 text-ink-500 hover:bg-ink-100'}`}>
      {busy ? <Spinner className="h-3 w-3" /> : <Paperclip className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
    </button>
  )
  if (compact) return (
    <span className="inline-flex items-center gap-1">
      {!large && clip}
      {/* Each bill says what it reads (the user, 18 Oct: "the approver should see easily that this is the
          amount fetched"): green when it matches the claim, amber with a mark when it does not. */}
      {part !== 'attach' && mine.map(b => {
        const read = b.ocr_amount != null ? Number(b.ocr_amount) : null
        const off = read != null && claimed != null && Math.abs(read - claimed) > 1
        return (
          <button key={b.id} type="button" onClick={() => void open(b)}
            title={b.twin ? `Looks like ${b.twin}` : off ? `The bill reads ${money(read)} · claimed ${money(claimed)}` : read != null ? `The bill reads ${money(read)}` : 'Bill · the amount could not be read'}
            className={`inline-flex shrink-0 items-center gap-1 font-semibold ${large ? 'h-10 rounded-lg px-2.5 text-sm' : 'h-7 rounded-md px-2 text-xs'} ${b.twin ? 'bg-cyrixRed-100 text-cyrixRed-800' : off ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' : 'bg-green-100 text-green-800'}`}>
            <FileText className="h-3.5 w-3.5" />{read != null ? money(read) : 'Bill'}{off && <TriangleAlert className="h-3.5 w-3.5" />}
          </button>
        )
      })}
      {large && clip}
      {editable && part !== 'bills' && !large && needed && !mine.length && !busy && (
        <button type="button" onClick={() => input.current?.click()} className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md bg-cyrixRed-100 px-2 text-xs font-semibold text-cyrixRed-800 hover:bg-cyrixRed-200">Bill needed</button>
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
