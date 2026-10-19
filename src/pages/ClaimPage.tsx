import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useAsk } from '@/components/Ask'
import { ArrowLeft, BedDouble, Check, CornerUpLeft, FileSpreadsheet, HandCoins, Map as MapIcon, Pencil, PencilLine, Plus, ReceiptIndianRupee, Send, Ticket as TicketIcon, Trash2, TriangleAlert, Wallet } from 'lucide-react'
import { blankDay } from '@/components/DayEditor'
import RouteStrip from '@/components/RouteStrip'
import RouteMap from '@/components/RouteMap'
import Dialog from '@/components/Dialog'
import MonthCalendar from '@/components/MonthCalendar'
import BillButton from '@/components/BillButton'
import History from '@/components/History'
import AdjustDialog, { type AdjustTarget } from '@/components/AdjustDialog'
import Budget, { budgetLines, monthLong } from '@/components/Budget'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import {
  DA_KINDS, DA_RANK, MODES, billRead, outOfPolicy, STATUS, todayIso, dayName, dayTotal, hotelLimit, km, kmOver, money, monthName, needsBill, newId, reachesPlace, rideAmount,
  useClaim, useClaimAction, type ClaimData, type Day,
} from '@/lib/claims'

/*
  One month's claim (the user, 17 Oct): the header from the employee record, the day cards, each
  with its drawn route and "See on map", and the totals as the Excel's foot has them: claimed,
  advances, net payable. Whoever it waits on approves or sends it back from here.
*/
export default function ClaimPage() {
  const { id } = useParams()
  const { data, isLoading, error, refetch } = useClaim(id)
  const act = useClaimAction()
  const nav = useNavigate()
  const [search, setSearch] = useSearchParams()
  // Deleting any claim is SW Admin's alone (te_0028; the user, 18 Oct: "only for swadmin").
  const { isSwAdmin } = useAuth()
  const ask = useAsk()
  const openDay = (d: Day, replace = false) => nav(`/claim/${id}/day`, { state: { day: d }, replace })
  const [map, setMap] = useState<{ days: Day[]; title: string } | null>(null)
  const [note, setNote] = useState('')
  // The decision panel says its own result, where the button was pressed (the user, 17 Oct).
  const [panel, setPanel] = useState<{ ok: boolean; text: string } | null>(null)
  const noteBox = useRef<HTMLTextAreaElement>(null)
  const [picking, setPicking] = useState(false)
  const [pickDay, setPickDay] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  // An approver changing one figure (te_0027).
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null)

  // Days joined into trips: a day that continues the one before is drawn with it.
  const groups = useMemo(() => {
    const out: Day[][] = []
    for (const d of data?.days ?? []) {
      const prev = out[out.length - 1]
      if (prev && d.continues_day && prev[prev.length - 1].day === d.continues_day) prev.push(d)
      else out.push([d])
    }
    return out
  }, [data])

  // Arriving from Edit: straight to the form — the latest day, or a new day dated today when there is none.
  if (search.get('edit') && data && data.claim.can_edit) {
    const last = data.days[data.days.length - 1]
    window.setTimeout(() => {
      setSearch({}, { replace: true })
      if (last) openDay(last)
      else openDay(blankDay(todayIso().slice(0, 7) === data.claim.month.slice(0, 7) ? todayIso() : data.claim.month), true)
    }, 0)
  }
  // Arriving from "Add a day" with its date: open that day once.
  const want = search.get('add')
  if (want && data) {
    const have = data.days.find(d => d.day === want)
    window.setTimeout(() => { setSearch({}, { replace: true }); openDay(have ?? blankDay(want)) }, 0)
  }
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'That claim could not be opened.'}</Alert>
  const c = data.claim, rule = data.rule
  const total = data.days.reduce((t, d) => t + dayTotal({ ...d, hotel: d.room_by ? null : d.hotel }, rule), 0)
  const late = Math.round(total * (c.late_pct / 100))
  const net = total - late - (c.advance ?? 0)
  const status = STATUS[c.status] ?? STATUS.draft
  const tol = Number(data.policy.km_tolerance_pct ?? 10)
  const over = Number(data.policy.bill_over ?? 300)
  const lastDay = data.days[data.days.length - 1]
  const monthLast = (() => { const d = new Date(c.month + 'T00:00:00'); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA'); return end < todayIso() ? end : todayIso() })()
  // Delete / request deletion / Excel: one row with the person's buttons (the user, 17 Oct).
  const excel = data.days.length > 0 && (
    <button type="button" className="btn-lift inline-flex h-9 items-center gap-2 rounded-lg border border-green-600/40 px-3 text-sm font-semibold text-green-700 hover:bg-green-50"
      onClick={async () => { const { exportClaim } = await import('@/lib/exportClaim'); await exportClaim(data) }}><FileSpreadsheet className="h-4 w-4" /> Download Excel</button>
  )
  const deletes = (
    <>
          {((c.mine && (c.status === 'draft' || c.status === 'recalled')) || isSwAdmin) && (
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-cyrixRed-700 hover:underline" onClick={async () => {
              if (!(await ask.confirm({ title: 'Delete this claim?', body: `The ${monthName(c.month)} claim${c.mine ? '' : ' of ' + c.name} and everything on it will be deleted.`, yes: 'Delete claim', danger: true }))) return
              try {
                // The bills first: once the claim is gone, nothing is left to allow removing them.
                const paths = data.bills.map(b => b.path)
                if (paths.length) await supabase.storage.from('te-bills').remove(paths)
                await act.mutateAsync({ fn: 'te_delete_claim', args: { p_claim: c.id } })
                nav(c.mine ? '/claims' : '/approvals')
              } catch (e) { setFail((e as Error).message) }
            }}><Trash2 className="h-4 w-4" /> Delete claim</button>
          )}
          {c.mine && !c.delete_requested_at && c.status !== 'draft' && c.status !== 'recalled' && c.status !== 'paid' && (
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-cyrixRed-700 hover:underline" onClick={async () => {
              const reason = await ask.prompt({ title: 'Request deletion', body: 'This claim is already sent, so your manager approves the deletion.', label: 'Why should it be deleted?', yes: 'Send request' })
              if (reason && reason.trim()) void run('te_request_delete', { p_claim: c.id, p_reason: reason }, 'Asked your manager to delete it.')
            }}><Trash2 className="h-4 w-4" /> Request deletion</button>
          )}
    </>
  )
  // The quiet row under the actions: Excel left, delete right (the user, 17 Oct: "buttons misaligned").
  const tail = (excel || ((c.mine && (c.status === 'draft' || c.status === 'recalled')) || isSwAdmin || (c.mine && !c.delete_requested_at && c.status !== 'draft' && c.status !== 'recalled' && c.status !== 'paid'))) ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>{excel}</span>
      <span className="flex items-center gap-3">{deletes}</span>
    </div>
  ) : null

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setMsg(null); setFail(null)
    try { const r = await act.mutateAsync({ fn, args }); setMsg(typeof r === 'string' && fn === 'te_submit' ? `Sent to your manager as ${r}.` : done); setNote('') }
    catch (e) { setFail((e as Error).message) }
  }
  const decide = async (approve: boolean) => {
    setPanel(null)
    if (!approve && !note.trim()) { setPanel({ ok: false, text: "Write why it's going back" }); noteBox.current?.focus(); return }
    try {
      const next = await act.mutateAsync({ fn: 'te_decide', args: { p_claim: c.id, p_approve: approve, p_note: note } }) as string
      const who = `${c.number ?? monthName(c.month)} · ${c.name}`
      if (!approve) void supabase.functions.invoke('push', { body: { action: 'travel' } }).catch(() => undefined)
      nav('/approvals', { state: { done: !approve ? `${who} sent back.`
        : next === 'with_coordinator' ? `${who} approved and passed to the coordinator.`
        : next === 'with_desk' ? `${who} approved and passed to the Travel Desk.`
        : `${who} approved.` } })
    } catch (e) { setPanel({ ok: false, text: (e as Error).message }) }
  }
  /*
    The next day, from where the last one ended (the user, 17 Oct: "only continue from needed — in the
    first trip I may have come back home, then again from home I can start"). Ended at home: a new day
    starting from home. Ended elsewhere (a hotel, another town): the same trip goes on, joined to it,
    with its purpose, place and tickets carried. The date is the next day, never a future one, and can
    be changed in the form.
  */
  const continueFrom = (d: Day) => {
    const next = new Date(d.day + 'T00:00:00'); next.setDate(next.getDate() + 1)
    const iso = next.toLocaleDateString('en-CA') > todayIso() ? todayIso() : next.toLocaleDateString('en-CA')
    const lastRide = d.rides[d.rides.length - 1]
    const atHome = !lastRide || /\bhome\b/i.test(lastRide.to_name ?? '')
    const nd = blankDay(iso)
    if (!atHome) {
      nd.continues_day = d.day; nd.purpose = d.purpose; nd.place = d.place; nd.district = d.district; nd.da_kind = d.da_kind
      nd.tickets = d.tickets.map(t => ({ ...t, id: newId() }))
    }
    if (lastRide?.to_lat != null) nd.rides = [{ id: newId(), mode: lastRide.mode, from_name: lastRide.to_name, from_lat: lastRide.to_lat, from_lng: lastRide.to_lng, to_name: null, to_lat: null, to_lng: null, claimed_km: null, map_km: null, fare: null }]
    openDay(nd)
  }

  return (
    <div className="space-y-4">
      <Link to={c.mine ? '/claims' : '/approvals'} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="h-4 w-4" /> {c.mine ? 'My claims' : 'Approvals'}</Link>

      {/* ---- header ---- */}
      <div className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-ink-900">{c.number ? `${c.number} · ${monthName(c.month)}` : `${monthName(c.month)} claim`}</h1>
            <span className={`badge ${status.tone}`}>{status.label}</span>
          </div>
          <p className="mt-1 text-sm text-ink-700">{c.name} · {c.ecode} · Grade {c.grade ?? '—'}{c.designation ? ` · ${c.designation}` : ''}</p>
          <Header data={data} onSaved={() => void refetch()} />
          <p className="mt-1 text-xs text-ink-500">Manager {c.manager ?? '—'}{c.coordinator ? ` · Coordinator ${c.coordinator}` : ''} · Travel Desk</p>
        </div>
        <div className="text-right">
          {c.mine && (c.can_edit || c.status === 'with_manager') && (
            <button type="button" className="btn-lift mb-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50"
              onClick={async () => {
                if (c.status === 'with_manager') {
                  if (!(await ask.confirm({ title: 'Recall to edit?', body: `${c.number ?? 'This claim'} comes back from your manager so you can change it. Submit it again when done.`, yes: 'Recall' }))) return
                  try { await act.mutateAsync({ fn: 'te_recall', args: { p_claim: c.id } }) } catch (e) { setFail((e as Error).message); return }
                }
                const last = data.days[data.days.length - 1]
                openDay(last ?? blankDay(todayIso().slice(0, 7) === c.month.slice(0, 7) ? todayIso() : c.month))
              }}><Pencil className="h-4 w-4" /> {c.status === 'with_manager' ? 'Recall to edit' : 'Edit'}</button>
          )}
          <p className="text-xs text-ink-500">Total claimed</p>
          <p className="text-2xl font-semibold text-ink-900">{money(total)}</p>
          {c.late_pct > 0 && <p className="text-xs text-cyrixRed-700">Late {c.late_pct}% · −{money(late)}</p>}
          {c.advance > 0 && <p className="text-xs text-ink-600">Advance −{money(c.advance)}</p>}
          {(c.late_pct > 0 || c.advance > 0) && <p className="text-sm font-semibold text-ink-900">Net payable {money(net)}</p>}
        </div>
      </div>

      {data.days.length > 0 && <Budget title={`${c.mine ? 'Left' : `${c.name.split(' ')[0]}'s budget left`} in ${monthLong(c.month)}`}
        lines={budgetLines(rule, data.policy, { bike: data.km_month.bike, car: data.km_month.car, auto: data.km_month.auto, phone: data.km_month.phone ?? 0 })} />}
      {c.status === 'returned' && c.return_note && <Alert kind="warning" title="Sent back to you">{c.return_note}</Alert>}
      {c.mine && c.status === 'recalled' && <Alert kind="info" title="Recalled to edit">Change what you need, then press Submit to manager again. It keeps its number.</Alert>}
      {!c.mine && c.recalls > 0 && <p className="text-sm text-orange-800">Recalled {c.recalls}× by {c.name.split(' ')[0]} after sending{c.last_recalled_at ? ` · last on ${new Date(c.last_recalled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</p>}
      {/* Deleting a sent claim needs the manager (te_0016; the user, 17 Oct). */}
      {c.delete_requested_at && (
        <div className="card flex flex-wrap items-center gap-3 border-cyrixRed-300 p-4">
          <Trash2 className="h-5 w-5 text-cyrixRed-600" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-ink-900">{c.mine ? 'You asked to delete this claim' : `${c.name.split(' ')[0]} asked to delete this claim`}</p>
            <p className="text-ink-600">“{c.delete_reason}”{c.mine ? ' · waiting for your manager' : ''}</p>
          </div>
          {c.is_manager && (
            <>
              <button type="button" className="btn-primary bg-cyrixRed-600" onClick={async () => {
                if (!(await ask.confirm({ title: 'Approve the deletion?', body: `${c.name}'s ${monthName(c.month)} claim and everything on it will be deleted.`, yes: 'Delete claim', danger: true }))) return
                try { const paths = data.bills.map(b => b.path); if (paths.length) await supabase.storage.from('te-bills').remove(paths); await act.mutateAsync({ fn: 'te_delete_claim', args: { p_claim: c.id } }); nav('/approvals') } catch (e) { setFail((e as Error).message) }
              }}>Approve deletion</button>
              <button type="button" className="btn-secondary" onClick={() => void run('te_keep_claim', { p_claim: c.id }, 'Kept. The claim carries on.')}>Keep the claim</button>
            </>
          )}
          {c.mine && <button type="button" className="btn-secondary" onClick={() => void run('te_keep_claim', { p_claim: c.id }, 'Request withdrawn.')}>Withdraw request</button>}
        </div>
      )}
      {msg && <Alert kind="success">{msg}</Alert>}
      {fail && <Alert kind="error">{fail}</Alert>}

      <Observations data={data} />

      {/* ---- day cards ---- */}
      {!data.days.length && <div className="card p-6 text-center text-sm text-ink-500">Nothing claimed yet.</div>}
      {groups.map(g => (
        <div key={g[0].id} className={g.length > 1 ? 'space-y-2 border-l-4 border-violet-400 pl-3' : ''}>
          {g.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-violet-700">Trip · {g.length} days</span>
              <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => setMap({ days: g, title: `${dayName(g[0].day)} – ${dayName(g[g.length - 1].day)}` })}><MapIcon className="h-3.5 w-3.5" /> See trip on map</button>
            </div>
          )}
          {g.map((d, i) => (
            <DayCard key={d.id} d={d} data={data} tripDay={g.length > 1 ? `Trip day ${i + 1} of ${g.length}` : null} tol={tol} over={over}
              onEdit={() => openDay(d)} onMap={() => setMap({ days: [d], title: `${dayName(d.day)}${d.place ? ' · ' + d.place : ''}` })}
              onMapDays={(days, title) => setMap({ days, title })}
              onDelete={async () => { if (await ask.confirm({ title: `Remove ${dayName(d.day)}?`, body: 'The day, its rides, tickets, expenses and bills come off the claim.', yes: 'Remove day', danger: true })) void run('te_delete_day', { p_day: d.id }, 'Day removed.') }}
              onBills={() => void refetch()} onAdjust={c.can_decide && !c.mine ? setAdjust : undefined} />
          ))}
        </div>
      ))}

      {/* ---- the person's actions: one panel, the same shape on a phone and a computer ---- */}
      {c.can_edit && (
        <div className="card space-y-3 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            {data.days.length > 0 && (
              <button type="button" className="btn-primary col-span-2 h-11 justify-center sm:order-last sm:ml-auto" disabled={act.isPending}
                onClick={async () => { if (await ask.confirm({ title: `Send the ${monthName(c.month)} claim?`, body: 'It goes to your manager. You cannot change it after, unless you recall it or it is sent back.', yes: 'Submit' })) void run('te_submit', { p_claim: c.id }, 'Sent.') }}>
                {act.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Submit to manager
              </button>
            )}
            {lastDay ? (
              <button type="button" className="btn-secondary col-span-2 h-11 justify-center whitespace-nowrap text-sm sm:col-span-1" onClick={() => continueFrom(lastDay)}>
                <Plus className="h-4 w-4" /> Continue from {new Date(lastDay.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </button>
            ) : (
              <button type="button" className="btn-secondary col-span-2 h-11 justify-center text-sm sm:col-span-1" onClick={() => {
                const today = todayIso()
                setPickDay(today.slice(0, 7) === c.month.slice(0, 7) ? today : monthLast)
                setPicking(true)
              }}><Plus className="h-4 w-4" /> Add a claim</button>
            )}
          </div>
          {tail && <div className="border-t border-ink-100 pt-3">{tail}</div>}
        </div>
      )}

      {/* ---- whoever it waits on ---- */}
      {c.can_decide && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-ink-900">{c.status === 'with_desk' ? 'Travel Desk check' : c.status === 'with_coordinator' ? 'Coordinator check' : 'Manager check'}</h2>
          <textarea ref={noteBox} rows={2} className={`input ${panel && !panel.ok && !note.trim() ? '!border-cyrixRed-500 ring-2 ring-cyrixRed-200' : ''}`} value={note}
            onChange={e => { setNote(e.target.value); if (panel && !panel.ok) setPanel(null) }} placeholder="Note (needed to send back)" />
          {panel && <p className={`text-sm ${panel.ok ? 'text-green-700' : 'text-cyrixRed-700'}`}>{panel.text}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={act.isPending} onClick={() => void decide(true)}><Check className="h-4 w-4" /> Approve</button>
            <button type="button" className="btn-secondary" disabled={act.isPending} onClick={() => void decide(false)}><CornerUpLeft className="h-4 w-4" /> Send back</button>
          </div>
        </div>
      )}
      {c.is_desk && !c.mine && c.status !== 'draft' && c.status !== 'paid' && <DeskPanel data={data} onDone={(m) => { setMsg(m); void refetch() }} />}

      {!c.can_edit && tail}

      <History data={data} />

      {picking && (
        <Dialog title="Add a claim" icon={<Plus className="h-5 w-5 text-amber-600" />} onClose={() => setPicking(false)}>
          <div className="mt-3 space-y-3">
            <MonthCalendar value={pickDay} onChange={setPickDay} min={c.month} max={monthLast} marked={data.days.map(d => d.day)} />
            {data.days.some(d => d.day === pickDay) && <p className="text-sm text-ink-600">{dayName(pickDay)} is already on this claim — Continue opens it.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicking(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!pickDay} onClick={() => { setPicking(false); openDay(data.days.find(d => d.day === pickDay) ?? blankDay(pickDay)) }}>Continue</button>
            </div>
          </div>
        </Dialog>
      )}
      {map && <RouteMap days={map.days} rule={rule} title={map.title} onClose={() => setMap(null)} />}
      {adjust && <AdjustDialog claimId={c.id} target={adjust} onClose={() => setAdjust(null)} />}
    </div>
  )
}

