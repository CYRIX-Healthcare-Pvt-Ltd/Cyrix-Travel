import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useAsk } from '@/components/Ask'
import { type LucideIcon, ArrowDown, ArrowLeft, BedDouble, Check, ClipboardCheck, Paperclip, CornerUpLeft, FileSpreadsheet, HandCoins, Map as MapIcon, Pencil, PencilLine, Send, Ticket as TicketIcon, Trash2, TriangleAlert, Undo2, Wallet, ShieldAlert, Copy, Gauge, ReceiptText, MapPinOff, CalendarRange, MessageSquare, House, Building2, CarTaxiFront, BriefcaseBusiness } from 'lucide-react'
import { blankDay } from '@/components/DayEditor'
import { depOn } from '@/lib/deputation'
import RouteStrip from '@/components/RouteStrip'
import RouteMap from '@/components/RouteMap'
import BillButton from '@/components/BillButton'
import ReportButton from '@/components/ReportButton'
import History from '@/components/History'
import AdjustDialog, { type AdjustTarget } from '@/components/AdjustDialog'
import Budget, { advanceLine, budgetLines, monthLong } from '@/components/Budget'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import {
  DA_KINDS, DA_RANK, MODES, billRead, kmChanged, companyOf, distanceKm, expenseIcon, outOfPolicy, policyNote, STATUS, todayIso, dayName, dayTotal, hotelLimit, km, kmOver, money, monthName, needsBill, ticketVisited, rideAmount,
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
  const openDay = (d: Day, replace = false, chosen = false) => nav(`/claim/${id}/day`, { state: { day: d, chosen }, replace })
  const [map, setMap] = useState<{ days: Day[]; title: string; focus?: string } | null>(null)
  const [note, setNote] = useState('')
  // The decision panel says its own result, where the button was pressed (the user, 17 Oct).
  const [panel, setPanel] = useState<{ ok: boolean; text: string } | null>(null)
  const noteBox = useRef<HTMLTextAreaElement>(null)
  // The check box on screen: the bar at the foot that leads to it steps aside (the user, 26 Oct: managers did not find it).
  const [checkSeen, setCheckSeen] = useState(false)
  const seen = useRef<IntersectionObserver | null>(null)
  const checkBox = useCallback((el: HTMLElement | null) => {
    seen.current?.disconnect()
    if (!el) { setCheckSeen(false); return }
    seen.current = new IntersectionObserver(([e]) => setCheckSeen(e.isIntersecting), { threshold: 0.3 })
    seen.current.observe(el)
  }, [])
  const toCheck = () => {
    document.getElementById('claim-check')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => noteBox.current?.focus({ preventScroll: true }), 450)
  }
  const [msg, setMsg] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  // An approver changing one figure (te_0027).
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const goTo = (id: string) => { setFocus(id); showBill(id) }
  // The outline goes at the next tap anywhere (the user, 19 Oct).
  useEffect(() => {
    if (!focus) return
    const off = () => setFocus(null)
    const t = window.setTimeout(() => document.addEventListener('pointerdown', off, { once: true }), 0)
    return () => { window.clearTimeout(t); document.removeEventListener('pointerdown', off) }
  }, [focus])
  const showBill = (id: string) => {
    const go = () => document.getElementById('bill-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(go, 150)
    window.setTimeout(() => { const r = document.getElementById('bill-' + id)?.getBoundingClientRect(); if (r && (r.top < 0 || r.bottom > innerHeight)) go() }, 650)
  }

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

  // Arriving from Edit: straight to the form — the latest day, or with none the date the draft was started with
  // (te_0069), else today.
  if (search.get('edit') && data && data.claim.can_edit) {
    const last = data.days[data.days.length - 1]
    window.setTimeout(() => {
      setSearch({}, { replace: true })
      if (last) openDay(last)
      else openDay(blankDay(data.claim.picked_day ?? (todayIso().slice(0, 7) === data.claim.month.slice(0, 7) ? todayIso() : data.claim.month)), true)
    }, 0)
  }
  // Arriving from "Add a day" with its date: open that day once.
  const want = search.get('add')
  if (want && data) {
    const have = data.days.find(d => d.day === want)
    window.setTimeout(() => { setSearch({}, { replace: true }); openDay(have ?? blankDay(want), false, true) }, 0)
  }
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'That claim could not be opened.'}</Alert>
  const c = data.claim, rule = data.rule
  const total = data.days.reduce((t, d) => t + dayTotal({ ...d, hotel: d.room_by ? null : d.hotel }, rule), 0)
  // What the company paid for this claim's rides and nights (te_0042): in the trip's cost, not claimed.
  const company = data.days.reduce((t, d) => t + d.rides.reduce((u, r) => u + (companyOf(data.bills, r)?.net ?? 0), 0) + (d.hotel && !d.room_by ? companyOf(data.bills, d.hotel)?.net ?? 0 : 0), 0)
  const late = Math.round(total * (c.late_pct / 100))
  const net = total - late - (c.advance ?? 0)
  const status = STATUS[c.status] ?? STATUS.draft
  const tol = Number(data.policy.km_tolerance_pct ?? 10)
  const over = Number(data.policy.bill_over ?? 300)
  /*
    The bills still needed, named and marked on their days as soon as a day is saved, not only when sending
    (the user, 19 Oct: "don't know in which is having error"; 21 Oct: show problems as soon as a day is saved).
  */
  const need = c.mine && c.can_edit ? missingBills(data, over) : []
  const send = async () => {
    if (need.length) { setMsg(null); setFail(null); showBill(need[0].id); return }
    if (await ask.confirm({ title: `Send the ${monthName(c.month)} claim?`, body: 'It goes to your manager. You cannot change it after, unless you recall it or it is sent back.', yes: 'Send', icon: Send, go: true })) void run('te_submit', { p_claim: c.id }, 'Sent.')
  }
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
  // Delete sits under the total in the header, not in a row of its own (the user, 24 Oct: "can we make delete
  // claim button more fit, bcz it is consuming full row"); Excel keeps a quiet row of its own once there are days.
  const canDelete = (c.mine && (c.status === 'draft' || c.status === 'recalled')) || isSwAdmin || (c.mine && !c.delete_requested_at && c.status !== 'draft' && c.status !== 'recalled' && c.status !== 'paid')
  const tail = excel ? <div className="flex">{excel}</div> : null

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setMsg(null); setFail(null)
    try {
      const r = await act.mutateAsync({ fn, args })
      const text = typeof r === 'string' && fn === 'te_submit' ? `Sent to your manager as ${r}.` : done
      setMsg(text); setNote('')
      void ask.alert(fn === 'te_submit' ? 'Claim sent' : 'Done', text, 'success')
    }
    catch (e) { setFail((e as Error).message) }
  }
  const decide = async (approve: boolean) => {
    setPanel(null)
    if (!approve && !note.trim()) { setPanel({ ok: false, text: "Write why it's going back" }); noteBox.current?.focus(); return }
    // Every decision asks first, from the box and from the bar alike; Cancel, the cross and Escape do nothing (the user,
    // 26 Oct: "Why on close button it is approving? check for all" — the box's Approve went straight through).
    const what = c.number ?? `the ${monthName(c.month)} claim`
    if (!(await ask.confirm(approve
      ? { title: `Approve ${what}?`, body: `${c.name} · ${money(total)}`, yes: 'Approve', icon: Check, go: true }
      : { title: `Send ${what} back?`, body: `${c.name} · “${note.trim()}”`, yes: 'Send back', icon: CornerUpLeft }))) return
    try {
      const next = await act.mutateAsync({ fn: 'te_decide', args: { p_claim: c.id, p_approve: approve, p_note: note } }) as string
      const who = `${c.number ?? monthName(c.month)} · ${c.name}`
      if (!approve) void supabase.functions.invoke('push', { body: { action: 'travel' } }).catch(() => undefined)
      const done = !approve ? `${who} sent back.`
        : next === 'with_coordinator' ? `${who} approved and passed to the coordinator.`
        : next === 'with_desk' ? `${who} approved and passed to the Travel Desk.`
        : `${who} approved.`
      await ask.alert(approve ? 'Claim approved' : 'Claim sent back', done, approve ? 'success' : 'info')
      nav('/approvals', { state: { done } })
    } catch (e) { setPanel({ ok: false, text: (e as Error).message }) }
  }
  const checkTitle = c.status === 'with_desk' ? 'Travel Desk check' : c.status === 'with_coordinator' ? 'Coordinator check' : 'Manager check'
  return (
    <div className={`space-y-4 ${c.can_decide ? 'pb-20 lg:pb-16' : ''}`}>
      <Link to={c.mine ? '/claims' : '/approvals'} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="h-4 w-4" /> {c.mine ? 'My claims' : 'Approvals'}</Link>

      {/* ---- header, a stripe and a wash of its status's colour (the user, 19 Oct: "emphasis colour for this container") ---- */}
      <div className="card flex items-start justify-between gap-3 p-4" style={{ borderLeft: `4px solid ${HEAD[c.status] ?? HEAD.draft}`, background: `linear-gradient(90deg, ${HEAD[c.status] ?? HEAD.draft}1F, transparent 70%)` }}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* The days it covers in its name (the user, 22 Oct: "show as 7 Aug · Aug-26 claim"). */}
            <h1 className="text-lg font-semibold text-ink-900">{(() => {
              // "7th Aug-26 claim", "7th–9th Aug-26 claim": the days, then the month once (a claim is one month).
              // A draft with no saved day yet: the date it was started with (te_0069; the user, 24 Oct).
              const n = (iso: string) => Number(iso.slice(8, 10)), d0 = data.days[0]?.day ?? c.picked_day, d1 = data.days[data.days.length - 1]?.day ?? c.picked_day
              const days = d0 ? (d0 === d1 ? `${ordinal(n(d0))} ` : `${ordinal(n(d0))}–${ordinal(n(d1!))} `) : ''
              return c.number ? `${c.number} · ${days}${monthName(c.month)}` : `${days}${monthName(c.month)} claim`
            })()}</h1>
            <span className={`badge ${status.tone}`}>{status.label}</span>
            {/* On deputation (te_0075; the user, 26 Oct: "for their each claim a tag should show deputation"). */}
            {(() => {
              const st = data.days.length ? data.days.map(x => depOn(data.deputations, x.day)?.state).find(Boolean) : data.deputations?.[0]?.state
              return st && <span className="badge inline-flex items-center gap-1 bg-violet-100 text-violet-900"><BriefcaseBusiness className="h-3.5 w-3.5" /> Deputation · {st}</span>
            })()}
          </div>
          <p className="mt-1 text-sm text-ink-700">{c.name} · {c.ecode} · Grade {c.grade ?? '—'}{c.designation ? ` · ${c.designation}` : ''}</p>
          <Header data={data} onSaved={() => void refetch()} />
          <p className="mt-1 text-xs text-ink-500">Manager {c.manager ?? '—'}{c.coordinator ? ` · Coordinator ${c.coordinator}` : ''} · Travel Desk</p>
        </div>
        <div className="shrink-0 text-right">
          {c.mine && (c.can_edit || c.status === 'with_manager') && (
            <button type="button" className="btn-lift mb-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50"
              onClick={async () => {
                if (c.status === 'with_manager') {
                  if (!(await ask.confirm({ title: 'Recall to edit?', body: `${c.number ?? 'This claim'} comes back from your manager so you can change it. Send it again when done.`, yes: 'Recall', icon: Undo2 }))) return
                  try { await act.mutateAsync({ fn: 'te_recall', args: { p_claim: c.id } }) } catch (e) { setFail((e as Error).message); return }
                }
                const last = data.days[data.days.length - 1]
                openDay(last ?? blankDay(c.picked_day ?? (todayIso().slice(0, 7) === c.month.slice(0, 7) ? todayIso() : c.month)))
              }}><Pencil className="h-4 w-4" /> {c.status === 'with_manager' ? 'Recall to edit' : 'Edit'}</button>
          )}
          <p className="text-xs text-ink-500">Total claimed</p>
          <p className="text-3xl font-bold text-ink-900">{money(total)}</p>
          {company > 0 && <p className="text-xs text-ink-500">Trip cost {money(total + company)} · company paid {money(company)}</p>}
          {canDelete && <div className="mt-2 flex justify-end gap-3">{deletes}</div>}
          {data.days.some(d => d.rides.length > 0) && <p className="text-xs text-ink-500">{km(data.days.reduce((t, d) => t + d.rides.reduce((u, r) => u + (r.map_km ?? r.claimed_km ?? 0), 0), 0))}</p>}
          {c.late_pct > 0 && <p className="text-xs text-cyrixRed-700">Late {c.late_pct}% · −{money(late)}</p>}
          {c.advance > 0 && <p className="text-xs text-ink-600">Advance −{money(c.advance)}</p>}
          {(c.late_pct > 0 || c.advance > 0) && <p className="text-sm font-semibold text-ink-900">Net payable {money(net)}</p>}
        </div>
      </div>

      {data.days.length > 0 && <Budget title={`${c.mine ? 'Left' : `${c.name.split(' ')[0]}'s budget left`} in ${monthLong(c.month)}`}
        lines={[...budgetLines(rule, data.policy, { bike: data.km_month.bike, car: data.km_month.car, auto: data.km_month.auto, phone: data.km_month.phone ?? 0 }),
          ...[advanceLine(c.advance_box, c.advance)].filter(x => x !== null)]} />}
      {c.status === 'returned' && c.return_note && <Alert kind="warning" title="Sent back to you">{c.return_note}</Alert>}
      {c.mine && c.status === 'recalled' && <Alert kind="info" title="Recalled to edit">Change what you need, then press Send to manager again. It keeps its number.</Alert>}
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
      {(() => {
        // Gone as each is attached.
        const billedNow = new Set(data.bills.map(b => b.owner_id))
        const left = need.filter(x => !billedNow.has(x.id))
        return left.length > 0 && (
          <div className="card border-cyrixRed-300 bg-cyrixRed-50 p-4">
            <p className="flex items-center gap-2 font-semibold text-cyrixRed-900"><Paperclip className="h-4 w-4" /> Attach {left.length === 1 ? 'this bill' : `these ${left.length} bills`} before sending</p>
            <ul className="mt-2 space-y-1">
              {left.map(x => <li key={x.id}><button type="button" className="text-left text-sm font-medium text-cyrixRed-800 hover:underline" onClick={() => showBill(x.id)}>{x.label}</button></li>)}
            </ul>
          </div>
        )
      })()}


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
              onMapDays={(days, title, focus) => setMap({ days, title, focus })}
              onDelete={async () => { if (await ask.confirm({ title: `Remove ${dayName(d.day)}?`, body: 'The day, its rides, tickets, expenses and bills come off the claim.', yes: 'Remove day', danger: true })) void run('te_delete_day', { p_day: d.id }, 'Day removed.') }}
              onBills={() => void refetch()} onAdjust={c.can_decide && !c.mine ? setAdjust : undefined} need={new Set(need.map(x => x.id))} focus={focus} />
          ))}
        </div>
      ))}

      {/* After the days and before the person's actions or the approver's check (the user, 19 Oct). */}
      <Observations data={data} onGo={goTo} />

      {/*
        One clear bar to send, kept in sight at the foot of the screen once a day is saved (the user, 21 Oct:
        "on the claim page show one clear Send to manager bar"); the bills still needed said on it.
      */}
      {c.can_edit && data.days.length > 0 && (
        <div className="sticky bottom-16 z-10 flex items-center justify-between gap-3 rounded-2xl border border-teal-300 bg-teal-50 px-4 py-3 shadow-lg lg:bottom-4">
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500">Claim total</span>
            <span className="block text-2xl font-bold tabular-nums text-ink-900">{money(total)}</span>
            <span className={`block text-xs ${need.length ? 'font-semibold text-cyrixRed-700' : 'text-ink-500'}`}>
              {need.length ? `${need.length} bill${need.length === 1 ? '' : 's'} needed` : `${data.days.length} day${data.days.length === 1 ? '' : 's'}`}
            </span>
          </span>
          <button type="button" className="btn-primary btn-go h-11 shrink-0 px-5 text-base" disabled={act.isPending} onClick={() => void send()}>
            {act.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Send to manager
          </button>
        </div>
      )}

      {/* ---- the person's own buttons; no Add here — a day is added from My claims or Summary (the user, 24 Oct:
           "why add claim here? we dont need continuation claim button") ---- */}
      {c.can_edit && tail}

      {/* ---- whoever it waits on: the box stands out (the user, 26 Oct: "it is not easy to find it, so emphasis it") ---- */}
      {c.can_decide && (
        <section id="claim-check" ref={checkBox} className="rounded-2xl border-2 border-violet-300 bg-violet-50 p-4 shadow-md sm:p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-600 text-white shadow-sm"><ClipboardCheck className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-ink-900">{checkTitle}</h2>
              <p className="truncate text-sm text-ink-600">{[c.number, c.name, money(total)].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 sm:inline-flex">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600" /></span>
              Waiting for you
            </span>
          </div>
          <textarea ref={noteBox} rows={2} className={`input mt-4 bg-surface ${panel && !panel.ok && !note.trim() ? '!border-cyrixRed-500 ring-2 ring-cyrixRed-200' : ''}`} value={note}
            onChange={e => { setNote(e.target.value); if (panel && !panel.ok) setPanel(null) }} placeholder="Note (needed to send back)" />
          {panel && <p className={`mt-2 text-sm ${panel.ok ? 'text-green-700' : 'text-cyrixRed-700'}`}>{panel.text}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
            <button type="button" className="btn-secondary !border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100 h-12 text-[15px] font-medium sm:px-6" disabled={act.isPending} onClick={() => void decide(false)}><CornerUpLeft className="h-4 w-4" /> Send back</button>
            <button type="button" className="btn-primary btn-go h-12 text-[15px] font-semibold sm:px-8" disabled={act.isPending} onClick={() => void decide(true)}><Check className="h-4 w-4" /> Approve</button>
          </div>
        </section>
      )}
      {/* Until the box is on screen, a bar at the foot: Approve (which asks first, as in the box), Send back goes to the note. */}
      {c.can_decide && (
        <div className={`fixed inset-x-0 bottom-16 z-20 mx-auto max-w-7xl px-4 transition duration-200 lg:bottom-4 ${checkSeen ? 'pointer-events-none translate-y-3 opacity-0' : ''}`} aria-hidden={checkSeen || undefined}>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-3 shadow-lg">
            <span className="min-w-0 leading-tight">
              <span className="block whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-violet-700"><span className="sm:hidden">{c.number ?? checkTitle}</span><span className="hidden sm:inline">{checkTitle}</span></span>
              <span className="block text-2xl font-bold tabular-nums text-ink-900">{money(total)}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <button type="button" tabIndex={checkSeen ? -1 : undefined} className="btn-secondary !border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100 h-11 px-3 sm:px-4" disabled={act.isPending} onClick={toCheck}><CornerUpLeft className="h-4 w-4" /> Send back</button>
              <button type="button" tabIndex={checkSeen ? -1 : undefined} className="btn-primary btn-go h-11 px-4 sm:px-5" disabled={act.isPending}
                onClick={() => void decide(true)}>
                <Check className="h-4 w-4" /> Approve
              </button>
            </span>
          </div>
        </div>
      )}
      {c.is_desk && !c.mine && c.status === 'approved' && <DeskPanel data={data} onDone={(m) => { setMsg(m); void refetch() }} />}

      {!c.can_edit && tail}

      <History data={data} />

      {map && <RouteMap days={map.days} rule={rule} title={map.title} focus={map.focus} onClose={() => setMap(null)} />}
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
      {c.status === 'paid' && c.paid_on && <span className="font-medium text-teal-700">Paid on {new Date(c.paid_on + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{c.paid_ref ? ` · UTR ${c.paid_ref}` : ''}</span>}
    </p>
  )
}

function DayCard({ d, data, tripDay, tol, over, onEdit, onMap, onMapDays, onDelete, onBills, onAdjust, need, focus }: {
  d: Day; data: ClaimData; tripDay: string | null; tol: number; over: number
  onEdit: () => void; onMap: () => void; onMapDays: (days: Day[], title: string, focus?: string) => void; onDelete: () => void; onBills: () => void
  onAdjust?: (t: AdjustTarget) => void
  /** Items whose bill is still needed: marked on the card. */
  need?: Set<string>
  /** The line an observation was tapped for. */
  focus?: string | null
}) {
  const c = data.claim, rule = data.rule
  const ask = useAsk()
  const outOfState = d.da_kind === 'out_state_stay'
  const daLabel = DA_KINDS.find(k => k.code === d.da_kind)?.label
  const dep = depOn(data.deputations, d.day)
  const hasMap = d.rides.some(r => r.from_lat != null && r.to_lat != null)
  const mark = (id: string) => (need?.has(id) && !data.bills.some(b => b.owner_id === id) ? ' -mx-2 rounded-lg bg-cyrixRed-50 px-2 ring-1 ring-cyrixRed-300'
    : focus === id ? ' -mx-2 rounded-lg px-2' : '')
  const lit = (id: string, color: string) => (focus === id && !(need?.has(id) && !data.bills.some(b => b.owner_id === id)) ? { boxShadow: `0 0 0 2px ${color}`, background: color + '14' } : undefined)
  const changes = (id: string) => (data.adjustments ?? []).filter(a => a.item_id === id)
  // An amount: what was claimed struck through once an approver changed it.
  const amt = (id: string, now: number, tone = 'text-ink-900', place = 'col-start-4') => {
    const a = changes(id), last = a[a.length - 1]
    return (
      <span className={`${place} inline-flex items-center justify-end gap-1.5`}>
        {a.length > 0 && <s className="text-xs text-ink-400">{money(a[0].old_amount)}</s>}
        <span className={`text-right font-medium ${a.length ? 'font-semibold text-rose-700' : tone}`} title={last ? `Changed by ${last.by ?? 'an approver'}: ${last.reason}` : undefined}>{money(now)}</span>
      </span>
    )
  }
  /*
    Every line's figures in the same columns: bill · amount · map · the approver's pencil last (the user,
    19 Oct: "is this ok?" of figures that wandered; "keep edit at end"). The lines share the details'
    columns, so each is as wide as its widest entry and an empty one keeps its place. On a phone the name
    has its own line, the figures under it.
  */
  const cols = `minmax(0,1fr) auto auto auto${hasMap ? ' auto' : ''}${onAdjust ? ' auto' : ''}`
  const pen = (t: AdjustTarget, place = hasMap ? 'col-start-6' : 'col-start-5') => onAdjust && (
    <button type="button" className={`${place} btn-lift grid h-7 w-7 place-items-center rounded-md border border-violet-300 text-violet-700 hover:bg-violet-100`} title="Change the amount" aria-label="Change the amount" onClick={() => onAdjust(t)}>
      <PencilLine className="h-3.5 w-3.5" />
    </button>
  )
  /*
    On a phone every line looks the same (the user, 21 Oct: "make it same for hotel and others also", "let it
    have a standardised look"): its kind as a chip, what it is written out in full under it, and on the right
    the amount, then the bill and the pencil. A ride stacks a third row on the right, for its map.
  */
  const row = 'col-span-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1.5 py-2 text-sm sm:grid-cols-subgrid'
  const name = 'col-start-1 row-span-2 row-start-1 flex min-w-0 flex-col items-start gap-1 self-start sm:col-span-2 sm:row-span-1 sm:row-start-auto sm:flex-row sm:items-center sm:gap-2 sm:self-auto'
  // A bill's clip first for whoever attaches (the clips in one column); for an approver the bills beside the amount.
  // The bill on its own row under the amount and the pencil under it, as on a ride (the user, 21 Oct: "make it same like modes").
  const billCell = `col-span-2 col-start-2 row-start-2 flex items-center justify-end sm:col-span-1 sm:col-start-3 sm:row-start-auto${c.can_edit ? ' sm:justify-start' : ''}`
  const amtAt = 'col-span-2 col-start-2 row-start-1 sm:col-span-1 sm:col-start-4 sm:row-start-auto'
  // Whether a line has a bill to show; without one its pencil moves up into the bill's row.
  const showsBill = (id: string, needed: boolean) => c.can_edit || needed || data.bills.some(b => b.owner_id === id)
  const penAt = (r: 2 | 3 = 3) => `col-start-3 ${r === 2 ? 'row-start-2' : 'row-start-3'} ${hasMap ? 'sm:col-start-6' : 'sm:col-start-5'} sm:row-start-auto`
  // The kind and what it is: a chip with the words under it on a phone, the icon and one line on a computer.
  const lead = (Icon: LucideIcon, ink: string, label: string, tone: string, text: string, wide: string) => (
    <>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold sm:hidden ${tone}`}><Icon className="h-3.5 w-3.5" />{label}</span>
      {text && <span className="text-ink-800 sm:hidden">{text}</span>}
      <span className="hidden min-w-0 flex-1 items-center gap-2 sm:flex"><Icon className={`h-4 w-4 shrink-0 ${ink}`} /><span className="min-w-0 flex-1 truncate text-ink-800">{wide}</span></span>
    </>
  )
  // A ticket sits under the ride that arrives at its hospital (the user, 17 Oct: "move the ticket under the hospital name").
  const rideOf = (t: Day['tickets'][number]) => d.rides.find(r => r.id === t.id) ?? (t.place ? d.rides.find(r => (r.to_name ?? '').toLowerCase().includes(t.place!.toLowerCase().split(',')[0].trim())) : undefined)
  const loose = d.tickets.filter(t => !rideOf(t))
  return (
    <div className="card space-y-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{dayName(d.day)}{d.place ? ` · ${d.place}` : ''}{d.district ? `, ${d.district}` : ''}</p>
          <p className="text-sm text-ink-500">
            {dep && (d.dep_off
              ? <span title={d.dep_off} className="mr-1.5 inline-flex rounded-full bg-cyrixRed-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-cyrixRed-800">Outside {dep.state}</span>
              : <span className="mr-1.5 inline-flex rounded-full bg-violet-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-violet-800">Deputation</span>)}
            {[d.purpose, d.da_kind !== 'none' ? `DA ${daLabel?.toLowerCase()} ${money(d.da_amount)}` : null, tripDay].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* The day's km beside its money, as weighty (the user, 21 Oct: "km by modes, emphasise km also like the amount"). */}
          {d.rides.length > 0 && <><span className="font-semibold text-ink-900">{km(d.rides.reduce((t, r) => t + (r.map_km ?? r.claimed_km ?? 0), 0))}</span><span className="text-ink-300">·</span></>}
          <span className="mr-1 font-semibold text-ink-900">{money(dayTotal({ ...d, hotel: d.room_by ? null : d.hotel }, rule))}</span>
          {hasMap && <button type="button" className="btn-icon" title="See on map" aria-label="See on map" onClick={onMap}><MapIcon className="h-4 w-4 text-teal-600" /></button>}
          {c.can_edit && <button type="button" className="btn-icon" title="Edit" aria-label="Edit day" onClick={onEdit}><Pencil className="h-4 w-4" /></button>}
          {c.can_edit && <button type="button" className="btn-icon text-cyrixRed-600" title="Remove" aria-label="Remove day" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>

      <RouteStrip days={[d]} rule={rule} grade={c.grade} />

      {/* What the day's total is made of (the user, 19 Oct: "6116 in travel and others what, user should be clear"). */}
      {(() => {
        const parts = ([
          ['Travel', d.rides.reduce((t, r) => t + rideAmount(r, rule), 0)],
          ['DA', d.da_amount],
          ['Hotel', d.room_by ? 0 : d.hotel?.amount ?? 0],
          ['Other', d.expenses.reduce((t, x) => t + (x.amount || 0), 0)],
        ] as const).filter(([, v]) => v > 0)
        return parts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {parts.map(([label, v], i) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-ink-400">+</span>}
                <span className="rounded-md bg-ink-100 px-2 py-1 text-ink-600">{label} <b className="font-semibold text-ink-900">{money(v)}</b></span>
              </span>
            ))}
            <span className="text-ink-400">=</span>
            <span className="rounded-md bg-ink-900 px-2 py-1 font-semibold text-[color:rgb(var(--surface))]">Total {money(parts.reduce((t, [, v]) => t + v, 0))}</span>
            {(() => { const co = d.rides.reduce((t, r) => t + (companyOf(data.bills, r)?.net ?? 0), 0) + (d.hotel && !d.room_by ? companyOf(data.bills, d.hotel)?.net ?? 0 : 0); return co > 0 && <span className="text-ink-500">· trip cost {money(parts.reduce((t, [, v]) => t + v, 0) + co)}</span> })()}
          </div>
        )
      })()}

      {(
        <div data-details className="grid gap-x-2 divide-y divide-ink-100 rounded-xl bg-ink-50/60 px-3" style={{ gridTemplateColumns: cols }}>
          {hasMap && (
            <div className="col-span-full flex justify-end py-2">
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline" onClick={onMap}><MapIcon className="h-3.5 w-3.5" /> View on map</button>
            </div>
          )}
          {d.rides.map(r => {
            const m = MODES[r.mode], I = m.icon, bad = outOfPolicy(r.mode, rule)
            return (
              /*
                On a computer one line in the shared columns (the user, 18 Oct). On a phone the mode, then From and To
                one under the other, whole; the amount, the bill and the map and pencil stacked on the right beside
                them (the user, 21 Oct: "should we make from to up and down, so other things in right can be stacked").
              */
              <div key={r.id} id={'bill-' + r.id} className={row + mark(r.id)} style={lit(r.id, m.color)}>
                <div className={'col-start-1 row-span-3 row-start-1 flex min-w-0 flex-col items-start gap-1 self-start sm:row-span-1 sm:row-start-auto sm:flex-row sm:items-center sm:gap-2 sm:self-auto ' + (m.perKm ? 'sm:col-span-1' : 'sm:col-span-2')}>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold" style={{ background: m.bg, color: m.fg }}><I className="h-3.5 w-3.5" />{m.label}</span>
                    {/* A press says what the mark means — a phone has no hover (the user, 21 Oct). */}
                    {bad && <button type="button" className="btn-press grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyrixRed-600 text-[11px] font-bold text-white hover:bg-cyrixRed-700" title={policyNote(m.label, c.grade)} aria-label="Why the red mark"
                      onClick={() => void ask.alert('Needs prior approval', policyNote(m.label, c.grade), 'warn')}>!</button>}
                  </span>
                  {/* From, a small arrow, To (the user, 21 Oct: "show a small arrow also in the middle"). */}
                  <span className="grid min-w-0 grid-cols-[0.5rem_minmax(0,1fr)] items-start gap-x-2 text-ink-800 sm:hidden">
                    <i className="mt-[0.4rem] h-2 w-2 rounded-full border-2 border-ink-400" /><span>{short(r.from_name)}</span>
                    <ArrowDown className="h-3 w-3 justify-self-center text-ink-400" /><span />
                    <i className="mt-[0.4rem] h-2 w-2 rounded-full bg-ink-600" /><span>{short(r.to_name)}</span>
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-ink-800 sm:inline">{short(r.from_name)} → {short(r.to_name)}</span>
                </div>
                {m.perKm && <span className={`col-start-1 row-start-4 sm:col-start-2 sm:row-start-auto sm:text-right ${kmChanged(r) ? 'text-xs font-semibold text-amber-700' : 'text-xs text-ink-500'}`}>{km(r.claimed_km)}{r.map_km != null ? ` (map ${km(r.map_km)})` : ''}</span>}
                <span className={'col-span-2 col-start-2 row-start-2 flex items-center justify-end sm:col-span-1 sm:col-start-3 sm:row-start-auto' + (c.can_edit ? ' sm:justify-start' : '')}>
                  <BillButton compact claimId={c.id} kind="ride" ownerId={r.id} bills={data.bills} editable={c.can_edit} needed={needsBill('ride', r, over, rule)} claimed={m.perKm || r.company_booking ? undefined : rideAmount(r, rule)} onChange={onBills} />
                </span>
                {amt(r.id, rideAmount(r, rule), 'text-ink-900', 'col-span-2 col-start-2 row-start-1 sm:col-span-1 sm:col-start-4 sm:row-start-auto')}
                {r.from_lat != null && r.to_lat != null && (
                  <button type="button" className={`${onAdjust ? 'col-start-2' : 'col-start-3'} row-start-3 btn-lift grid h-7 w-7 place-items-center justify-self-end rounded-md border border-ink-200 text-teal-600 hover:border-teal-300 hover:bg-teal-50 sm:col-start-5 sm:row-start-auto`} title="This ride on the map" aria-label="This ride on the map"
                    onClick={() => onMapDays([d], `${short(r.from_name)} → ${short(r.to_name)}`, r.id)}><MapIcon className="h-3.5 w-3.5" /></button>
                )}
                {pen({ kind: 'ride', id: r.id, label: `${m.label} ${short(r.from_name)} → ${short(r.to_name)}`, unit: m.perKm ? 'km' : '₹', value: m.perKm ? (r.claimed_km ?? 0) : (r.fare ?? 0), amount: rideAmount(r, rule), rate: r.mode === 'bike' ? rule.bike_rate ?? 5 : r.mode === 'car' ? rule.car_rate ?? 11 : undefined, map: m.perKm ? r.map_km : null, tol, free: data.claim.status === 'with_desk' },
                  `col-start-3 row-start-3 ${hasMap ? 'sm:col-start-6' : 'sm:col-start-5'} sm:row-start-auto`)}
                {(r.purpose || r.project) && <span className="col-span-full pl-1 text-xs text-ink-500">{[r.purpose, r.project].filter(Boolean).join(' · ')}</span>}
                {r.note && <span className="col-span-full flex items-start gap-1.5 pl-1 text-xs text-ink-600"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />{r.note}</span>}
                {/* A round trip whose return is not on the claim yet (te_0058). */}
                {r.return_leg?.date && !data.days.some(x => x.rides.some(o => o.same_ticket?.ref === r.return_leg!.ref)) && (
                  <span className="col-span-full flex items-start gap-1.5 pl-1 text-xs font-semibold text-sky-700"><TicketIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Round trip · return on {new Date(r.return_leg.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, {r.return_leg.from} → {r.return_leg.to} — {c.can_edit ? 'add it on that day' : 'not claimed'}
                  </span>
                )}
                {(() => { const co = companyOf(data.bills, r); const when = co?.card?.travel_date; return co && (
                  <span className="col-span-full flex flex-wrap items-center gap-1.5 pl-1 text-xs font-semibold text-sky-800"><Building2 className="h-3.5 w-3.5" />Booked by company · {money(co.net)} · {co.booking_id}
                    {when && when !== d.day && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900">booked for {new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}</span>) })()}
                {d.tickets.filter(t => rideOf(t)?.id === r.id).map(t => {
                  const earlier = (t as typeof t & { earlier?: Array<{ day: string }> }).earlier ?? []
                  return (
                    <span key={t.id} className="col-span-full flex flex-wrap items-center gap-1.5 pl-1 text-xs text-sky-700">
                      <TicketIcon className="h-3.5 w-3.5" />Ticket {t.ticket_no}{t.service_report ? ` · SR ${t.service_report}` : ''}
                      {earlier.length > 0 && <b>· {ordinal(earlier.length + 1)} visit</b>}
                      <ReportButton claimId={c.id} ticketId={t.id} bills={data.bills} editable={c.can_edit} onChange={onBills} />
                    </span>
                  )
                })}
              </div>
            )
          })}
          {loose.map(t => {
            const earlier = (t as typeof t & { earlier?: Array<{ day: string; name: string; mine: boolean }> }).earlier ?? []
            return (
              <div key={t.id} id={'bill-' + t.id} className={'col-span-full flex flex-wrap items-center gap-2 py-2 text-sm' + mark(t.id)} style={lit(t.id, '#0284C7')}>
                <TicketIcon className="h-4 w-4 text-sky-600" />
                <span className="text-ink-800">{t.ticket_no}{t.place ? ` · ${t.place}` : ''}{t.service_report ? ` · SR ${t.service_report}` : ''}</span>
                {earlier.length > 0 && <span className="text-xs font-semibold text-sky-700">{ordinal(earlier.length + 1)} visit</span>}
                {/* A hospital none of the day's rides went to (the user, 21 Oct). */}
                {ticketVisited(t, d.rides) === false && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Not visited on this day's rides</span>}
                <span className="ml-auto"><ReportButton claimId={c.id} ticketId={t.id} bills={data.bills} editable={c.can_edit} onChange={onBills} /></span>
              </div>
            )
          })}
          {d.hotel && !d.room_by && (() => {
            const limit = hotelLimit(rule, d.hotel, outOfState, Number(data.policy.metro_extra_pct ?? 20))
            return (
              <div id={'bill-' + d.hotel.id} className={row + mark(d.hotel.id)} style={lit(d.hotel.id, '#7C3AED')}>
                <span className={name}>{(() => { const t = `${d.hotel.name || 'Hotel'} · ${d.hotel.occupancy}${d.hotel.shared_name ? ` · with ${d.hotel.shared_name}` : ''}`; return lead(BedDouble, 'text-violet-600', 'Hotel', 'bg-violet-100 text-violet-900', t, t) })()}</span>
                <span className={billCell}>
                  <BillButton compact claimId={c.id} kind="hotel" ownerId={d.hotel.id} bills={data.bills} editable={c.can_edit} needed claimed={d.hotel.amount} onChange={onBills} />
                </span>
                {amt(d.hotel.id, d.hotel.amount, limit != null && d.hotel.amount > limit ? 'text-amber-700' : 'text-ink-900', amtAt)}
                {pen({ kind: 'hotel', id: d.hotel.id, label: d.hotel.name || 'Hotel', unit: '₹', value: d.hotel.amount, amount: d.hotel.amount }, penAt())}
                {d.hotel.note && <span className="col-span-full flex items-start gap-1.5 pl-1 text-xs text-ink-600"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />{d.hotel.note}</span>}
                {(() => { const co = companyOf(data.bills, d.hotel!); return co && <span className="col-span-full flex items-center gap-1.5 pl-1 text-xs font-semibold text-sky-800"><Building2 className="h-3.5 w-3.5" />Booked by company · {money(co.net)} · {co.booking_id}</span> })()}
              </div>
            )
          })()}
          {d.room_by && (
            <div className={row}>
              <span className={name}>{(() => { const t = `Room shared · claimed by ${d.room_by.name} (${d.room_by.ecode})${d.room_by.number ? ` on ${d.room_by.number}` : ''}`; return lead(BedDouble, 'text-green-600', 'Hotel', 'bg-green-100 text-green-900', t, t) })()}</span>
              <span className={`${amtAt} text-right font-medium text-ink-500`}>{money(d.room_by.amount)}</span>
            </div>
          )}
          {d.expenses.map(x => (
            <div key={x.id} id={'bill-' + x.id} className={row + mark(x.id)} style={lit(x.id, '#D97706')}>
              <span className={name}>{lead(expenseIcon(x.category), 'text-amber-600', x.category, 'bg-amber-100 text-amber-900', x.description ?? '', `${x.category}${x.description ? ` · ${x.description}` : ''}`)}</span>
              {showsBill(x.id, needsBill('expense', x, over)) && <span className={billCell}>
                <BillButton compact claimId={c.id} kind="expense" ownerId={x.id} bills={data.bills} editable={c.can_edit} needed={needsBill('expense', x, over)} claimed={x.amount} onChange={onBills} />
              </span>}
              {amt(x.id, x.amount, 'text-ink-900', amtAt)}
              {pen({ kind: 'expense', id: x.id, label: `${x.category}${x.description ? ' · ' + x.description : ''}`, unit: '₹', value: x.amount, amount: x.amount }, penAt(showsBill(x.id, needsBill('expense', x, over)) ? 3 : 2))}
            </div>
          ))}
          {(d.da_kind !== 'none' || d.da_amount > 0) && (
            <div id={'bill-' + d.id} className={row + mark(d.id)} style={lit(d.id, '#0D9488')}>
              <span className={name}>{lead(HandCoins, 'text-teal-600', 'DA', 'bg-teal-100 text-teal-800', daLabel ?? '', `DA · ${daLabel?.toLowerCase()}`)}</span>
              {amt(d.id, d.da_amount, 'text-ink-900', amtAt)}
              {pen({ kind: 'da', id: d.id, label: `DA · ${daLabel?.toLowerCase()} · ${dayName(d.day)}`, unit: '₹', value: d.da_amount, amount: d.da_amount }, penAt(2))}
            </div>
          )}
          {d.remarks && <p className="col-span-full py-2 text-sm text-ink-600">{d.remarks}</p>}
        </div>
      )}
    </div>
  )
}

function DeskPanel({ data, onDone }: { data: ClaimData; onDone: (m: string) => void }) {
  const c = data.claim
  const act = useClaimAction()
  const ask = useAsk()
  const [paidOn, setPaidOn] = useState(todayIso())
  const [utr, setUtr] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <Wallet className="mb-2 h-5 w-5 text-teal-600" />
      <label className="block"><span className="label">Paid on</span>
        <input type="date" className="input mt-1 w-44" max={todayIso()} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>
      <label className="block"><span className="label">UTR</span>
        <input className="input mt-1 w-56 font-mono uppercase" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Transaction reference" /></label>
      <button type="button" className="btn-primary" disabled={!paidOn || utr.replace(/\s/g, '').length < 6} onClick={async () => { setErr(null); if (!(await ask.confirm({ title: `Mark ${c.number ?? 'this claim'} paid?`, body: `${c.name} · UTR ${utr.trim().toUpperCase()}`, yes: 'Mark paid', icon: Wallet, go: true }))) return; try { await act.mutateAsync({ fn: 'te_mark_paid', args: { p_claim: c.id, p_paid_on: paidOn, p_ref: utr } }); onDone('Marked paid.') } catch (e) { setErr((e as Error).message) } }}><Check className="h-4 w-4" /> Mark paid</button>
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
/*
  Each observation is a kind with a short title, its detail and its day, shown as a list rather than
  coloured blocks (the user, 19 Oct: "make this more professional and beautiful"): what needs approval
  first, then what to check, then what is for information.
*/
type Obs = { kind: keyof typeof OBS; detail: string; day?: string; to?: string; sub?: string }
const OBS = {
  policy:   { title: 'Not in grade policy',      level: 'approve', icon: ShieldAlert },
  nobill:   { title: 'Bill missing',             level: 'approve', icon: Paperclip },
  twin:     { title: 'Possible duplicate bill',  level: 'approve', icon: Copy },
  km:       { title: 'Km changed from the map', level: 'check',   icon: Gauge },
  kmfixed:  { title: 'Km changed from the map · corrected', level: 'info', icon: Gauge },
  billdiff: { title: 'Bill amount differs',      level: 'check',   icon: ReceiptText },
  unread:   { title: 'Bill amount not read',     level: 'check',   icon: ReceiptText },
  hotel:    { title: 'Over the hotel limit',     level: 'check',   icon: BedDouble },
  away:     { title: 'Hospital not visited',     level: 'check',   icon: MapPinOff },
  home:     { title: 'Home moved',               level: 'check',   icon: House },
  homemap:  { title: 'Home set on the map',      level: 'check',   icon: House },
  company:  { title: 'Booked by company',        level: 'info',    icon: Building2 },
  cdate:    { title: 'Not the booked date',      level: 'check',   icon: CalendarRange },
  cmiss:    { title: 'Company booking not claimed', level: 'check', icon: Building2 },
  autofare: { title: 'Auto fare above the usual', level: 'check',  icon: CarTaxiFront },
  tdate:    { title: "Not the ticket's date",    level: 'check',   icon: CalendarRange },
  retdiff:  { title: 'Return not as on the ticket', level: 'check', icon: TicketIcon },
  da:       { title: 'DA above the map',         level: 'check',   icon: HandCoins },
  depoff:   { title: 'Outside the deputation state', level: 'approve', icon: MapPinOff },
  depout:   { title: 'Deputation DA outside its dates', level: 'approve', icon: BriefcaseBusiness },
  month:    { title: 'Over the monthly limit',   level: 'check',   icon: CalendarRange },
  changed:  { title: 'Changed by an approver',   level: 'info',    icon: PencilLine },
  visit:    { title: 'Ticket visited before',    level: 'info',    icon: TicketIcon },
} as const
const LEVEL = {
  approve: { label: 'need approval', chip: 'bg-cyrixRed-100 text-cyrixRed-700', dot: 'bg-cyrixRed-600' },
  check:   { label: 'to check',      chip: 'bg-amber-100 text-amber-700',       dot: 'bg-amber-500' },
  info:    { label: 'for information', chip: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-500' },
} as const

/** What a claim's approver should look at, each with its level (approve, check, info) — the Approvals page asks it too. */
export function claimObservations(data: ClaimData): Obs[] {
  const rule = data.rule, tol = Number(data.policy.km_tolerance_pct ?? 10), over = Number(data.policy.bill_over ?? 300)
  const metro = Number(data.policy.metro_extra_pct ?? 20)
  const items: Obs[] = []
  const dn = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const changedLines = (data.adjustments ?? []).map(a => a.item_id)
  let nth = 0
  for (const e of data.history ?? []) if (e.action === 'adjusted' && e.note) {
    const to = changedLines[nth++]
    const [what, ...why] = e.note.split('\n')
    const [day, ...rest] = what.split(' · ')
    items.push({ kind: 'changed', day, to, detail: `${(e.actor ?? 'An approver').split(' ')[0]}${e.role ? ` (${e.role})` : ''}: ${rest.join(' · ') || what}${why.join(' ').trim() ? ` — “${why.join(' ').trim()}”` : ''}` })
  }
  // A home moved while the claim was open (te_0041; the user, 21 Oct: "showing to approver is enough").
  for (const m of data.home_moves ?? []) items.push({ kind: 'home', day: dn(m.at.slice(0, 10)), detail: `Moved ${m.km != null ? km(Number(m.km)) : ''}${m.how === 'map' ? ' · set on the map' : ''}` })
  // A home set on the map, not by standing there (te_0053), until the person presses I'm at home there.
  if (data.home?.how === 'map' && !(data.home_moves ?? []).some(m => m.how === 'map')) items.push({ kind: 'homemap', day: dn(data.home.set_at.slice(0, 10)), detail: 'Not marked standing at home' })
  // The company's bookings for this person in the month that are on no claim (te_0042).
  for (const b of data.company_unlinked ?? []) items.push({ kind: 'cmiss', day: b.travel_date ? dn(b.travel_date) : undefined,
    detail: `${b.mode === 'hotel' ? `Hotel ${b.hotel ?? ''}${b.to ? ', ' + b.to : ''}` : `${b.mode[0].toUpperCase() + b.mode.slice(1)} ${b.from ?? '—'} → ${b.to ?? '—'}`} · ${b.booking_id} · ${money(Number(b.net))}` })
  const billed = new Set(data.bills.map(b => b.owner_id))
  // Bills on a line, none of whose amounts could be read.
  const unread = (owner: string) => { const mine = data.bills.filter(b => b.owner_id === owner); return mine.length > 0 && mine.every(b => b.ocr_amount == null) }
  for (const d of data.days) {
    const day = dn(d.day)
    for (const r of d.rides) {
      const m = MODES[r.mode], k = m.perKm ? kmOver(r, tol) : null
      const leg = `${m.label} · ${short(r.from_name)} → ${short(r.to_name)}`
      if (outOfPolicy(r.mode, rule)) items.push({ kind: 'policy', day, to: r.id, detail: `${m.label} is not in grade ${data.claim.grade ?? '—'}'s policy — prior approval needed` })
      if (needsBill('ride', r, over, rule) && !billed.has(r.id)) items.push({ kind: 'nobill', day, to: r.id, detail: leg })
      // Any km changed from the map's (te_0060; the user, 23 Oct).
      /*
        The km an approver changed keeps the engineer's own figure beside the map's, under the approver's change (the
        user, 27 Oct: "better to add, bcz travel desk can understand it", "under that sub tree show km changed ie eng
        did"); for information, no longer out of policy.
      */
      const fixes = m.perKm ? (data.adjustments ?? []).filter(a => a.item_id === r.id && a.unit === 'km') : []
      const typed = fixes[0]?.old_value
      if (fixes.length && typed != null && r.map_km != null && Math.abs(typed - r.map_km) > 0.05) {
        const last = fixes[fixes.length - 1], who = data.claim.name.split(' ')[0]
        const under = items.find(i => i.kind === 'changed' && i.to === r.id)
        if (under) under.sub = `${who} typed ${km(typed)}, the map gives ${km(r.map_km)}`
        else items.push({ kind: 'kmfixed', day, to: r.id, detail: `${leg} · ${who} typed ${km(typed)}, the map gives ${km(r.map_km)} · corrected by ${(last.by ?? 'an approver').split(' ')[0]} to ${km(last.new_value)}` })
      } else if (m.perKm && !fixes.length && kmChanged(r)) items.push({ kind: 'km', day, to: r.id, detail: `${leg} · typed ${km(r.claimed_km)}, the map gives ${km(r.map_km)}${k && k.over > 0 ? ` — ${km(k.over)} over the ${tol}%` : ''}` })
      // A ride the company booked: not claimed; its date set against the booking's (te_0042).
      const co = companyOf(data.bills, r)
      if (co) {
        items.push({ kind: 'company', day, to: r.id, detail: `${leg} · ${co.booking_id} · ${money(co.net)} not claimed` })
        if (co.card?.travel_date && co.card.travel_date !== d.day) items.push({ kind: 'cdate', day, to: r.id, detail: `${leg} · booked for ${dn(co.card.travel_date)}, claimed on ${day}` })
      }
      // A ticket for another day than the one claimed (te_0057); a return claimed otherwise than its ticket says (te_0056).
      if (r.ticket_date && r.ticket_date !== d.day) items.push({ kind: 'tdate', day, to: r.id, detail: `${leg} · ticket for ${dn(r.ticket_date)}, claimed on ${day}` })
      const st = r.same_ticket
      if (st) {
        const far = (lat?: number, lng?: number, lat2?: number | null, lng2?: number | null) => lat != null && lng != null && lat2 != null && lng2 != null && distanceKm({ lat, lng }, { lat: lat2, lng: lng2 }) > 30
        if ((st.date && st.date !== d.day) || far(st.fromLat, st.fromLng, r.from_lat, r.from_lng) || far(st.toLat, st.toLng, r.to_lat, r.to_lng)) {
          items.push({ kind: 'retdiff', day, to: r.id, detail: `On the ${dn(st.day)} ticket (${st.ref}): ${st.from} → ${st.to}${st.date ? ', ' + dn(st.date) : ''} · claimed ${short(r.from_name)} → ${short(r.to_name)}, ${day}` })
        }
      }
      const read = m.perKm ? null : billRead(data.bills, r.id)
      /*
        An auto fare without a bill that bears it out, set against what autos usually cost here (te_0051; the
        user, 21 Oct): other people's fares a km nearby, or the policy's rate until there are enough.
      */
      if (r.mode === 'auto' && r.auto_norm && r.map_km && r.fare && !(read != null && Math.abs(read - r.fare) <= 1)) {
        const usual = Math.max(Number(data.policy.auto_min_fare ?? 30), r.auto_norm.per_km * r.map_km)
        if (r.fare > usual * 1.4) items.push({ kind: 'autofare', day, to: r.id, detail: `${leg} · ${money(r.fare)} for ${km(r.map_km)} · ${r.auto_norm.from === 'nearby' ? 'around here' : 'the usual fare is'} about ${money(Math.round(usual / 5) * 5)}` })
      }
      if (read != null && Math.abs(read - (r.fare ?? 0)) > 1) items.push({ kind: 'billdiff', day, to: r.id, detail: `${leg} · claimed ${money(r.fare)}, the bill reads ${money(read)}` })
      // A bill whose amount the reader was not sure of (a dark GPay screenshot, a handwritten bill): said, so it is opened (the user, 22 Oct: typed 650, GPay showed 500).
      if (unread(r.id) && (r.fare ?? 0) > 0) items.push({ kind: 'unread', day, to: r.id, detail: `${leg} · ${money(r.fare)} claimed — the bill's amount could not be read; open it and compare` })
    }
    if (d.hotel && !d.room_by) {
      const lim = hotelLimit(rule, d.hotel, d.da_kind === 'out_state_stay', metro)
      if (lim != null && d.hotel.amount > lim) items.push({ kind: 'hotel', day, to: d.hotel.id, detail: `${money(d.hotel.amount)} against a limit of ${money(lim)}` })
      if (needsBill('hotel', d.hotel, over) && !billed.has(d.hotel.id)) items.push({ kind: 'nobill', day, to: d.hotel.id, detail: 'Hotel night' })
      const hc = companyOf(data.bills, d.hotel)
      if (hc) {
        items.push({ kind: 'company', day, to: d.hotel.id, detail: `Hotel night · ${hc.booking_id} · ${money(hc.net)} not claimed` })
        const from = hc.card?.travel_date, to = hc.card?.end_date
        if (from && (d.day < from || (to ? d.day >= to : d.day !== from))) items.push({ kind: 'cdate', day, to: d.hotel.id, detail: `Hotel night · booked ${dn(from)}${to ? ' – ' + dn(to) : ''}, claimed on ${day}` })
      }
      const hr = billRead(data.bills, d.hotel.id)
      if (hr != null && Math.abs(hr - d.hotel.amount) > 1) items.push({ kind: 'billdiff', day, to: d.hotel.id, detail: `Hotel · claimed ${money(d.hotel.amount)}, the bill reads ${money(hr)}` })
      if (unread(d.hotel.id) && d.hotel.amount > 0) items.push({ kind: 'unread', day, to: d.hotel.id, detail: `Hotel · ${money(d.hotel.amount)} claimed — the bill's amount could not be read; open it and compare` })
    }
    // Deputation (te_0075): a place in another state is red (the user, 26 Oct: "in observation it should show as
    // critical if claming from other states"), and so is its DA on a day no approved deputation covers.
    const dep = depOn(data.deputations, d.day)
    if (dep && d.dep_off) items.push({ kind: 'depoff', day, to: d.id, detail: `${d.dep_off} · the deputation is in ${dep.state}` })
    if (!dep && d.da_kind === 'deputation') items.push({ kind: 'depout', day, to: d.id, detail: `DA ${money(d.da_amount)} · no approved deputation on this day` })
    if (d.da_auto && DA_RANK[d.da_kind] > DA_RANK[d.da_auto]) items.push({ kind: 'da', day, to: d.id, detail: `Claimed ${DA_KINDS.find(k => k.code === d.da_kind)?.label.toLowerCase()}, the map says ${DA_KINDS.find(k => k.code === d.da_auto)?.label.toLowerCase()}` })
    for (const x of d.expenses) {
      const xr = billRead(data.bills, x.id)
      if (xr != null && Math.abs(xr - x.amount) > 1) items.push({ kind: 'billdiff', day, to: x.id, detail: `${x.category} · claimed ${money(x.amount)}, the bill reads ${money(xr)}` })
      if (unread(x.id) && x.amount > 0) items.push({ kind: 'unread', day, to: x.id, detail: `${x.category} · ${money(x.amount)} claimed — the bill's amount could not be read; open it and compare` })
      if (needsBill('expense', x, over) && !billed.has(x.id)) items.push({ kind: 'nobill', day, to: x.id, detail: `${x.category} · ${money(x.amount)}` })
    }
    for (const t of d.tickets) {
      const earlier = (t as typeof t & { earlier?: Array<{ day: string; name: string; mine: boolean }> }).earlier ?? []
      if (ticketVisited(t, d.rides) === false) items.push({ kind: 'away', day, to: t.id, detail: `Ticket ${t.ticket_no} · ${t.place} is not on this day's rides` })
      if (earlier.length) items.push({ kind: 'visit', day, to: d.id, detail: `Ticket ${t.ticket_no} · before on ${earlier.map(e => dn(e.day) + (e.mine ? '' : ' by ' + e.name)).join(', ')}` })
    }
  }
  /*
    Two bills alike on this claim are one observation, naming both lines (the user, 19 Oct: "can we merge
    duplicate comments, like easy to understand"); one alike a bill on another claim says which.
  */
  const lineOf = (id: string | null | undefined) => {
    for (const d of data.days) {
      const r = d.rides.find(x => x.id === id)
      if (r) return { day: dn(d.day), text: `${MODES[r.mode].label} ${short(r.from_name)} → ${short(r.to_name)}` }
      if (d.hotel && d.hotel.id === id) return { day: dn(d.day), text: `Hotel night${d.hotel.name ? ' · ' + d.hotel.name : ''}` }
      const x = d.expenses.find(e => e.id === id)
      if (x) return { day: dn(d.day), text: x.category }
    }
    return null
  }
  const pairs = new Set<string>()
  for (const b of data.bills) if (b.twin) {
    const here = lineOf(b.owner_id)
    if (b.twin_claim === data.claim.id && b.twin_owner) {
      const key = [b.owner_id, b.twin_owner].sort().join('|')
      if (pairs.has(key)) continue
      pairs.add(key)
      const there = lineOf(b.twin_owner)
      items.push({ kind: 'twin', day: here?.day, to: b.owner_id, detail: b.twin_owner === b.owner_id
        ? `Two bills on ${here?.text ?? 'one line'} look alike`
        : `${here?.text ?? 'A line'} and ${there?.text ?? 'another line'} have the same-looking bill` })
    } else items.push({ kind: 'twin', day: here?.day, to: b.owner_id, detail: `${here?.text ?? 'A bill'} · looks like the bill on ${b.twin}` })
  }
  if (rule.bike_km_month && data.km_month.bike > rule.bike_km_month) items.push({ kind: 'month', detail: `Bike ${km(data.km_month.bike)} this month, over ${rule.bike_km_month} km` })
  if (rule.car_km_month && data.km_month.car > rule.car_km_month) items.push({ kind: 'month', detail: `Car ${km(data.km_month.car)} this month, over ${rule.car_km_month} km` })
  const autoCap = Number(data.policy.auto_month ?? 1000)
  if (data.km_month.auto > autoCap) items.push({ kind: 'month', detail: `Auto ${money(data.km_month.auto)} this month, over ${money(autoCap)}` })
  return items
}
/** What keeps a claim out of Approve all: each kind to approve or check, once ("Not in grade policy", "Bill missing"). */
export const claimIssues = (data: ClaimData) => {
  const seen = new Map<string, { title: string; level: 'approve' | 'check'; icon: LucideIcon }>()
  for (const i of claimObservations(data)) { const o = OBS[i.kind]; if (o.level !== 'info' && !seen.has(o.title)) seen.set(o.title, { title: o.title, level: o.level, icon: o.icon }) }
  return [...seen.values()]
}

function Observations({ data, onGo }: { data: ClaimData; onGo: (id: string) => void }) {
  const items = claimObservations(data)
  if (!items.length) return data.days.length ? <p className="text-sm text-green-800"><Check className="mr-1 inline h-4 w-4" />Nothing to look at twice on this claim.</p> : null

  const order = ['approve', 'check', 'info'] as const
  const sorted = [...items].sort((x, y) => order.indexOf(OBS[x.kind].level) - order.indexOf(OBS[y.kind].level))
  const count = (l: typeof order[number]) => items.filter(i => OBS[i.kind].level === l).length
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-100 bg-ink-50 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900"><TriangleAlert className="h-4 w-4 text-amber-600" /> Observations</h2>
        <span className="flex flex-wrap gap-1.5">
          {order.filter(l => count(l)).map(l => (
            <span key={l} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL[l].chip}`}>
              <i className={`h-1.5 w-1.5 rounded-full ${LEVEL[l].dot}`} />{count(l)} {LEVEL[l].label}
            </span>
          ))}
        </span>
      </div>
      <ul className="divide-y divide-ink-100">
        {sorted.map((it, i) => {
          const o = OBS[it.kind], I = o.icon
          return (
            <li key={i} role={it.to ? 'button' : undefined} tabIndex={it.to ? 0 : undefined} onClick={it.to ? () => onGo(it.to!) : undefined}
              onKeyDown={it.to ? e => { if (e.key === 'Enter') onGo(it.to!) } : undefined}
              className={`flex items-start gap-3 px-4 py-2.5 ${it.to ? 'cursor-pointer transition-colors hover:bg-ink-100/60' : ''}`}>
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${LEVEL[o.level].chip}`}><I className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{o.title}</span>
                <span className="block text-sm text-ink-600">{it.detail}</span>
                {it.sub && (
                  <span className="mt-1.5 flex items-start gap-1.5 border-l-2 border-ink-200 pl-2.5 text-[13px] text-ink-500">
                    <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><b className="font-semibold text-ink-700">Km changed from the map</b> · {it.sub}</span>
                  </span>
                )}
              </span>
              {it.day && <span className="shrink-0 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">{it.day}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Each status's colour, for the claim's header (the badge's own colours, as one strong hue). */
const HEAD: Record<string, string> = {
  draft: '#94A3B8', with_manager: '#F59E0B', with_coordinator: '#8B5CF6', with_desk: '#0EA5E9',
  approved: '#16A34A', paid: '#0D9488', returned: '#E30613', recalled: '#F97316',
}

/** The rides, hotel nights and expenses still without the bill the policy asks for, named for the person. */
function missingBills(data: ClaimData, over: number): Array<{ id: string; label: string }> {
  const billed = new Set(data.bills.map(b => b.owner_id)), rule = data.rule, out: Array<{ id: string; label: string }> = []
  for (const d of data.days) {
    const dn = new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    for (const r of d.rides) if (needsBill('ride', r, over, rule) && !billed.has(r.id)) out.push({ id: r.id, label: `${dn} · ${MODES[r.mode].label} ride ${short(r.from_name)} → ${short(r.to_name)} · ${money(rideAmount(r, rule))}` })
    if (d.hotel && !d.room_by && !billed.has(d.hotel.id)) out.push({ id: d.hotel.id, label: `${dn} · Hotel night ${d.hotel.name ?? ''} · ${money(d.hotel.amount)}` })
    for (const x of d.expenses) if (needsBill('expense', x, over) && !billed.has(x.id)) out.push({ id: x.id, label: `${dn} · ${x.category} · ${money(x.amount)}` })
  }
  return out
}

const short = (s: string | null) => (s ? s.split(',')[0] : '—')
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
