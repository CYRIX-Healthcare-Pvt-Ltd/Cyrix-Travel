import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarPlus, ChevronRight, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { STATUS, claimName, dayRange, editable, km, money, monthName, rpc, todayIso, useMyClaims } from '@/lib/claims'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'

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
  /*
    Any day can be added (the user, 17 Oct: "everyday also they should have an option ... show current
    date, then on click a calendar to select other dates, not future"): today by default, back as far
    as a month can still be claimed. A month already sent takes the day into its next part.
  */
  const [picking, setPicking] = useState(false)
  const [pickDay, setPickDay] = useState(todayIso())
  const minDay = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - 3, 1).toLocaleDateString('en-CA') })()
  const addDay = async () => {
    if (!pickDay || pickDay > todayIso()) return
    setBusy('add'); setErr(null)
    try { const id = await rpc<string>('te_open_month', { p_month: pickDay.slice(0, 8) + '01' }); setPicking(false); nav(`/claim/${id}?add=${pickDay}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const now = new Date()
  const iso = (d: Date) => d.toLocaleDateString('en-CA').slice(0, 7) + '-01'
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
  // Deleting a claim (the user, 17 Oct): at once while it is a draft or recalled; otherwise the manager approves (claim page).
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ReceiptText className="h-5 w-5 text-amber-600" /> My claims</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => { setPickDay(todayIso()); setPicking(true) }}><CalendarPlus className="h-4 w-4" /> Add a claim</button>
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
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-base font-bold text-ink-900">{c.number ?? 'Not sent yet'}</span>
                    <span className="text-sm text-ink-500">{claimName(c.month, c.part)}</span>
                  </p>
                  <p className="text-xs text-ink-600">{dayRange(c.first_day, c.last_day)}{c.days > 1 ? ` · ${c.days} days` : ''}{c.km > 0 ? ` · ${km(c.km)}` : ''}</p>
                </div>
                <span className={`badge ${s.tone}`}>{s.label}</span>
                <span className="w-24 text-right font-semibold text-ink-900">{money(c.total)}</span>
                {(editable(c.status) || c.status === 'with_manager') && (
                  <button type="button" className="btn-icon text-violet-700" aria-label="Edit claim" title={c.status === 'with_manager' ? 'Recall to edit' : 'Edit'}
                    onClick={async e => {
                      e.preventDefault(); e.stopPropagation()
                      if (c.status === 'with_manager') {
                        if (!(await ask.confirm({ title: 'Recall to edit?', body: `${c.number ?? 'This claim'} comes back from your manager so you can change bills or km. Submit it again when done.`, yes: 'Recall' }))) return
                        try { await rpc('te_recall', { p_claim: c.id }); await qc.invalidateQueries({ queryKey: ['te_my_claims'] }) } catch (x) { setErr((x as Error).message); return }
                      }
                      nav(`/claim/${c.id}?edit=1`)
                    }}><Pencil className="h-4 w-4" /></button>
                )}
                {(c.status === 'draft' || c.status === 'recalled') && (
                  <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Delete claim" title="Delete claim"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); void remove(c.id, claimName(c.month, c.part)) }}><Trash2 className="h-4 w-4" /></button>
                )}
                <ChevronRight className="h-4 w-4 text-ink-400" />
              </Link>
            )
          })}
        </div>
      )}
      {picking && (
        <Dialog title="Add a claim" icon={<CalendarPlus className="h-5 w-5 text-amber-600" />} onClose={() => setPicking(false)}>
          <div className="mt-3 space-y-3">
            <MonthCalendar value={pickDay} onChange={setPickDay} min={minDay} max={todayIso()} />
            <p className="text-sm text-ink-600">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            {(() => { const late = earlier.find(x => x.month === pickDay.slice(0, 8) + '01'); return late?.pct ? <p className="text-sm text-amber-800">{monthName(late.month)} is late: {late.pct}% comes off that month's claim.</p> : null })()}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicking(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!pickDay || pickDay > todayIso() || pickDay < minDay || busy === 'add'} onClick={() => void addDay()}>{busy === 'add' && <Spinner className="h-4 w-4" />} Continue</button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
