import { useRef, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, FileText, History, Pencil, Plus, Send, TriangleAlert, Undo2, Upload } from 'lucide-react'
import Dialog from '@/components/Dialog'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'
import { Alert, Spinner } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { money, rpc, todayIso } from '@/lib/claims'
import { clockTime } from '@/lib/when'
import {
  DEP_STATUS, STATES, depDays, depRange, dropLetter, letterUrl, uploadLetter, useDepRefresh, useMyDeputations, type Deputation,
} from '@/lib/deputation'

/*
  Deputation, a tab of My profile (te_0075; the user, 26 Oct: "na looks bad, better add sub tab? and where is add
  deputation?"): Add deputation always at the top, each deputation in a row of its own (in force, next, waiting or
  just ended), its letter, an edit (approved again by the manager), and its own history behind its History button.
*/
// "26 Oct 2026, 5:10 PM", the date written as the range above it, kept on one line (the user, 26 Oct: "show time also in am pm").
const when = (iso: string) => (`${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${clockTime(iso)}`).replace(/ /g, ' ')

interface Row { key: string; d: Deputation; change: Deputation | null; back: Deputation | null; past: Deputation[] }

export default function Deputations() {
  const ask = useAsk()
  const refresh = useDepRefresh()
  const { data, isLoading } = useMyDeputations()
  // edits: the request still with the manager that the form sends again in its place; after: the one sent back.
  const [form, setForm] = useState<{ base: Deputation | null; replaces: string | null; edits?: string; after?: string } | null>(null)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [earlier, setEarlier] = useState(false)
  // A refusal shows under the button pressed: 'add' or a row's key.
  const [err, setErr] = useState<{ id: string; text: string; n: number } | null>(null)
  const items = data?.items ?? []
  const today = todayIso()
  const pending = items.find(d => d.status === 'with_manager') ?? null
  /*
    One deputation's requests share a root (te_0078): its first request, an edit, a change, a send again. Its row shows
    the approved one, else the latest; its History, every request (the user, 26 Oct: "if i click in rajasthan history it
    will show, if tamil nadu history it will show").
  */
  const chains = new Map<string, Deputation[]>()
  for (const d of items) { const k = d.root ?? d.id; chains.set(k, [...(chains.get(k) ?? []), d]) }
  const all: Row[] = [...chains].map(([key, past]) => {
    const ok = past.find(x => x.status === 'approved') ?? null
    const latest = past[0]
    return {
      key, past, d: ok ?? latest,
      change: ok && latest.status === 'with_manager' ? latest : null,
      back: ok && latest.status === 'returned' && latest.replaces === ok.id ? latest : null,
    }
  })
  /*
    In view: one not yet over, one over in the last 30 days (Ended: "deputation will be over once the to date is crossed
    … a alert icon"), one with the manager, and the latest request if it came back. The rest under Earlier.
  */
  const inView = (r: Row) => r.d.status === 'approved' ? depDays(r.d.to_day, today) <= 31 || r.d.to_day >= today
    : r.d.status === 'with_manager' || (r.d.status === 'returned' && r.d.id === items[0]?.id)
  const byDate = (a: Row, b: Row) => a.d.from_day.localeCompare(b.d.from_day)
  const rows = all.filter(inView).sort(byDate)
  const old = all.filter(r => !inView(r)).sort((a, b) => b.d.from_day.localeCompare(a.d.from_day))
  // The manager by first name ("Henry"), or "manager" for someone without one.
  const manager = data?.manager?.split(' ')[0] ?? 'manager'
  const fail = (id: string, text: string) => setErr(x => ({ id, text, n: (x?.n ?? 0) + 1 }))
  const errAt = (id: string) => err?.id === id && <div className="mt-2"><Alert key={err.n} kind="error">{err.text}</Alert></div>

  // One request with the manager at a time: the button stays, and says why when one is waiting.
  const add = () => {
    setErr(null)
    if (pending) fail('add', `${pending.state} · ${depRange(pending.from_day, pending.to_day)} is still with ${manager}. Edit or withdraw it first.`)
    else setForm({ base: null, replaces: null })
  }
  const openLetter = async (d: Deputation, at: string) => {
    const url = await letterUrl(d.letter_path)
    if (url) setViewing({ url, name: d.letter_name ?? 'Deputation letter' })
    else fail(at, 'The letter could not be opened')
  }
  const withdraw = async (d: Deputation, at: string) => {
    if (!(await ask.confirm({ title: 'Withdraw the request?', body: `${d.state} · ${depRange(d.from_day, d.to_day)}`, yes: 'Withdraw', icon: Undo2 }))) return
    setErr(null)
    try { await rpc('te_dep_withdraw', { p_id: d.id }); await refresh(); await ask.alert('Request withdrawn') }
    catch (e) { fail(at, (e as Error).message) }
  }

  // One row, small type: four buttons fit a phone, words only under 420px (the user, 26 Oct: "MAKE IT in single row", "reduce the font").
  const btn = 'btn-secondary !gap-1 !px-2.5 !py-1.5 text-xs whitespace-nowrap'
  const ico = 'h-3.5 w-3.5 max-[419px]:hidden'
  const row = ({ key, d, change, back, past }: Row) => {
    const over = d.status === 'approved' && d.to_day < today
    const tag = over ? null : d.from_day <= today && today <= d.to_day ? 'Now' : d.from_day > today ? 'Next' : null
    const days = depDays(d.from_day, d.to_day)
    const waiting = d.status === 'with_manager' ? d : change
    const again = back ?? (d.status === 'returned' ? d : null)
    return (
      <div key={key} className="px-4 py-3">
        {/* On a phone the buttons take a second line, under the words. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tag ? 'bg-violet-100 text-violet-700' : 'bg-ink-100 text-ink-500'}`}><BriefcaseBusiness className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink-900">{tag && <span className="mr-1.5 text-xs font-semibold text-violet-700">{tag}</span>}{d.state}</p>
            <p className="truncate text-xs text-ink-500">{depRange(d.from_day, d.to_day)} · {days} {days === 1 ? 'day' : 'days'}{d.status === 'approved' && !over ? ` · DA ${money(data?.da ?? 800)} a day` : ''}</p>
          </div>
          {over
            ? <span className="badge inline-flex shrink-0 items-center gap-1 whitespace-nowrap bg-amber-100 text-amber-900"><TriangleAlert className="h-3.5 w-3.5 text-amber-600" /> Ended</span>
            : <span className={`badge shrink-0 whitespace-nowrap ${DEP_STATUS[d.status].tone}`}>{d.status === 'with_manager' ? `With ${manager}` : DEP_STATUS[d.status].label}</span>}
          <div className="flex w-full gap-1.5 sm:w-auto">
            <button type="button" className={btn} onClick={() => void openLetter(d, key)}><FileText className={ico} /> Letter</button>
            {d.status === 'approved' && !over && !pending && !back && <button type="button" className={btn} onClick={() => setForm({ base: d, replaces: d.id })}><Pencil className={ico} /> Edit</button>}
            {waiting && <button type="button" className={btn} onClick={() => setForm({ base: waiting, replaces: waiting.replaces, edits: waiting.id })}><Pencil className={ico} /> Edit</button>}
            {waiting && <button type="button" className={btn} onClick={() => void withdraw(waiting, key)}><Undo2 className={ico} /> Withdraw</button>}
            {again && !pending && <button type="button" className={btn} onClick={() => setForm({ base: again, replaces: again.replaces, after: again.id })}><Send className={ico} /> Send again</button>}
            <button type="button" className={btn} aria-expanded={open === key} onClick={() => setOpen(o => (o === key ? null : key))}>
              <History className={ico} /> History <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === key ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {change && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Edit with {manager}: {change.state} · {depRange(change.from_day, change.to_day)}</p>}
        {back && <p className="mt-2 rounded-lg bg-cyrixRed-50 px-3 py-2 text-xs text-cyrixRed-800">Edit sent back by {back.decided_name ?? manager}{back.note ? `: “${back.note}”` : ''}</p>}
        {d.status === 'returned' && d.note && <p className="mt-2 rounded-lg bg-cyrixRed-50 px-3 py-2 text-xs text-cyrixRed-800">Sent back by {d.decided_name ?? manager}: “{d.note}”</p>}
        {errAt(key)}
        {open === key && (
          <ol className="mt-3 divide-y divide-ink-100 rounded-xl bg-ink-50 px-3">
            {past.map(x => (
              <li key={x.id} className="flex items-start gap-3 py-2.5">
                <span className={`badge mt-0.5 shrink-0 whitespace-nowrap ${DEP_STATUS[x.status].tone}`}>{x.status === 'with_manager' ? `With ${manager}` : DEP_STATUS[x.status].label}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-ink-900">{x.state} · {depRange(x.from_day, x.to_day)}</p>
                  <p className="text-xs text-ink-500">
                    Asked {when(x.created_at)}
                    {x.decided_at && x.decided_name && ` · ${x.status === 'returned' ? 'sent back' : 'approved'} by ${x.decided_name} (${x.decided_ecode}) ${when(x.decided_at)}`}
                    {x.decided_at && x.status === 'withdrawn' && ` · withdrawn ${when(x.decided_at)}`}
                    {x.decided_at && x.status === 'edited' && ` · edited ${when(x.decided_at)}`}
                  </p>
                  {x.note && <p className="text-xs text-ink-600">“{x.note}”</p>}
                </div>
                <button type="button" className="btn-icon shrink-0" aria-label="Letter" title="Letter" onClick={() => void openLetter(x, key)}><FileText className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary !py-1.5 text-sm" onClick={add}><Plus className="h-4 w-4" /> Add deputation</button>
        </div>
        {errAt('add')}
      </div>

      {isLoading ? <div className="card grid place-items-center p-8"><Spinner className="h-5 w-5" /></div>
        : rows.length === 0 ? <div className="card p-8 text-center text-sm text-ink-500">No deputation now.</div>
        // One row each, the next one under it (the user, 26 Oct: "make it like singlerow … if i add next then it should in another row").
        : <div className="card divide-y divide-ink-100 overflow-hidden">{rows.map(row)}</div>}

      {old.length > 0 && (
        <div>
          <button type="button" className={btn} aria-expanded={earlier} onClick={() => setEarlier(e => !e)}>
            Earlier ({old.length}) <ChevronDown className={`h-3.5 w-3.5 transition-transform ${earlier ? 'rotate-180' : ''}`} />
          </button>
          {earlier && <div className="card mt-3 divide-y divide-ink-100 overflow-hidden">{old.map(row)}</div>}
        </div>
      )}

      {form && <DeputationForm base={form.base} replaces={form.replaces} edits={form.edits ?? null} after={form.after ?? null} manager={manager} onClose={() => setForm(null)} onSent={refresh} />}
      {viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}

function DeputationForm({ base, replaces, edits, after, manager, onClose, onSent }: {
  base: Deputation | null; replaces: string | null; edits: string | null; after: string | null; manager: string; onClose: () => void; onSent: () => Promise<unknown>
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
      const name = file?.name ?? base?.letter_name ?? null
      if (edits) await rpc('te_dep_edit', { p_id: edits, p_state: state, p_from: from, p_to: to, p_path: path, p_name: name })
      else await rpc('te_dep_request', { p_state: state, p_from: from, p_to: to, p_path: path, p_name: name, p_replaces: replaces, p_after: after })
      await onSent()
      onClose()
      await ask.alert(`Sent to ${manager}`, `${state} · ${depRange(from, to)}`, 'success')
    } catch (e) {
      if (uploaded) await dropLetter(uploaded)
      fail((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog title={edits || replaces ? 'Edit deputation' : 'Deputation'} icon={<BriefcaseBusiness className="h-5 w-5 text-violet-600" />} onClose={onClose}>
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
