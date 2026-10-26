import { useRef, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, FileText, History, Pencil, Plus, Send, Undo2, Upload } from 'lucide-react'
import Dialog from '@/components/Dialog'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'
import { Alert, Spinner } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { money, rpc, todayIso } from '@/lib/claims'
import {
  DEP_STATUS, STATES, depDays, depRange, dropLetter, letterUrl, uploadLetter, useDepRefresh, useMyDeputations, type Deputation,
} from '@/lib/deputation'

/*
  Deputation in My profile (te_0075; the user, 26 Oct: "adding extra tab is not good … may be we can add it after
  cost centre?"): the one in force or waiting, its letter, a change (approved again by the manager), and every
  request before it.
*/
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function DeputationCard() {
  const ask = useAsk()
  const refresh = useDepRefresh()
  const { data } = useMyDeputations()
  const [form, setForm] = useState<{ base: Deputation | null; replaces: string | null } | null>(null)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [history, setHistory] = useState(false)
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const items = data?.items ?? []
  const today = todayIso()
  const pending = items.find(d => d.status === 'with_manager') ?? null
  const current = items.filter(d => d.status === 'approved' && d.to_day >= today).sort((a, b) => a.from_day.localeCompare(b.from_day))[0] ?? null
  const returned = !pending && items[0]?.status === 'returned' ? items[0] : null
  // The card shows what is in force, else what waits, else what came back.
  const shown = current ?? pending ?? returned
  const change = current && pending?.replaces === current.id ? pending : null
  // The manager by first name ("Henry"), or "manager" for someone without one.
  const manager = data?.manager?.split(' ')[0] ?? 'manager'
  // None in force, waiting or sent back: one line, Add on the right, as the cost centre beside it (the user, 26 Oct).
  const empty = !current && !pending && !returned

  const openLetter = async (d: Deputation) => {
    const url = await letterUrl(d.letter_path)
    if (url) setViewing({ url, name: d.letter_name ?? 'Deputation letter' })
    else setErr(x => ({ text: 'The letter could not be opened', n: (x?.n ?? 0) + 1 }))
  }
  const withdraw = async (d: Deputation) => {
    if (!(await ask.confirm({ title: 'Withdraw the request?', body: `${d.state} · ${depRange(d.from_day, d.to_day)}`, yes: 'Withdraw', icon: Undo2 }))) return
    setErr(null)
    try { await rpc('te_dep_withdraw', { p_id: d.id }); await refresh(); await ask.alert('Request withdrawn') }
    catch (e) { setErr(x => ({ text: (e as Error).message, n: (x?.n ?? 0) + 1 })) }
  }

  const tone = shown?.status === 'approved' || shown?.status === 'with_manager' ? 'border-2 border-violet-300' : ''
  return (
    <div className={`card px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><BriefcaseBusiness className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-900">Deputation{shown ? ` · ${shown.state}` : ''}</p>
          <p className="truncate text-xs text-ink-500">
            {shown ? `${depRange(shown.from_day, shown.to_day)} · ${depDays(shown.from_day, shown.to_day)} days${shown.status === 'approved' ? ` · DA ${money(data?.da ?? 800)} a day` : ''}` : 'None'}
          </p>
        </div>
        {empty && <button type="button" className="btn-primary shrink-0 !py-1.5 text-sm" onClick={() => setForm({ base: null, replaces: null })}><Plus className="h-4 w-4" /> Add</button>}
        {shown && <span className={`badge shrink-0 whitespace-nowrap ${DEP_STATUS[shown.status].tone}`}>{shown.status === 'with_manager' ? `With ${manager}` : DEP_STATUS[shown.status].label}</span>}
      </div>

      {change && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Change with {manager}: {change.state} · {depRange(change.from_day, change.to_day)}
        </p>
      )}
      {returned && returned.note && (
        <p className="mt-3 rounded-lg bg-cyrixRed-50 px-3 py-2 text-sm text-cyrixRed-800">Sent back by {returned.decided_name ?? manager}: “{returned.note}”</p>
      )}

      {(!empty || items.length > 0) && <div className="mt-3 flex flex-wrap gap-2">
        {shown && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => void openLetter(shown)}><FileText className="h-4 w-4" /> Letter</button>}
        {current && !pending && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setForm({ base: current, replaces: current.id })}><Pencil className="h-4 w-4" /> Change</button>}
        {returned && <button type="button" className="btn-primary !py-1.5 text-sm" onClick={() => setForm({ base: returned, replaces: returned.replaces })}><Send className="h-4 w-4" /> Send again</button>}
        {pending && <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => void withdraw(pending)}><Undo2 className="h-4 w-4" /> Withdraw</button>}
        {items.length > 0 && (
          <button type="button" className="btn-secondary !py-1.5 text-sm" aria-expanded={history} onClick={() => setHistory(h => !h)}>
            <History className="h-4 w-4" /> History <ChevronDown className={`h-4 w-4 transition-transform ${history ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>}
      {err && <div className="mt-3"><Alert key={err.n} kind="error">{err.text}</Alert></div>}

      {history && (
        <ol className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
          {items.map(d => (
            <li key={d.id} className="flex items-start gap-3 py-2.5">
              <span className={`badge mt-0.5 shrink-0 whitespace-nowrap ${DEP_STATUS[d.status].tone}`}>{DEP_STATUS[d.status].label}</span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-ink-900">{d.state} · {depRange(d.from_day, d.to_day)}{d.replaces ? <span className="text-ink-500"> · change</span> : null}</p>
                <p className="text-xs text-ink-500">
                  Asked {when(d.created_at)}
                  {d.decided_at && d.decided_name && ` · ${d.status === 'returned' ? 'sent back' : 'approved'} by ${d.decided_name} (${d.decided_ecode}) ${when(d.decided_at)}`}
                  {d.decided_at && d.status === 'withdrawn' && ` · withdrawn ${when(d.decided_at)}`}
                </p>
                {d.note && <p className="text-xs text-ink-600">“{d.note}”</p>}
              </div>
              <button type="button" className="btn-icon shrink-0" aria-label="Letter" title="Letter" onClick={() => void openLetter(d)}><FileText className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
      )}

      {form && <DeputationForm base={form.base} replaces={form.replaces} manager={manager} onClose={() => setForm(null)} onSent={refresh} />}
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}

function DeputationForm({ base, replaces, manager, onClose, onSent }: {
  base: Deputation | null; replaces: string | null; manager: string; onClose: () => void; onSent: () => Promise<unknown>
}) {
  const ask = useAsk()
  const { employee } = useAuth()
  const [state, setState] = useState(base?.state ?? '')
  const [from, setFrom] = useState(base?.from_day ?? '')
  const [to, setTo] = useState(base?.to_day ?? '')
  // A change keeps the letter it had until another is chosen.
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; n: number } | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const fail = (text: string) => setErr(x => ({ text, n: (x?.n ?? 0) + 1 }))
  const letterName = file?.name ?? base?.letter_name ?? (base ? 'Deputation letter' : null)

  const send = async () => {
    setErr(null)
    if (!state) return fail('Choose the state')
    if (!from || !to) return fail('Choose the from and to dates')
    if (to < from) return fail('The to date is before the from date')
    if (!file && !base) return fail('Upload the deputation letter')
    if (!(await ask.confirm({ title: `Send to ${manager}?`, body: `${state} · ${depRange(from, to)}`, yes: 'Send', icon: Send, go: true }))) return
    setBusy(true)
    let path = base?.letter_path ?? null, uploaded: string | null = null
    try {
      if (file) { uploaded = await uploadLetter(employee!.id, file); path = uploaded }
      await rpc('te_dep_request', { p_state: state, p_from: from, p_to: to, p_path: path, p_name: file?.name ?? base?.letter_name ?? null, p_replaces: replaces })
      await onSent()
      onClose()
      await ask.alert(`Sent to ${manager}`, `${state} · ${depRange(from, to)}`, 'success')
    } catch (e) {
      if (uploaded) await dropLetter(uploaded)
      fail((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog title={replaces ? 'Change deputation' : 'Deputation'} icon={<BriefcaseBusiness className="h-5 w-5 text-violet-600" />} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="label">State</span>
          <select className="input mt-1 h-11" value={state} onChange={e => setState(e.target.value)}>
            <option value="" disabled>Choose the state</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">From</span><input type="date" className="input mt-1 h-11" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="block"><span className="label">To</span><input type="date" className="input mt-1 h-11" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <div>
          <span className="label">Deputation letter</span>
          <input ref={pick} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = '' }} />
          <button type="button" onClick={() => pick.current?.click()}
            className={`mt-1 flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left text-sm ${letterName ? 'border-violet-300 bg-violet-50 text-ink-900' : 'border-ink-300 text-ink-600 hover:border-ink-400'}`}>
            {letterName ? <FileText className="h-5 w-5 shrink-0 text-violet-600" /> : <Upload className="h-5 w-5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{letterName ?? 'Upload letter'}</span>
            {letterName && <span className="shrink-0 text-xs font-semibold text-violet-700">Replace</span>}
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