/** The claim's header, as the top of the Excel sheet. Shown here; it is changed in the day form. */
function Header({ data }: { data: ClaimData; onSaved?: () => void }) {
  const c = data.claim
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
      <span>Project: <b className="font-medium text-ink-800">{c.project || '—'}</b></span>
    </p>
  )
}

function DayCard({ d, data, tripDay, tol, over, onEdit, onMap, onMapDays, onDelete, onBills, onAdjust }: {
  d: Day; data: ClaimData; tripDay: string | null; tol: number; over: number
  onEdit: () => void; onMap: () => void; onMapDays: (days: Day[], title: string) => void; onDelete: () => void; onBills: () => void
  onAdjust?: (t: AdjustTarget) => void
}) {
  const c = data.claim, rule = data.rule
  const outOfState = d.da_kind === 'out_state' || d.da_kind === 'out_state_stay'
  const daLabel = DA_KINDS.find(k => k.code === d.da_kind)?.label
  const hasMap = d.rides.some(r => r.from_lat != null && r.to_lat != null)
  // Open for whoever may change its figures, so the pencils are in sight.
  const [open, setOpen] = useState(!!onAdjust)
  const changes = (id: string) => (data.adjustments ?? []).filter(a => a.item_id === id)
  // An amount: what was claimed struck through once an approver changed it, and their pencil.
  const amt = (id: string, now: number, t?: AdjustTarget, tone = 'text-ink-900') => {
    const a = changes(id), last = a[a.length - 1]
    return (
      <span className="inline-flex shrink-0 items-center justify-end gap-1.5">
        {a.length > 0 && <s className="text-xs text-ink-400">{money(a[0].old_amount)}</s>}
        <span className={`min-w-[3.5rem] text-right font-medium ${a.length ? 'font-semibold text-rose-700' : tone}`} title={last ? `Changed by ${last.by ?? 'an approver'}: ${last.reason}` : undefined}>{money(now)}</span>
        {t && onAdjust && (
          <button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-violet-300 text-violet-700 hover:bg-violet-50" title="Change the amount" aria-label="Change the amount" onClick={() => onAdjust(t)}>
            <PencilLine className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    )
  }
  // A ticket sits under the ride that arrives at its hospital (the user, 17 Oct: "move the ticket under the hospital name").
  const rideOf = (t: Day['tickets'][number]) => t.place ? d.rides.find(r => (r.to_name ?? '').toLowerCase().includes(t.place!.toLowerCase().split(',')[0].trim())) : undefined
  const loose = d.tickets.filter(t => !rideOf(t))
  const billed = new Set(data.bills.map(b => b.owner_id))
  const missing = d.rides.filter(r => needsBill('ride', r, over, rule) && !billed.has(r.id)).length
    + (d.hotel && !d.room_by && !billed.has(d.hotel.id) ? 1 : 0)
    + d.expenses.filter(x => needsBill('expense', x, over) && !billed.has(x.id)).length
  return (
    <div className="card space-y-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{dayName(d.day)}{d.place ? ` · ${d.place}` : ''}{d.district ? `, ${d.district}` : ''}</p>
          <p className="text-sm text-ink-500">{[d.purpose, d.da_kind !== 'none' ? `DA ${daLabel?.toLowerCase()} ${money(d.da_amount)}` : null, tripDay].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 font-semibold text-ink-900">{money(dayTotal({ ...d, hotel: d.room_by ? null : d.hotel }, rule))}</span>
          {hasMap && <button type="button" className="btn-icon" title="See on map" aria-label="See on map" onClick={onMap}><MapIcon className="h-4 w-4 text-teal-600" /></button>}
          {c.can_edit && <button type="button" className="btn-icon" title="Edit" aria-label="Edit day" onClick={onEdit}><Pencil className="h-4 w-4" /></button>}
          {c.can_edit && <button type="button" className="btn-icon text-cyrixRed-600" title="Remove" aria-label="Remove day" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>

      <RouteStrip days={[d]} rule={rule} />

      {/* One quiet line, the details behind a toggle (the user, 17 Oct: "looks overcrowded"). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        {d.tickets.length > 0 && <span className="inline-flex items-center gap-1 text-sky-700"><TicketIcon className="h-3.5 w-3.5" />{d.tickets.map(t => t.ticket_no).join(', ')}</span>}
        {d.hotel && !d.room_by && <span className="inline-flex items-center gap-1 text-violet-700"><BedDouble className="h-3.5 w-3.5" />{money(d.hotel.amount)}</span>}
        {d.room_by && <span className="inline-flex items-center gap-1 text-green-700"><BedDouble className="h-3.5 w-3.5" />Room by {d.room_by.name.split(' ')[0]}</span>}
        {d.expenses.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><ReceiptIndianRupee className="h-3.5 w-3.5" />{money(d.expenses.reduce((t, x) => t + x.amount, 0))}</span>}
        {missing > 0 && <span className="font-semibold text-amber-700">{missing} bill{missing > 1 ? 's' : ''} needed</span>}
        <button type="button" className="ml-auto font-semibold text-violet-700 hover:underline" onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : 'Details'}</button>
      </div>

      {open && (
        <div className="divide-y divide-ink-100 rounded-xl bg-ink-50/60 px-3">
          {hasMap && (
            <div className="flex justify-end py-2">
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline" onClick={onMap}><MapIcon className="h-3.5 w-3.5" /> View on map</button>
            </div>
          )}
          {d.rides.map(r => {
            const m = MODES[r.mode], I = m.icon, check = m.perKm ? kmOver(r, tol) : null, bad = outOfPolicy(r.mode, rule)
            return (
              // On a phone the route on its own line and the figures under it; on a computer one line (the user, 18 Oct).
              <div key={r.id} className="py-2 text-sm">
               <div className="sm:flex sm:items-center sm:gap-2">
                <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold" style={{ background: m.bg, color: m.fg }}><I className="h-3.5 w-3.5" />{m.label}</span>
                  {bad && <span className="-ml-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyrixRed-600 text-[11px] font-bold text-white" title={`${m.label} is not in grade ${c.grade ?? '—'}'s policy`}>!</span>}
                  <span className="min-w-0 flex-1 truncate text-ink-800">{short(r.from_name)} → {short(r.to_name)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 sm:mt-0">
                {m.perKm && <span className={check?.over ? 'text-xs font-semibold text-amber-700' : 'text-xs text-ink-500'} title={check ? `Map ${km(r.map_km)} · allowed ${km(check.allowed)}` : undefined}>{km(r.claimed_km)}{r.map_km != null ? ` (map ${km(r.map_km)})` : ''}</span>}
                <span className="ml-auto" />
                {amt(r.id, rideAmount(r, rule), { kind: 'ride', id: r.id, label: `${m.label} ${short(r.from_name)} → ${short(r.to_name)}`, unit: m.perKm ? 'km' : '₹', value: m.perKm ? (r.claimed_km ?? 0) : (r.fare ?? 0), amount: rideAmount(r, rule), rate: r.mode === 'bike' ? rule.bike_rate ?? 5 : r.mode === 'car' ? rule.car_rate ?? 11 : undefined })}
                <BillButton compact claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable={c.can_edit} needed={needsBill('ride', r, over, rule)} claimed={m.perKm ? undefined : rideAmount(r, rule)} onChange={onBills} />
                {r.from_lat != null && r.to_lat != null && (
                  <button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-ink-200 text-teal-600 hover:bg-ink-100" title="This ride on the map" aria-label="This ride on the map"
                    onClick={() => onMapDays([{ ...d, rides: [r] }], `${short(r.from_name)} → ${short(r.to_name)}`)}><MapIcon className="h-3.5 w-3.5" /></button>
                )}
                </div>
               </div>
                {d.tickets.filter(t => rideOf(t)?.id === r.id).map(t => {
                  const earlier = (t as typeof t & { earlier?: Array<{ day: string }> }).earlier ?? []
                  return (
                    <span key={t.id} className="mt-1 flex w-full items-center gap-1.5 pl-1 text-xs text-sky-700">
                      <TicketIcon className="h-3.5 w-3.5" />Ticket {t.ticket_no}{t.service_report ? ` · SR ${t.service_report}` : ''}
                      {earlier.length > 0 && <b>· {ordinal(earlier.length + 1)} visit</b>}
                    </span>
                  )
                })}
              </div>
            )
          })}
          {loose.map(t => {
            const earlier = (t as typeof t & { earlier?: Array<{ day: string; name: string; mine: boolean }> }).earlier ?? []
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <TicketIcon className="h-4 w-4 text-sky-600" />
                <span className="text-ink-800">{t.ticket_no}{t.place ? ` · ${t.place}` : ''}{t.service_report ? ` · SR ${t.service_report}` : ''}</span>
                {earlier.length > 0 && <span className="text-xs font-semibold text-sky-700">{ordinal(earlier.length + 1)} visit</span>}
              </div>
            )
          })}
          {d.hotel && !d.room_by && (() => {
            const limit = hotelLimit(rule, d.hotel, outOfState, Number(data.policy.metro_extra_pct ?? 20))
            return (
              <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <BedDouble className="h-4 w-4 text-violet-600" />
                <span className="min-w-0 flex-1 truncate text-ink-800">{d.hotel.name || 'Hotel'} · {d.hotel.occupancy}{d.hotel.shared_name ? ` · with ${d.hotel.shared_name}` : ''}</span>
                {amt(d.hotel.id, d.hotel.amount, { kind: 'hotel', id: d.hotel.id, label: d.hotel.name || 'Hotel', unit: '₹', value: d.hotel.amount, amount: d.hotel.amount }, limit != null && d.hotel.amount > limit ? 'text-amber-700' : 'text-ink-900')}
                <BillButton compact claimId={c.id} kind="hotel" ownerId={d.hotel.id} bills={data.bills} editable={c.can_edit} needed claimed={d.hotel.amount} onChange={onBills} />
              </div>
            )
          })()}
          {d.expenses.map(x => (
            <div key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <ReceiptIndianRupee className="h-4 w-4 text-amber-600" />
              <span className="min-w-0 flex-1 truncate text-ink-800">{x.category}{x.description ? ` · ${x.description}` : ''}</span>
              {amt(x.id, x.amount, { kind: 'expense', id: x.id, label: `${x.category}${x.description ? ' · ' + x.description : ''}`, unit: '₹', value: x.amount, amount: x.amount })}
              <BillButton compact claimId={c.id} kind="expense" ownerId={x.id} bills={data.bills} editable={c.can_edit} needed={needsBill('expense', x, over)} claimed={x.amount} onChange={onBills} />
            </div>
          ))}
          {(d.da_kind !== 'none' || d.da_amount > 0) && (
            <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <HandCoins className="h-4 w-4 text-teal-600" />
              <span className="min-w-0 flex-1 truncate text-ink-800">DA · {daLabel?.toLowerCase()}</span>
              {amt(d.id, d.da_amount, { kind: 'da', id: d.id, label: `DA · ${daLabel?.toLowerCase()} · ${dayName(d.day)}`, unit: '₹', value: d.da_amount, amount: d.da_amount })}
            </div>
          )}
          {d.remarks && <p className="py-2 text-sm text-ink-600">{d.remarks}</p>}
        </div>
      )}
    </div>
  )
}

function DeskPanel({ data, onDone }: { data: ClaimData; onDone: (m: string) => void }) {
  const c = data.claim
  const act = useClaimAction()
  const [adv, setAdv] = useState(String(c.advance ?? 0))
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <Wallet className="mb-2 h-5 w-5 text-teal-600" />
      <label className="block"><span className="label">Advance given ₹</span>
        <input type="number" min={0} max={20000} className="input mt-1 w-36" value={adv} onChange={e => setAdv(e.target.value)} /></label>
      <button type="button" className="btn-secondary" onClick={async () => { setErr(null); try { await act.mutateAsync({ fn: 'te_set_advance', args: { p_claim: c.id, p_advance: Number(adv) || 0 } }); onDone('Advance saved.') } catch (e) { setErr((e as Error).message) } }}>Save advance</button>
      {c.status === 'approved' && <button type="button" className="btn-primary" onClick={async () => { setErr(null); try { await act.mutateAsync({ fn: 'te_mark_paid', args: { p_claim: c.id } }); onDone('Marked paid.') } catch (e) { setErr((e as Error).message) } }}><Check className="h-4 w-4" /> Mark paid</button>}
      {err && <span className="text-sm text-cyrixRed-700">{err}</span>}
    </div>
  )
}

/*
  Observations (the user, 17 Oct: "observation needed for each claim"): everything on the claim worth
  a second look, in one list, for the approvers and the person both. The ticket's logged and resolved
  dates join it once BEMMP's tickets can be looked up (a visit before a ticket was logged, or after
  it was resolved).
*/
function Observations({ data }: { data: ClaimData }) {
  const rule = data.rule, tol = Number(data.policy.km_tolerance_pct ?? 10), over = Number(data.policy.bill_over ?? 300)
  const metro = Number(data.policy.metro_extra_pct ?? 20), near = Number(data.policy.place_near_km ?? 1)
  const items: Array<{ tone: 'amber' | 'red' | 'sky' | 'rose'; text: string }> = []
  for (const e of data.history ?? []) if (e.action === 'adjusted' && e.note) {
    const [what, ...why] = e.note.split('\n')
    items.push({ tone: 'rose', text: `${(e.actor ?? 'An approver').split(' ')[0]} changed ${what}${why.join(' ').trim() ? ` — “${why.join(' ').trim()}”` : ''}` })
  }
  const dn = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const billed = new Set(data.bills.map(b => b.owner_id))
  for (const d of data.days) {
    for (const r of d.rides) {
      const m = MODES[r.mode], k = m.perKm ? kmOver(r, tol) : null
      const leg = `${short(r.from_name)} → ${short(r.to_name)}`
      if (k && k.over > 0) items.push({ tone: 'amber', text: `${dn(d.day)}: ${m.label} ${leg} claimed ${km(r.claimed_km)}, map ${km(r.map_km)} — ${km(k.over)} over the ${tol}% allowance` })
      const read = m.perKm ? null : billRead(data.bills, r.id)
      if (read != null && Math.abs(read - (r.fare ?? 0)) > 1) items.push({ tone: 'amber', text: `${dn(d.day)}: ${m.label} ${leg} claimed ${money(r.fare)}, the bill reads ${money(read)}` })
      if (outOfPolicy(r.mode, rule))
        items.push({ tone: 'red', text: `${dn(d.day)}: ${m.label} is not in grade ${data.claim.grade ?? '—'}'s policy — prior approval needed` })
      if (needsBill('ride', r, over, rule) && !billed.has(r.id)) items.push({ tone: 'red', text: `${dn(d.day)}: no bill for the ${m.label.toLowerCase()} ride ${leg}` })
    }
    if (d.hotel && !d.room_by) {
      const lim = hotelLimit(rule, d.hotel, d.da_kind === 'out_state' || d.da_kind === 'out_state_stay', metro)
      if (lim != null && d.hotel.amount > lim) items.push({ tone: 'amber', text: `${dn(d.day)}: hotel ${money(d.hotel.amount)} is over the ${money(lim)} limit` })
      if (!billed.has(d.hotel.id)) items.push({ tone: 'red', text: `${dn(d.day)}: no hotel bill` })
      const hr = billRead(data.bills, d.hotel.id)
      if (hr != null && Math.abs(hr - d.hotel.amount) > 1) items.push({ tone: 'amber', text: `${dn(d.day)}: hotel claimed ${money(d.hotel.amount)}, the bill reads ${money(hr)}` })
    }
    if (reachesPlace(d, near) === false) items.push({ tone: 'amber', text: `${dn(d.day)}: no ride reaches ${d.place} (within ${near} km)` })
    if (d.da_auto && DA_RANK[d.da_kind] > DA_RANK[d.da_auto]) items.push({ tone: 'amber', text: `${dn(d.day)}: DA ${DA_KINDS.find(k => k.code === d.da_kind)?.label.toLowerCase()}, the map says ${DA_KINDS.find(k => k.code === d.da_auto)?.label.toLowerCase()}` })
    for (const x of d.expenses) { const xr = billRead(data.bills, x.id); if (xr != null && Math.abs(xr - x.amount) > 1) items.push({ tone: 'amber', text: `${dn(d.day)}: ${x.category.toLowerCase()} claimed ${money(x.amount)}, the bill reads ${money(xr)}` }) }
    for (const x of d.expenses) if (needsBill('expense', x, over) && !billed.has(x.id)) items.push({ tone: 'red', text: `${dn(d.day)}: no bill for ${x.category.toLowerCase()} ${money(x.amount)}` })
    for (const t of d.tickets) {
      const earlier = (t as typeof t & { earlier?: Array<{ day: string; name: string; mine: boolean }> }).earlier ?? []
      if (earlier.length) items.push({ tone: 'sky', text: `${dn(d.day)}: ticket ${t.ticket_no} was visited before on ${earlier.map(e => dn(e.day) + (e.mine ? '' : ' by ' + e.name)).join(', ')}` })
    }
  }
  for (const b of data.bills) if (b.twin) items.push({ tone: 'red', text: `A bill looks like one already claimed on ${b.twin}` })
  if (rule.bike_km_month && data.km_month.bike > rule.bike_km_month) items.push({ tone: 'amber', text: `Bike ${km(data.km_month.bike)} this month, over the ${rule.bike_km_month} km limit` })
  if (rule.car_km_month && data.km_month.car > rule.car_km_month) items.push({ tone: 'amber', text: `Car ${km(data.km_month.car)} this month, over the ${rule.car_km_month} km limit` })
  const autoCap = Number(data.policy.auto_month ?? 1000)
  if (data.km_month.auto > autoCap) items.push({ tone: 'amber', text: `Auto ${money(data.km_month.auto)} this month, over the ${money(autoCap)} allowance` })
  if (!items.length) return data.days.length ? <p className="text-sm text-green-800"><Check className="mr-1 inline h-4 w-4" />Nothing to look at twice on this claim.</p> : null
  const tone = { amber: 'bg-amber-100 text-amber-900', red: 'bg-cyrixRed-100 text-cyrixRed-900', sky: 'bg-sky-100 text-sky-900', rose: 'bg-rose-100 text-rose-900' }
  return (
    <div className="card space-y-2 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900"><TriangleAlert className="h-4 w-4 text-amber-600" /> Observations · {items.length}</h2>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className={`rounded-lg px-3 py-1.5 text-sm ${tone[it.tone]}`}>{it.text}</li>)}
      </ul>
    </div>
  )
}

const short = (s: string | null) => (s ? s.split(',')[0] : '—')
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
