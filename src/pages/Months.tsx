import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarPlus, ChevronRight, ReceiptText, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { STATUS, money, monthName, rpc, useMyClaims } from '@/lib/claims'

/*
  The person's claims, a month each (the user, 17 Oct: report periods are calendar months). This
  month's is opened, or made, with one press; last month's too while it can still be sent.
*/
export default function Months() {
  const nav = useNavigate()
  const { data, isLoading, error } = useMyClaims()
  const qc = useQueryClient()
  const ask = useAsk()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const now = new Date()
  const iso = (d: Date) => d.toLocaleDateString('en-CA').slice(0, 7) + '-01'
  const thisMonth = iso(now)
  /*
    Earlier months still claimable (the user, 17 Oct: "what if i want to claim aug month?"): due by
    the 5th of the next month, then 10, 20, 30% off for 1, 2, 3 months late; older is not offered.
  */
  const earlier = [1, 2, 3, 4].map(k => {
    const m = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const due = new Date(m.getFullYear(), m.getMonth() + 1, 5)
    let late = 0
    if (now > due) {
      const months = (now.getFullYear() - due.getFullYear()) * 12 + now.getMonth() - due.getMonth() - (now.getDate() < due.getDate() ? 1 : 0)
      late = months + 1
    }
    return { month: iso(m), pct: late === 0 ? 0 : [10, 20, 30][late - 1] ?? null }
  }).filter(x => x.pct !== null)
  const open = async (m: string) => {
    setBusy(m); setErr(null)
    try { nav(`/claim/${await rpc<string>('te_open_month', { p_month: m })}`) } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  // Deleting a claim (the user, 17 Oct): at once while it is a draft; once sent, the manager approves (claim page).
  const remove = async (id: string, label: string) => {
    if (!(await ask.confirm({ title: 'Delete this claim?', body: `The ${label} claim and everything on it will be deleted.`, yes: 'Delete claim', danger: true }))) return
    setErr(null)
    try {
      const paths = await rpc<string[]>('te_delete_claim', { p_claim: id })
      if (paths?.length) await supabase.storage.from('te-bills').remove(paths)
      await qc.invalidateQueries({ queryKey: ['te_my_claims'] })
    } catch (e) { setErr((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  const has = new Set((data ?? []).map(c => c.month))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ReceiptText className="h-5 w-5 text-amber-600" /> My claims</h1>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value="" disabled={!!busy} aria-label="Earlier month" onChange={e => { if (e.target.value) void open(e.target.value) }}>
            <option value="">Earlier month…</option>
            {earlier.map(x => <option key={x.month} value={x.month}>{monthName(x.month)}{has.has(x.month) ? ' · open' : x.pct ? ` · ${x.pct}% late` : ''}</option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void open(thisMonth)}>{busy === thisMonth ? <Spinner className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />} {has.has(thisMonth) ? 'Open' : 'Start'} {monthName(thisMonth)}</button>
        </div>
      </div>
      {(err || error) && <Alert kind="error">{err ?? (error as Error).message}</Alert>}
      {!data?.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">No claims yet. Start this month's, then add each day you travelled.</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.map(c => {
            const s = STATUS[c.status] ?? STATUS.draft
            return (
              <Link key={c.id} to={`/claim/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-100/60">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{monthName(c.month)} {c.number && <span className="ml-1 text-xs text-ink-500">{c.number}</span>}</p>
                  <p className="text-xs text-ink-500">{c.days} day{c.days === 1 ? '' : 's'}</p>
                </div>
                <span className={`badge ${s.tone}`}>{s.label}</span>
                <span className="w-24 text-right font-semibold text-ink-900">{money(c.total)}</span>
                {c.status === 'draft' && (
                  <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Delete claim" title="Delete claim"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); void remove(c.id, monthName(c.month)) }}><Trash2 className="h-4 w-4" /></button>
                )}
                <ChevronRight className="h-4 w-4 text-ink-400" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
