import { useRef, useState } from 'react'
import { FileText, FileUp, X } from 'lucide-react'
import { Spinner } from '@/components/ui'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'
import { billUrl, uploadReport, type Bill } from '@/lib/claims'
import { supabase } from '@/lib/supabase'

/*
  A ticket's service report, a PDF or a photo (te_0037; the user, 21 Oct: "need option to update
  service report, it may be in pdf / image"). Opened in the app like a bill; replaced by removing it
  and attaching another.
*/
export default function ReportButton({ claimId, ticketId, bills, editable, onChange, large = false }: {
  claimId: string
  ticketId: string
  bills: Bill[]
  editable: boolean
  onChange: () => void
  /** Thumb-sized, for the day form. */
  large?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const ask = useAsk()
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const mine = bills.filter(b => b.owner_id === ticketId && b.owner_kind === 'report')
  const h = large ? 'h-10 rounded-lg px-3 text-sm' : 'h-7 rounded-md px-2 text-xs'

  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { await uploadReport(claimId, ticketId, f); onChange() }
    catch (e) { void ask.alert('Service report not attached', (e as Error).message, 'warn') }
    finally { setBusy(false) }
  }
  const remove = async (b: Bill) => {
    const { data: path, error } = await supabase.rpc('te_remove_bill', { p_bill: b.id })
    if (error) { void ask.alert('Not removed', error.message, 'warn'); return }
    if (path) await supabase.storage.from('te-bills').remove([path as string])
    onChange()
  }
  const open = async (b: Bill) => { const u = await billUrl(b.path); if (u) setViewing({ url: u, name: b.name ?? 'Service report' }) }

  if (!mine.length && !editable) return null
  return (
    <span className="inline-flex items-center gap-1">
      {mine.map(b => (
        <span key={b.id} className={`inline-flex shrink-0 items-center gap-1 bg-sky-100 font-semibold text-sky-800 ${h}`}>
          <button type="button" className="inline-flex items-center gap-1 hover:underline" title={b.name ?? 'Service report'} onClick={() => void open(b)}>
            <FileText className="h-3.5 w-3.5" />Service report
          </button>
          {editable && <button type="button" aria-label="Remove service report" className="ml-0.5 opacity-70 hover:opacity-100" onClick={() => void remove(b)}><X className="h-3.5 w-3.5" /></button>}
        </span>
      ))}
      {editable && !mine.length && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-sky-300 font-semibold text-sky-800 hover:bg-sky-50 ${h}`}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <FileUp className="h-3.5 w-3.5" />}Service report
        </button>
      )}
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </span>
  )
}
