import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'
import { Spinner } from '@/components/ui'
import { monthName, rpc, todayIso } from '@/lib/claims'

/*
  "Add a claim": the button and its calendar, the same on My claims and on Summary (the user, 19 Oct:
  "here also add a 'Add a claim' button, like we have in Revive Lab summary tab").

  Any day can be added (the user, 17 Oct: "show current date, then on click a calendar to select other
  dates, not future"): today by default, back as far as a month can still be claimed. A month already
  sent takes the day into its next part. Earlier months are due by the 5th of the next month, then 10,
  20, 30% off for 1, 2, 3 months late (the user, 17 Oct: "what if I want to claim Aug month?").
*/
export default function AddClaim() {
  const nav = useNavigate()
  const [picking, setPicking] = useState(false)
  const [pickDay, setPickDay] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The dates already claimed, which a new claim cannot take (te_0060; the user, 23 Oct: one claim a day).
  const [taken, setTaken] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!picking) return
    void rpc<Array<{ day: string; name: string }>>('te_my_claimed_days', {}).then(list => setTaken(Object.fromEntries((list ?? []).map(x => [x.day, x.name])))).catch(() => setTaken({}))
  }, [picking])
  const now = new Date()
  const minDay = new Date(now.getFullYear(), now.getMonth() - 3, 1).toLocaleDateString('en-CA')
  const iso = (d: Date) => d.toLocaleDateString('en-CA').slice(0, 7) + '-01'
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
  const add = async () => {
    if (!pickDay || pickDay > todayIso()) return
    setBusy(true); setErr(null)
    try { const id = await rpc<string>('te_open_month', { p_month: pickDay.slice(0, 8) + '01' }); setPicking(false); nav(`/claim/${id}?add=${pickDay}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const late = earlier.find(x => x.month === pickDay.slice(0, 8) + '01')
  return (
    <>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => { setPickDay(todayIso()); setErr(null); setPicking(true) }}><CalendarPlus className="h-4 w-4" /> Add a claim</button>
      {picking && (
        <Dialog title="Add a claim" icon={<CalendarPlus className="h-5 w-5 text-amber-600" />} onClose={() => setPicking(false)}>
          <div className="mt-3 space-y-3">
            <MonthCalendar value={taken[pickDay] ? '' : pickDay} onChange={setPickDay} min={minDay} max={todayIso()} taken={taken} />
            {taken[pickDay]
              ? <p className="text-sm font-semibold text-amber-800">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} is already claimed in {taken[pickDay]}</p>
              : <p className="text-sm text-ink-600">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>}
            {late?.pct ? <p className="text-sm text-amber-800">{monthName(late.month)} is late: {late.pct}% comes off that month's claim.</p> : null}
            {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicking(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!pickDay || pickDay > todayIso() || pickDay < minDay || !!taken[pickDay] || busy} onClick={() => void add()}>{busy && <Spinner className="h-4 w-4" />} Continue</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
