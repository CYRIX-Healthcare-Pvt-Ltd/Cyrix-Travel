import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Paperclip, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader } from '@/components/ui'
import { STATUS, STATUS_HUE, claimName, dayRange, editable, km, money, rpc, useMyClaims, type ClaimData } from '@/lib/claims'
import AddClaim from '@/components/AddClaim'
import { PlaceChips, useClaimFilter } from '@/components/ClaimRows'

/*
  The person's claims, a month each (the user, 17 Oct: report periods are calendar months). This
  month's is opened, or made, with one press; last month's too while it can still be sent.
*/
export default function Months() {
  const nav = useNavigate()
  const { data, isLoading, error } = useMyClaims()
  const qc = useQueryClient()
  const ask = useAsk()
  const [err, setErr] = useState<string | null>(null)
  const find = useClaimFilter('te.claims')
  // Deleting a claim (the user, 17 Oct): at once while it is a draft or recalled; otherwise the manager approves (claim page).
  const remove = async (id: string, label: string) => {
    if (!(await ask.confirm({ title: 'Delete this claim?', body: `The ${label} claim and everything on it will be deleted.`, yes: 'Delete claim', danger: true }))) return
    setErr(null)
    try {
      // The bills first: once the claim is gone, storage has nothing left to allow removing them.
      const paths = (await rpc<ClaimData>('te_claim', { p_claim: id })).bills.map(b => b.path)
      if (paths.length) await supabase.storage.from('te-bills').remove(paths)
      await rpc('te_delete_claim', { p_claim: id })
      await qc.invalidateQueries({ queryKey: ['te_my_claims'] })
    } catch (e) { setErr((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  const shown = (data ?? []).filter(find.test)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ReceiptText className="h-5 w-5 text-amber-600" /> My claims</h1>
        <div className="flex flex-wrap gap-2">
          <AddClaim />
        </div>
      </div>
      {(err || error) && <Alert kind="error">{err ?? (error as Error).message}</Alert>}
      {(data?.length ?? 0) > 0 && find.bar}
      {!data?.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">No claims yet. Start this month's, then add each day you travelled.</div>
      ) : !shown.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">{find.empty}</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {shown.map(c => {
            const s = STATUS[c.status] ?? STATUS.draft
            return (
              /* One grid for every row (the user, 18 Oct: "doesn't look uniform"): on a phone the number and
                 amount on top, the status and buttons under; on a computer one line in fixed columns. */
              <Link key={c.id} to={`/claim/${c.id}`} style={{ borderLeft: `4px solid ${STATUS_HUE[c.status] ?? STATUS_HUE.draft}` }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-ink-100/60 sm:grid-cols-[minmax(0,1fr)_11rem_6rem_7.5rem] lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_11rem_6rem_7.5rem]">
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="text-base font-bold text-ink-900">{c.number ?? 'Not sent yet'}</span>
                    <span className="text-sm text-ink-500">{claimName(c.month, c.part)}</span>
                  </p>
                  <p className="truncate text-xs text-ink-600">{dayRange(c.first_day, c.last_day)}{c.days > 1 ? ` · ${c.days} days` : ''}{c.km > 0 ? ` · ${km(c.km)}` : ''}</p>
                  {/* What is still missing and where it stands; no mode icons (the user, 23 Oct, as on Approvals). */}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                    {c.bills_missing > 0 && <span className="inline-flex items-center gap-1 font-semibold text-cyrixRed-700"><Paperclip className="h-3.5 w-3.5" />{c.bills_missing} bill{c.bills_missing > 1 ? 's' : ''} needed</span>}
                    {c.status === 'returned' || c.status === 'recalled' ? (c.returned_at && <span className="text-ink-500">{c.status === 'returned' ? 'Sent back' : 'Recalled'} {shortDay(c.returned_at)}</span>)
                      : c.submitted_at && c.status !== 'draft' && <span className="text-ink-500">Sent {shortDay(c.submitted_at)}</span>}
                  </p>
                </div>
                <span className="text-right text-base font-semibold text-ink-900 sm:order-3">{money(c.total)}</span>
                {/* The places, in the middle on a computer, under the claim on a phone (the user, 21 Oct). */}
                <span className={`col-span-2 min-w-0 sm:order-5 sm:col-span-4 lg:order-1 lg:col-span-1 ${c.places?.length ? '' : 'hidden lg:block'}`}><PlaceChips places={c.places} /></span>
                <span className="justify-self-start sm:order-2"><span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span></span>
                <span className="flex min-h-9 items-center justify-end gap-1 sm:order-4">
                {(editable(c.status) || c.status === 'with_manager') && (
                  <button type="button" className="btn-icon text-violet-700" aria-label="Edit claim" title={c.status === 'with_manager' ? 'Recall to edit' : 'Edit'}
                    onClick={async e => {
                      e.preventDefault(); e.stopPropagation()
                      if (c.status === 'with_manager') {
                        if (!(await ask.confirm({ title: 'Recall to edit?', body: `${c.number ?? 'This claim'} comes back from your manager so you can change bills or km. Send it again when done.`, yes: 'Recall' }))) return
                        try { await rpc('te_recall', { p_claim: c.id }); await qc.invalidateQueries({ queryKey: ['te_my_claims'] }) } catch (x) { setErr((x as Error).message); return }
                      }
                      nav(`/claim/${c.id}?edit=1`)
                    }}><Pencil className="h-4 w-4" /></button>
                )}
                {(c.status === 'draft' || c.status === 'recalled') && (
                  <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Delete claim" title="Delete claim"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); void remove(c.id, claimName(c.month, c.part)) }}><Trash2 className="h-4 w-4" /></button>
                )}
                <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-ink-400" />
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
