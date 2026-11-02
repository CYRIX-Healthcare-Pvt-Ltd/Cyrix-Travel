import { useRef, useState } from 'react'
import { Check, CornerUpLeft, FileText, Plus, Send, Trash2, Undo2, Upload } from 'lucide-react'
import Dialog from '@/components/Dialog'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { MODES, rpc } from '@/lib/claims'
import { clockTime } from '@/lib/when'
import { depDays, depRange, dropLetter, letterUrl, uploadLetter } from '@/lib/deputation'
import { VA_STATUS, useMyVehicles, useVehicleInbox, useVehicleRefresh, type InboxVehicle, type VehicleApproval, type VehicleMode } from '@/lib/vehicles'

/*
  Vehicle approval, a tab of My profile (te_0096; the user, 2 Nov: "for some grades some vehicles may be out of policy
  … that all he can request and manager can remove it also after approval"): only the vehicles the grade does not give
  can be asked for; the reporting manager approves, then the Travel Desk.
*/
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const range = (v: VehicleApproval) => depRange(v.from_day, v.status === 'removed' ? v.until : v.to_day)
const btn = 'btn-secondary !gap-1 !px-2.5 !py-1.5 text-xs whitespace-nowrap'

function ModeIcon({ mode }: { mode: VehicleMode }) {
  const m = MODES[mode], I = m.icon
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700"><I className="h-5 w-5" /></span>
}

/** Who did what, in one line under the row. */
function Trail({ v }: { v: VehicleApproval }) {
  return (
    <p className="text-xs text-ink-500">
      Asked {day(v.created_at)}, {clockTime(v.created_at)}
      {v.manager_name && v.manager_at && ` · manager: ${v.manager_name} ${day(v.manager_at)}`}
      {v.desk_name && v.desk_at && ` · Travel Desk: ${v.desk_name} ${day(v.desk_at)}`}
      {v.returned_name && v.returned_at && ` · sent back by ${v.returned_name} ${day(v.returned_at)}`}
      {v.removed_name && v.removed_at && ` · removed by ${v.removed_name} ${day(v.removed_at)}`}
    </p>
  )
}

