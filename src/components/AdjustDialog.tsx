import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { money, useClaimAction } from '@/lib/claims'

/*
  Whoever the claim waits on changes one figure (te_0027; the user, 18 Oct: "if manager / coord /
  travel desk doesn't feel he claimed correct they can edit"): the km of a bike or car ride, which
  sets its amount, or the rupees of anything else. A reason is asked for; it goes into the history
  and to the person.
*/
export interface AdjustTarget {
  kind: 'ride' | 'hotel' | 'expense' | 'da'; id: string; label: string
  unit: 'km' | '₹'; value: number; amount: number; rate?: number
}

export default function AdjustDialog({ claimId, target, onClose }: { claimId: string; target: AdjustTarget; onClose: () => void }) {
  const act = useClaimAction()
  const [v, setV] = useState(String(target.value))
  const [why, setWhy] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const n = Number(v)
  const km = target.unit === 'km'
  const save = async () => {
    setErr(null)
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) { setErr('Type the new figure'); return }
    if (!why.trim()) { setErr('Say why it is changed'); return }
    try {
      await act.mutateAsync({ fn: 'te_adjust', args: { p_claim: claimId, p_kind: target.kind, p_item: target.id, p_value: n, p_reason: why } })
      // The person's phone hears of it now, not at the next 5-minute round.
      void supabase.functions.invoke('push', { body: { action: 'travel' } }).catch(() => undefined)
      onClose()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <Dialog title="Change the amount" icon={<PencilLine className="h-5 w-5 text-violet-600" />} onClose={onClose}>
      <div className="mt-3 space-y-3">
        <div className="rounded-lg bg-ink-50 px-3 py-2 text-sm">
          <p className="font-medium text-ink-900">{target.label}</p>
          <p className="text-ink-600">Claimed {km ? `${target.value} km · ${money(target.amount)}` : money(target.value)}</p>
        </div>
        <label className="block"><span className="label">{km ? 'Km' : 'Amount'}</span>
          <span className="mt-1 flex items-center gap-3">
            <span className="relative block w-40">
              {!km && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>}
              <input type="number" inputMode="decimal" min={0} step={km ? '0.1' : '1'} autoFocus className={`input h-11 ${km ? 'pr-9' : 'pl-7'}`} value={v} onChange={e => setV(e.target.value)} />
              {km && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">km</span>}
            </span>
            {km && Number.isFinite(n) && <span className="text-sm font-semibold text-ink-900">= {money(n * (target.rate ?? 0))}</span>}
          </span></label>
        <label className="block"><span className="label">Why</span>
          <textarea rows={2} className="input mt-1" value={why} onChange={e => setWhy(e.target.value)} placeholder="Reason for the change" /></label>
        {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={act.isPending} onClick={() => void save()}>{act.isPending && <Spinner className="h-4 w-4" />} Save change</button>
        </div>
      </div>
    </Dialog>
  )
}
