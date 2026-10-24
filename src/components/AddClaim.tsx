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
  // The dates already claimed, which a new claim cannot take (te_0060; the user, 23 Oct: one claim a day), and those
  // in a claim still open to change, where Continue opens that claim (te_0069; the user, 24 Oct: "24th should be in
  // diff color ie draft" — "selected 24 then continue only need to go to that page"; Edit there opens the day).
  // Those claimed split once more, approved or paid from still waiting, for a colour each (te_0070).
  const [taken, setTaken] = useState<Record<string, string>>({})
  const [approved, setApproved] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, { claim: string; name: string }>>({})
  useEffect(() => {
    if (!picking) return
    void rpc<Array<{ day: string; name: string; claim: string; draft: boolean; status: string }>>('te_my_claimed_days', {}).then(list => {
      const done = (s: string) => s === 'approved' || s === 'paid'
      setTaken(Object.fromEntries((list ?? []).filter(x => !x.draft && !done(x.status)).map(x => [x.day, x.name])))
      setApproved(Object.fromEntries((list ?? []).filter(x => !x.draft && done(x.status)).map(x => [x.day, x.name])))
      setDrafts(Object.fromEntries((list ?? []).filter(x => x.draft).map(x => [x.day, { claim: x.claim, name: x.name }])))
    }).catch(() => { setTaken({}); setApproved({}); setDrafts({}) })
  }, [picking])
  const claimedIn = taken[pickDay] ?? approved[pickDay]
  const openDraft = (d: string) => { setPicking(false); nav(`/claim/${drafts[d].claim}`) }
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
    if (drafts[pickDay]) { openDraft(pickDay); return }
    setBusy(true); setErr(null)
    // The date goes with it, so a draft left before a day is saved is still known by it (te_0069).
    try { const id = await rpc<string>('te_open_month', { p_month: pickDay.slice(0, 8) + '01', p_day: pickDay }); setPicking(false); nav(`/claim/${id}?add=${pickDay}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const late = earlier.find(x => x.month === pickDay.slice(0, 8) + '01')
  return (
    <>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => { setPickDay(todayIso()); setErr(null); setPicking(true) }}><CalendarPlus className="h-4 w-4" /> Add a claim</button>
      {picking && (
        <Dialog title="Add a claim" icon={<CalendarPlus className="h-5 w-5 text-amber-600" />} onClose={() => setPicking(false)}>
          <div className="mt-3 space-y-3">
            <MonthCalendar value={claimedIn ? '' : pickDay} onChange={setPickDay} min={minDay} max={todayIso()} legend
              taken={taken} approved={approved} drafts={Object.fromEntries(Object.entries(drafts).map(([d, x]) => [d, x.name]))} />
            {claimedIn
              ? <p className="text-sm font-semibold text-amber-800">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} is already claimed in {claimedIn}</p>
              : drafts[pickDay]
                ? <p className="text-sm font-semibold text-blue-800">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} is in your {drafts[pickDay].name}</p>
                : <p className="text-sm text-ink-600">{new Date(pickDay + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>}
            {late?.pct ? <p className="text-sm text-amber-800">{monthName(late.month)} is late: {late.pct}% comes off that month's claim.</p> : null}
            {err && <p className="text-sm text-cyrixRed-700">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicking(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!pickDay || pickDay > todayIso() || pickDay < minDay || !!claimedIn || busy} onClick={() => void add()}>{busy && <Spinner className="h-4 w-4" />} Continue</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