export default function VehicleApprovals() {
  const ask = useAsk()
  const refresh = useVehicleRefresh()
  const { data, isLoading } = useMyVehicles()
  const [form, setForm] = useState(false)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [err, setErr] = useState<{ id: string; text: string; n: number } | null>(null)
  const items = data?.items ?? []
  const modes = data?.modes ?? []
  const manager = data?.manager?.split(' ')[0] ?? 'manager'
  const fail = (id: string, text: string) => setErr(x => ({ id, text, n: (x?.n ?? 0) + 1 }))
  const errAt = (id: string) => err?.id === id && <div className="mt-2"><Alert key={err.n} kind="error">{err.text}</Alert></div>

  const add = () => {
    setErr(null)
    if (!modes.length) fail('add', 'Every vehicle is in your grade’s policy')
    else setForm(true)
  }
  const openLetter = async (v: VehicleApproval) => {
    const url = v.letter_path && await letterUrl(v.letter_path)
    if (url) setViewing({ url, name: v.letter_name ?? 'Letter' })
    else fail(v.id, 'The letter could not be opened')
  }
  const withdraw = async (v: VehicleApproval) => {
    if (!(await ask.confirm({ title: 'Withdraw the request?', body: `${v.label} · ${range(v)}`, yes: 'Withdraw', icon: Undo2 }))) return
    setErr(null)
    try { await rpc('te_va_withdraw', { p_id: v.id }); await refresh(); await ask.alert('Request withdrawn') }
    catch (e) { fail(v.id, (e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary !py-1.5 text-sm" onClick={add}><Plus className="h-4 w-4" /> Ask for a vehicle</button>
        </div>
        {errAt('add')}
      </div>

      {isLoading ? <div className="card grid place-items-center p-8"><Spinner className="h-5 w-5" /></div>
        : items.length === 0 ? <div className="card p-8 text-center text-sm text-ink-500">No vehicle approval yet.</div>
        : (
          <div className="card divide-y divide-ink-100 overflow-hidden">
            {items.map(v => {
              const s = VA_STATUS[v.status]
              const waiting = v.status === 'with_manager' || v.status === 'with_desk'
              const n = depDays(v.from_day, v.to_day)
              return (
                <div key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <ModeIcon mode={v.mode} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-900">{v.label}{v.number && <span className="ml-1.5 font-mono text-xs font-normal text-ink-500">{v.number}</span>}</p>
                      <p className="truncate text-xs text-ink-500">{range(v)} · {n} {n === 1 ? 'day' : 'days'}</p>
                    </div>
                    <span className={`badge shrink-0 whitespace-nowrap ${s.tone}`}>{v.status === 'with_manager' ? `With ${manager}` : s.label}</span>
                    {(v.letter_path || waiting) && (
                      <div className="flex w-full gap-1.5 sm:w-auto">
                        {v.letter_path && <button type="button" className={btn} onClick={() => void openLetter(v)}><FileText className="h-3.5 w-3.5" /> Letter</button>}
                        {waiting && <button type="button" className={btn} onClick={() => void withdraw(v)}><Undo2 className="h-3.5 w-3.5" /> Withdraw</button>}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-700">“{v.reason}”</p>
                  <Trail v={v} />
                  {v.note && (v.status === 'returned' || v.status === 'removed') && <p className="mt-2 rounded-lg bg-cyrixRed-50 px-3 py-2 text-xs text-cyrixRed-800">{v.status === 'returned' ? 'Sent back' : 'Removed'}: “{v.note}”</p>}
                  {errAt(v.id)}
                </div>
              )
            })}
          </div>
        )}

      {form && <VehicleForm modes={modes} manager={manager} onClose={() => setForm(false)} onSent={refresh} />}
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}

function VehicleForm({ modes, manager, onClose, onSent }: { modes: VehicleMode[]; manager: string; onClose: () => void; onSent: () => Promise<unknown> }) {
  const ask = useAsk()
  const { employee } = useAuth()
  const [mode, setMode] = useState<VehicleMode | null>(modes.length === 1 ? modes[0] : null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [why, setWhy] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const fail = (text: string) => setErr(x => ({ text, n: (x?.n ?? 0) + 1 }))

  const send = async () => {
    setErr(null)
    if (!mode) return fail('Choose the vehicle')
    if (!from || !to) return fail('Choose the from and to dates')
    if (to < from) return fail('The to date is before the from date')
    if (why.trim().length < 3) return fail('Write why')
    const what = `${MODES[mode].label} · ${depRange(from, to)}`
    if (!(await ask.confirm({ title: `Send to ${manager}?`, body: what, yes: 'Send', icon: Send, go: true }))) return
    setBusy(true)
    let uploaded: string | null = null
    try {
      if (file) uploaded = await uploadLetter(employee!.id, file)
      await rpc('te_va_request', { p_mode: mode, p_from: from, p_to: to, p_reason: why.trim(), p_path: uploaded, p_name: file?.name ?? null })
      await onSent()
      onClose()
      await ask.alert(`Sent to ${manager}`, what, 'success')
    } catch (e) {
      if (uploaded) await dropLetter(uploaded)
      fail((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog title="Ask for a vehicle" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="label">Vehicle</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {modes.map(c => {
              const m = MODES[c], I = m.icon
              return (
                <button key={c} type="button" aria-pressed={mode === c} onClick={() => setMode(c)}
                  className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-sm font-semibold ${mode === c ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-800 hover:border-ink-400'}`}>
                  <I className="h-5 w-5" /> {m.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">From</span><input type="date" className="input mt-1 h-11" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="block"><span className="label">To</span><input type="date" className="input mt-1 h-11" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <label className="block">
          <span className="label">Why</span>
          <textarea className="input mt-1 min-h-[5rem]" value={why} maxLength={500} placeholder="Customer asked for it, heavy equipment…" onChange={e => setWhy(e.target.value)} />
        </label>
        <div>
          <span className="label">Letter (if any)</span>
          <input ref={pick} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = '' }} />
          <button type="button" onClick={() => pick.current?.click()}
            className={`mt-1 flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left text-sm ${file ? 'border-violet-300 bg-violet-50 text-ink-900' : 'border-ink-300 text-ink-600 hover:border-ink-400'}`}>
            {file ? <FileText className="h-5 w-5 shrink-0 text-violet-600" /> : <Upload className="h-5 w-5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{file?.name ?? 'Upload letter'}</span>
            {file && <span className="shrink-0 text-xs font-semibold text-violet-700">Replace</span>}
          </button>
        </div>
        {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary btn-go" disabled={busy} onClick={() => void send()}>
            {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Send to {manager}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/*
  The Approvals page's Vehicle view: requests waiting on this person (the manager's step, or the Travel Desk's),
  and the approved ones a manager can remove. Every decision asks first; send back and remove ask why.
*/
const TABS = [['waiting', 'To approve'], ['done', 'Approved'], ['returned', 'Sent back']] as const
type Tab = typeof TABS[number][0]
const EMPTY: Record<Tab, string> = { waiting: 'No vehicle request for you to approve.', done: 'Nothing approved yet.', returned: 'Nothing sent back or removed.' }
const COUNT: Record<Tab, string> = { waiting: 'bg-cyrixRed-600 text-white', done: 'bg-green-600 text-white', returned: 'bg-ink-600 text-white' }

export function VehicleInbox() {
  const { data, isLoading, error } = useVehicleInbox()
  const [tab, setTab] = useState<Tab>('waiting')
  if (isLoading) return <PageLoader />
  const all = data ?? []
  const lists: Record<Tab, InboxVehicle[]> = {
    waiting: all.filter(v => v.waiting),
    done: all.filter(v => !v.waiting && (v.status === 'approved' || v.status === 'with_desk')),
    returned: all.filter(v => v.status === 'returned' || v.status === 'removed'),
  }
  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      <div className="flex border-b border-ink-200" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 pb-2.5 pt-1 text-sm font-semibold sm:flex-none sm:px-4 ${tab === k ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {l}
            <span className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${lists[k].length > 0 ? COUNT[k] : 'bg-ink-100 text-ink-700'}`}>{lists[k].length}</span>
          </button>
        ))}
      </div>
      {lists[tab].length
        ? <div className="card divide-y divide-ink-100 overflow-hidden">{lists[tab].map(v => <InboxRow key={v.id} v={v} />)}</div>
        : <div className="card p-6 text-center text-sm text-ink-500">{EMPTY[tab]}</div>}
    </div>
  )
}

function InboxRow({ v }: { v: InboxVehicle }) {
  const ask = useAsk()
  const refresh = useVehicleRefresh()
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const fail = (text: string) => setErr(x => ({ text, n: (x?.n ?? 0) + 1 }))
  const first = v.name.split(' ')[0]
  const what = `${v.label} · ${range(v)}`
  const s = VA_STATUS[v.status]
  const n = depDays(v.from_day, v.to_day)

  const run = async (fn: string, args: Record<string, unknown>, done: string, tone: 'success' | 'info') => {
    setBusy(true); setErr(null)
    try { await rpc(fn, args); await refresh(); await ask.alert(done, `${v.name} · ${what}`, tone) }
    catch (e) { fail((e as Error).message) }
    finally { setBusy(false) }
  }
  const approve = async () => {
    if (await ask.confirm({ title: `Approve ${first}'s ${v.label.toLowerCase()}?`, body: what, yes: 'Approve', icon: Check, go: true }))
      await run('te_va_decide', { p_id: v.id, p_approve: true, p_note: null }, 'Vehicle approved', 'success')
  }
  const sendBack = async () => {
    const note = await ask.prompt({ title: `Send ${first}'s request back?`, body: what, label: 'Why is it going back?', yes: 'Send back' })
    if (note) await run('te_va_decide', { p_id: v.id, p_approve: false, p_note: note }, 'Request sent back', 'info')
  }
  const remove = async () => {
    const note = await ask.prompt({ title: `Remove ${first}'s ${v.label.toLowerCase()} approval?`, body: what, label: 'Why is it removed?', yes: 'Remove' })
    if (note) await run('te_va_remove', { p_id: v.id, p_note: note }, 'Approval removed', 'info')
  }
  const openLetter = async () => {
    const url = v.letter_path && await letterUrl(v.letter_path)
    if (url) setViewing({ url, name: v.letter_name ?? 'Letter' })
    else fail('The letter could not be opened')
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ModeIcon mode={v.mode} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{v.name} <span className="text-xs text-ink-500">{v.ecode}</span></p>
            <p className="truncate text-sm text-ink-800"><b>{v.label}</b> · {range(v)} · {n} {n === 1 ? 'day' : 'days'}{v.number && <span className="ml-1.5 font-mono text-xs text-ink-500">{v.number}</span>}</p>
          </div>
        </div>
        {v.letter_path && <button type="button" className="btn-secondary shrink-0 !py-1.5 text-sm" onClick={() => void openLetter()}><FileText className="h-4 w-4" /> Letter</button>}
      </div>
      <p className="text-sm text-ink-700">“{v.reason}”</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
        <Trail v={v} />
        {v.note && <span className="text-cyrixRed-700">“{v.note}”</span>}
      </div>
      {v.waiting && (
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex">
          <button type="button" className="btn-secondary !border-amber-300 !bg-amber-50 !py-1.5 text-sm !text-amber-800 hover:!bg-amber-100" disabled={busy} onClick={() => void sendBack()}><CornerUpLeft className="h-4 w-4" /> Send back</button>
          <button type="button" className="btn-primary btn-go !py-1.5 text-sm" disabled={busy} onClick={() => void approve()}>
            {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Approve
          </button>
        </div>
      )}
      {v.can_remove && v.status === 'approved' && (
        <div className="pt-1">
          <button type="button" className="btn-secondary !py-1.5 text-sm !text-cyrixRed-700" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Remove approval</button>
        </div>
      )}
      {err && <Alert key={err.n} kind="error">{err.text}</Alert>}
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}
