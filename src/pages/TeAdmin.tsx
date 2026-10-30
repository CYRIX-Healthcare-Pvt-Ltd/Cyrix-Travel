import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Check, Pencil, Settings2, Timer, Trash2, X } from 'lucide-react'
import LearnedPlacesTable from '@/components/LearnedPlacesTable'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { rpc, type Rule } from '@/lib/claims'
import { useAsk } from '@/components/Ask'

/*
  The travel policy as SW Admin and ACC_ADMIN keep it (the user, 17 Oct): allowances by grade, the
  settings (the 10% km allowance, bill limit, late deductions…), the purposes, who coordinates whom,
  and who is the Travel Desk.
*/
type AdminData = {
  rules: Rule[]
  policy: Record<string, unknown>
  purposes: Array<{ id: number; label: string; gives_da: boolean; is_active: boolean; photo_needed: boolean }>
  expense_kinds: Array<{ id: number; label: string; role: string | null; bill_always: boolean; is_active: boolean }>
  /** The functions people are mapped to, and any added by hand (te_0063); a function not yet kept has no id. */
  projects: Array<{ id: number | null; label: string; is_active: boolean }>
  /** A coordinator per cost centre (te_0063), and the cost centres to choose from with how many are mapped. */
  coordinators: Array<{ cost_centre: string; coordinator_ecode: string; coordinator: string; people: number }>
  cost_centres: Array<{ name: string; people: number }>
  desk: Array<{ ecode: string; name: string }>
  /** SW Admin, who alone deletes claims (te_0028). */
  sw?: boolean
}
const TABS = [['rules', 'Allowances by grade'], ['policy', 'Settings'], ['purposes', 'Purposes'], ['projects', 'Projects'], ['coord', 'Coordinators'], ['desk', 'Travel Desk'], ['places', 'Places']] as const
const RULE_COLS: Array<[keyof Rule, string]> = [
  ['da_in_district', 'DA in district'], ['da_out_district', 'DA out of district'], ['da_out_state', 'DA out of district, staying'], ['da_out_state_stay', 'DA out of state, staying'],
  ['hotel_in_single', 'Room in state S'], ['hotel_in_double', 'Room in state D'], ['hotel_out_single', 'Room out of state S'], ['hotel_out_double', 'Room out of state D'],
  ['bike_rate', 'Bike ₹/km'], ['bike_km_month', 'Bike km/month'], ['car_rate', 'Car ₹/km'], ['car_km_month', 'Car km/month'],
]
const POLICY: Array<[string, string]> = [
  ['km_tolerance_pct', 'Km over the map allowed, %'], ['bill_over', 'Bill needed above ₹'], ['auto_month', 'Auto allowance a month ₹'],
  ['phone_month', 'Phone allowance a month ₹'], ['tool_max', 'Tools above ₹ go to petty cash'], ['metro_extra_pct', 'Metro city room extra %'], ['deputation_da', 'Deputation DA a day ₹'],
  ['bike_two_way_km', 'Bike two-way limit km'], ['car_two_way_km', 'Car two-way limit km'], ['submit_by_day', 'Submit by day of next month'],
  ['late_pct', 'Late deduction % (1, 2, 3 months)'], ['auto_per_km', 'Auto fare ₹ a km'], ['auto_min_fare', 'Auto minimum fare ₹'],
]

export default function TeAdmin() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['te_admin'], queryFn: () => rpc<AdminData>('te_admin_data') })
  const [tab, setTab] = useState<typeof TABS[number][0] | 'photos' | 'delete'>('rules')
  const [msg, setMsg] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  // A tab that shows its own refusal beside the button pressed passes here, and gets the message back.
  const call = async (fn: string, args: Record<string, unknown>, done = 'Saved.', here = false) => {
    setMsg(null); setFail(null)
    try { await rpc(fn, args); await qc.invalidateQueries({ queryKey: ['te_admin'] }); setMsg(done); return null }
    catch (e) { if (!here) setFail((e as Error).message); return (e as Error).message }
  }
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'Could not open.'}</Alert>
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><Settings2 className="h-5 w-5 text-violet-600" /> Travel policy</h1>
      <div className="flex flex-wrap gap-1.5">
        {/* Visit photos are SW Admin's alone, not ACC Admin's (te_0084; the user, 28 Oct: "i told only sw admin"). */}
        {[...TABS.slice(0, 3), ...(data.sw ? [['photos', 'Visit photos'] as const] : []), ...TABS.slice(3), ...(data.sw ? [['delete', 'Delete'] as const] : [])].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>{l}</button>)}
      </div>
      {msg && <Alert kind="success">{msg}</Alert>}
      {fail && <Alert kind="error">{fail}</Alert>}

      {tab === 'rules' && <Rules rules={data.rules} onSave={r => void call('te_set_rule', { p_rule: r })} />}
      {tab === 'policy' && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          {POLICY.map(([k, l]) => <PolicyField key={k} label={l} value={data.policy[k]} onSave={v => void call('te_set_policy', { p_key: k, p_value: v })} />)}
        </div>
      )}
      {tab === 'purposes' && <div className="space-y-4"><Purposes list={data.purposes} call={call} sw={!!data.sw} /><ExpenseKinds list={data.expense_kinds ?? []} call={call} sw={!!data.sw} /></div>}
      {tab === 'photos' && data.sw && <VisitPhotoSettings policy={data.policy} purposes={data.purposes} call={async (fn, args, done, here) => { const e = await call(fn, args, done, here); await qc.invalidateQueries({ queryKey: ['te_visit_setup'] }); return e }} />}
      {tab === 'projects' && <Projects list={data.projects} call={call} />}
      {tab === 'coord' && <Coordinators list={data.coordinators} centres={data.cost_centres} call={call} />}
      {tab === 'desk' && <Desk list={data.desk} call={call} />}
      {tab === 'places' && <LearnedPlaces />}
      {tab === 'delete' && data.sw && <DeleteClaim />}
    </div>
  )
}

function Rules({ rules, onSave }: { rules: Rule[]; onSave: (r: Rule) => void }) {
  const [edit, setEdit] = useState<Record<string, Rule>>({})
  const [add, setAdd] = useState('')
  const val = (g: string) => edit[g] ?? rules.find(r => r.grade === g)!
  const grades = [...rules.map(r => r.grade), ...Object.keys(edit).filter(g => !rules.some(r => r.grade === g))]
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b border-ink-200 text-left text-xs text-ink-500">
          <th className="px-3 py-2">Grade</th>{RULE_COLS.map(([, l]) => <th key={l} className="px-2 py-2">{l}</th>)}<th className="px-2 py-2">Flight</th><th className="px-2 py-2">Taxi car</th><th />
        </tr></thead>
        <tbody>
          {grades.map(g => {
            const r = val(g), dirty = !!edit[g]
            const set = (p: Partial<Rule>) => setEdit({ ...edit, [g]: { ...r, ...p } })
            return (
              <tr key={g} className="border-b border-ink-100">
                <td className="px-3 py-1.5 font-semibold text-ink-900">{g === '*' ? 'Others' : g}</td>
                {RULE_COLS.map(([k]) => (
                  <td key={k} className="px-1 py-1"><input type="number" className="input w-20 !px-2 !py-1 text-right" value={(r[k] as number | null) ?? ''}
                    onChange={e => set({ [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<Rule>)} /></td>
                ))}
                <td className="px-2"><input type="checkbox" checked={r.flight} onChange={e => set({ flight: e.target.checked })} /></td>
                <td className="px-2"><input type="checkbox" checked={r.taxi} onChange={e => set({ taxi: e.target.checked })} /></td>
                <td className="px-2">{dirty && <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => { onSave(r); const n = { ...edit }; delete n[g]; setEdit(n) }}>Save</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 p-3">
        <input className="input w-32" placeholder="New grade" value={add} onChange={e => setAdd(e.target.value.toUpperCase())} />
        <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={!add || grades.includes(add)} onClick={() => { setEdit({ ...edit, [add]: { ...rules.find(r => r.grade === '*')!, grade: add } }); setAdd('') }}>Add grade</button>
      </div>
    </div>
  )
}

function PolicyField({ label, value, onSave }: { label: string; value: unknown; onSave: (v: unknown) => void }) {
  const isList = Array.isArray(value)
  const [v, setV] = useState(isList ? (value as number[]).join(', ') : String(value ?? ''))
  return (
    <label className="block"><span className="label">{label}</span>
      <div className="mt-1 flex gap-2">
        <input className="input" value={v} onChange={e => setV(e.target.value)} />
        <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => onSave(isList ? v.split(',').map(x => Number(x.trim())).filter(x => !isNaN(x)) : Number(v))}>Save</button>
      </div>
    </label>
  )
}

type Call = (fn: string, args: Record<string, unknown>, done?: string, here?: boolean) => Promise<string | null>

/*
  The travel time check between a day's visit photos (te_0089; the user, 30 Oct: "sw admin can change km/h"): on or
  off, and the km/h each way of travel can do. Faster than that between two photos is an observation on the claim.
*/
const SPEED_MODES: Array<[string, string]> = [['bike', 'Bike'], ['car', 'Car'], ['bus', 'Bus'], ['train', 'Train'], ['metro', 'Metro'], ['auto', 'Auto'], ['taxi', 'Taxi · Car'], ['taxi_bike', 'Taxi · Bike']]
function TravelTime({ policy, call }: { policy: Record<string, unknown>; call: Call }) {
  const on = policy.photo_speed_on !== false
  const saved = (policy.photo_speeds ?? {}) as Record<string, number>
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(SPEED_MODES.map(([m]) => [m, String(saved[m] ?? '')])))
  const [err, setErr] = useState<string | null>(null)
  const changed = SPEED_MODES.some(([m]) => v[m] !== String(saved[m] ?? ''))
  const save = async () => setErr(await call('te_set_policy', { p_key: 'photo_speeds', p_value: Object.fromEntries(SPEED_MODES.map(([m]) => [m, Number(v[m])])) }, 'Speeds saved.', true))
  return (
    <div className="space-y-3 border-t border-ink-100 pt-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Timer className="h-4 w-4" /></span>
        <p className="min-w-0 flex-1 font-semibold text-ink-900">Travel time between photos</p>
        <button type="button" role="switch" aria-checked={on} aria-label="Travel time check on or off" onClick={() => void call('te_set_policy', { p_key: 'photo_speed_on', p_value: !on }, on ? 'Travel time check is off.' : 'Travel time check is on.')}
          className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-emerald-600' : 'bg-ink-300')}>
          <span className={clsx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>
      <div className={clsx('grid grid-cols-2 gap-2 sm:grid-cols-4', !on && 'opacity-60')}>
        {SPEED_MODES.map(([m, label]) => (
          <label key={m} className="block"><span className="label">{label}</span>
            <span className="relative mt-1 block">
              <input className="input pr-12" inputMode="numeric" value={v[m]} onChange={e => { setErr(null); setV(x => ({ ...x, [m]: e.target.value.replace(/\D/g, '').slice(0, 3) })) }} />
              <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-ink-500">km/h</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {err && <span className="text-sm text-cyrixRed-700">{err}</span>}
        <button type="button" className="btn-primary !py-1.5 text-sm" disabled={!changed || SPEED_MODES.some(([m]) => !v[m])} onClick={() => void save()}>Save speeds</button>
      </div>
    </div>
  )
}

/*
  Visit photos for SW Admin on one page (te_0082; the user, 28 Oct: "sw admin need option to enable and disable this
  feature", "let sw admin decide it block or send, so admin panel should be easy"): on or off, which purposes need a
  photo, how near it must be, how many Photo not possible a month and what happens past them, how long pictures stay.
*/
function VisitPhotoSettings({ policy, purposes, call }: { policy: Record<string, unknown>; purposes: AdminData['purposes']; call: Call }) {
  const on = policy.visit_photos === true, after = policy.photo_after === 'send' ? 'send' : 'block'
  const seg = (active: boolean) => clsx('rounded-lg px-3 py-1.5 text-sm font-semibold', active ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')
  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-700"><Camera className="h-5 w-5" /></span>
        <p className="min-w-0 flex-1 font-semibold text-ink-900">Visit photos</p>
        <button type="button" role="switch" aria-checked={on} aria-label="Visit photos on or off" onClick={() => void call('te_set_policy', { p_key: 'visit_photos', p_value: !on }, on ? 'Visit photos are off.' : 'Visit photos are on.')}
          className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-emerald-600' : 'bg-ink-300')}>
          <span className={clsx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>
      <div className={clsx('card space-y-4 p-4', !on && 'opacity-60')}>
        <div>
          <span className="label">Photo needed for</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {purposes.filter(p => p.is_active).map(p => (
              <button key={p.id} type="button" aria-pressed={p.photo_needed} onClick={() => void call('te_set_purpose_photo', { p_id: p.id, p_on: !p.photo_needed })}
                className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1', p.photo_needed ? 'bg-rose-600 text-white ring-rose-600' : 'bg-surface text-ink-700 ring-ink-200 hover:bg-ink-50')}>
                {p.photo_needed && <Check className="h-3.5 w-3.5" />}{p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">After the Photo not possible limit</span>
          <div className="mt-1.5 inline-flex rounded-xl bg-ink-100 p-1">
            <button type="button" className={seg(after === 'block')} onClick={() => void call('te_set_policy', { p_key: 'photo_after', p_value: 'block' })}>Block</button>
            <button type="button" className={seg(after === 'send')} onClick={() => void call('te_set_policy', { p_key: 'photo_after', p_value: 'send' })}>Send, manager decides</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PolicyField label="Photo not possible a month" value={policy.photo_skips} onSave={v => void call('te_set_policy', { p_key: 'photo_skips', p_value: v })} />
          <PolicyField label="Photo within, metres" value={policy.photo_near_m} onSave={v => void call('te_set_policy', { p_key: 'photo_near_m', p_value: v })} />
          <PolicyField label="Keep photos after paid, days" value={policy.photo_keep_days} onSave={v => void call('te_set_policy', { p_key: 'photo_keep_days', p_value: v })} />
        </div>
        <TravelTime policy={policy} call={call} />
      </div>
    </div>
  )
}
/* Expense types, kept with the purposes (te_0091; the user, 30 Oct: "sw admin can add / delete or edit, add in purpose itself bcz many subtabs making it confusing"). */
function ExpenseKinds({ list, call, sw }: { list: AdminData['expense_kinds']; call: Call; sw: boolean }) {
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null)
  const [err, setErr] = useState<{ id: number; text: string; n: number } | null>(null)
  const ask = useAsk()
  type K = AdminData['expense_kinds'][number]
  const put = (k: K, p: { label?: string; bill?: boolean; active?: boolean }, done?: string, here = false) =>
    call('te_set_expense_kind', { p_id: k.id, p_label: p.label ?? k.label, p_bill_always: p.bill ?? k.bill_always, p_active: p.active ?? k.is_active }, done, here)
  const rename = async (k: K) => {
    const e = await put(k, { label: editing!.label }, 'Renamed.', true)
    if (e) setErr(x => ({ id: k.id, text: e, n: (x?.n ?? 0) + 1 })); else { setEditing(null); setErr(null) }
  }
  const remove = async (k: K) => {
    if (!(await ask.confirm({ title: `Delete ${k.label}?`, body: 'It goes from the list of expense types.', yes: 'Delete', danger: true }))) return
    const e = await call('te_delete_expense_kind', { p_id: k.id }, 'Expense type deleted.', true)
    setErr(e ? x => ({ id: k.id, text: e, n: (x?.n ?? 0) + 1 }) : null)
  }
  return (
    <div className="card space-y-2 p-4">
      <h3 className="text-sm font-semibold text-ink-800">Expense types</h3>
      {list.map(k => (
        <div key={k.id} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {editing?.id === k.id ? (
              <span className="flex min-w-[12rem] items-center gap-1.5">
                <input className="input !py-1 max-w-[14rem]" value={editing.label} autoFocus onChange={e => setEditing({ id: k.id, label: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') void rename(k); if (e.key === 'Escape') setEditing(null) }} />
                <button type="button" className="btn-icon text-green-700" aria-label="Save" title="Save" disabled={!editing.label.trim()} onClick={() => void rename(k)}><Check className="h-4 w-4" /></button>
                <button type="button" className="btn-icon" aria-label="Cancel" title="Cancel" onClick={() => { setEditing(null); setErr(null) }}><X className="h-4 w-4" /></button>
              </span>
            ) : (
              <span className="flex min-w-[12rem] items-center gap-1">
                <span className={clsx('font-medium', k.is_active ? 'text-ink-900' : 'text-ink-400 line-through')}>{k.label}</span>
                <button type="button" className="btn-icon" aria-label={`Rename ${k.label}`} title="Rename" onClick={() => { setEditing({ id: k.id, label: k.label }); setErr(null) }}><Pencil className="h-3.5 w-3.5" /></button>
              </span>
            )}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={k.bill_always} onChange={e => void put(k, { bill: e.target.checked })} /> Bill always</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={k.is_active} onChange={e => void put(k, { active: e.target.checked })} /> In use</label>
            {sw && <button type="button" className="btn-icon text-cyrixRed-600" aria-label={`Delete ${k.label}`} title="Delete" onClick={() => void remove(k)}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
          {err?.id === k.id && <Alert key={err.n} kind="error">{err.text}</Alert>}
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input max-w-xs" placeholder="New expense type" value={label} onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!label.trim()} onClick={() => { void call('te_set_expense_kind', { p_id: null, p_label: label, p_bill_always: false, p_active: true }, 'Expense type added.'); setLabel('') }}>Add</button>
      </div>
    </div>
  )
}

/* Purposes, renamed in place too (te_0063; the user, 24 Oct: "need edit option"). */
function Purposes({ list, call, sw }: { list: AdminData['purposes']; call: Call; sw: boolean }) {
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null)
  const [err, setErr] = useState<{ id: number; text: string; n: number } | null>(null)
  const ask = useAsk()
  const remove = async (p: AdminData['purposes'][number]) => {
    if (!(await ask.confirm({ title: `Delete ${p.label}?`, body: 'It goes from the list of purposes.', yes: 'Delete', danger: true }))) return
    const e = await call('te_delete_purpose', { p_id: p.id }, 'Purpose deleted.', true)
    if (e) setErr(x => ({ id: p.id, text: e, n: (x?.n ?? 0) + 1 }))
  }
  const rename = async (p: AdminData['purposes'][number]) => {
    const e = await call('te_set_purpose', { p_id: p.id, p_label: editing!.label, p_gives_da: p.gives_da, p_active: p.is_active }, 'Renamed.', true)
    if (e) setErr(x => ({ id: p.id, text: e, n: (x?.n ?? 0) + 1 })); else { setEditing(null); setErr(null) }
  }
  return (
    <div className="card space-y-2 p-4">
      <h3 className="text-sm font-semibold text-ink-800">Purposes</h3>
      {list.map(p => (
        <div key={p.id} className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {editing?.id === p.id ? (
            <span className="flex min-w-[12rem] items-center gap-1.5">
              <input className="input !py-1 max-w-[14rem]" value={editing.label} autoFocus onChange={e => setEditing({ id: p.id, label: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') void rename(p); if (e.key === 'Escape') setEditing(null) }} />
              <button type="button" className="btn-icon text-green-700" aria-label="Save" title="Save" disabled={!editing.label.trim()} onClick={() => void rename(p)}><Check className="h-4 w-4" /></button>
              <button type="button" className="btn-icon" aria-label="Cancel" title="Cancel" onClick={() => { setEditing(null); setErr(null) }}><X className="h-4 w-4" /></button>
            </span>
          ) : (
            <span className="flex min-w-[12rem] items-center gap-1">
              <span className={clsx('font-medium', p.is_active ? 'text-ink-900' : 'text-ink-400 line-through')}>{p.label}</span>
              <button type="button" className="btn-icon" aria-label={`Rename ${p.label}`} title="Rename" onClick={() => { setEditing({ id: p.id, label: p.label }); setErr(null) }}><Pencil className="h-3.5 w-3.5" /></button>
            </span>
          )}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.gives_da} onChange={e => void call('te_set_purpose', { p_id: p.id, p_label: p.label, p_gives_da: e.target.checked, p_active: p.is_active })} /> Gives DA</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.is_active} onChange={e => void call('te_set_purpose', { p_id: p.id, p_label: p.label, p_gives_da: p.gives_da, p_active: e.target.checked })} /> In use</label>
          {/* The ride needs a visit photo (te_0082; the user, 28 Oct: "image mandatory check box"). SW Admin only (te_0084). */}
          {sw && <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.photo_needed} onChange={e => void call('te_set_purpose_photo', { p_id: p.id, p_on: e.target.checked })} /> Photo needed</label>}
          {/* Gone only while nothing names it; after that In use is unticked instead (te_0082). SW Admin only (te_0084). */}
          {sw && <button type="button" className="btn-icon text-cyrixRed-600" aria-label={`Delete ${p.label}`} title="Delete" onClick={() => void remove(p)}><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        {err?.id === p.id && <Alert key={err.n} kind="error">{err.text}</Alert>}
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input max-w-xs" placeholder="New purpose" value={label} onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!label.trim()} onClick={() => { void call('te_set_purpose', { p_id: null, p_label: label, p_gives_da: true, p_active: true }, 'Purpose added.'); setLabel('') }}>Add</button>
      </div>
    </div>
  )
}

/*
  A coordinator per cost centre (te_0063; the user, 24 Oct: "only klbemmp cost centre guys need to come specific
  coordinator"): a claim of anybody mapped to it goes to its coordinator after the manager, then to the Travel Desk.
*/
function Coordinators({ list, centres, call }: { list: AdminData['coordinators']; centres: AdminData['cost_centres']; call: Call }) {
  const [cc, setCc] = useState(''), [k, setK] = useState('')
  const [err, setErr] = useState<{ at: string; text: string; n: number } | null>(null)
  const run = async (at: string, args: Record<string, unknown>, done: string) => {
    const e = await call('te_set_cost_centre_coordinator', args, done, true)
    if (e) setErr(x => ({ at, text: e, n: (x?.n ?? 0) + 1 }))
    else { setErr(null); if (at === 'set') { setCc(''); setK('') } }
  }
  const free = centres.filter(c => !list.some(x => x.cost_centre.toLowerCase() === c.name.toLowerCase()))
  return (
    <div className="card space-y-2 p-4">
      {list.length === 0 && <p className="text-sm text-ink-500">No coordinators set. Claims go from the manager straight to the Travel Desk.</p>}
      {list.map(c => (
        <div key={c.cost_centre} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink-900">{c.cost_centre} <span className="text-ink-500">· {c.people} {c.people === 1 ? 'person' : 'people'}</span></span>
            <span className="text-ink-400">→ coordinator</span>
            <span className="font-medium text-ink-900">{c.coordinator} <span className="text-ink-500">{c.coordinator_ecode}</span></span>
            <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Remove" onClick={() => void run(c.cost_centre, { p_cost_centre: c.cost_centre, p_coordinator: '' }, 'Removed.')}><Trash2 className="h-4 w-4" /></button>
          </div>
          {err?.at === c.cost_centre && <Alert key={err.n} kind="error">{err.text}</Alert>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-2">
        <select className="input w-56" value={cc} onChange={x => setCc(x.target.value)} aria-label="Cost centre">
          <option value="">Cost centre…</option>
          {free.map(c => <option key={c.name} value={c.name}>{c.name} · {c.people}</option>)}
        </select>
        <input className="input w-40" placeholder="Coordinator E-code" value={k} onChange={x => setK(x.target.value)} />
        <button type="button" className="btn-secondary" disabled={!cc || !k.trim()} onClick={() => void run('set', { p_cost_centre: cc, p_coordinator: k }, 'Coordinator set.')}>Set</button>
      </div>
      {err?.at === 'set' && <Alert key={err.n} kind="error">{err.text}</Alert>}
    </div>
  )
}

function Desk({ list, call }: { list: AdminData['desk']; call: Call }) {
  const [e, setE] = useState('')
  return (
    <div className="card space-y-2 p-4">
      {list.map(p => (
        <div key={p.ecode} className="flex items-center gap-2 text-sm">
          <span className="font-medium text-ink-900">{p.name} <span className="text-ink-500">{p.ecode}</span></span>
          <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Remove" onClick={() => void call('te_set_desk', { p_ecode: p.ecode, p_on: false }, 'Removed.')}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input w-40" placeholder="E-code" value={e} onChange={x => setE(x.target.value)} />
        <button type="button" className="btn-secondary" disabled={!e.trim()} onClick={() => { void call('te_set_desk', { p_ecode: e, p_on: true }, 'Added to the Travel Desk.'); setE('') }}>Add</button>
      </div>
    </div>
  )
}

/** The projects a claim chooses from (te_0022; the user, 17 Oct: "project need dropdown, that sw or acc admin will set"). */
function Projects({ list, call }: { list: AdminData['projects']; call: Call }) {
  const [label, setLabel] = useState('')
  return (
    <div className="card space-y-2 p-4">
      {list.map(p => (
        <div key={p.label} className="flex flex-wrap items-center gap-3 text-sm">
          <span className={clsx('min-w-[14rem] font-medium', p.is_active ? 'text-ink-900' : 'text-ink-400 line-through')}>{p.label}</span>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.is_active} onChange={e => void call('te_set_project', { p_id: p.id, p_label: p.label, p_active: e.target.checked })} /> In use</label>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input max-w-xs" placeholder="New project" value={label} onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!label.trim()} onClick={() => { void call('te_set_project', { p_id: null, p_label: label, p_active: true }, 'Project added.'); setLabel('') }}>Add</button>
      </div>
    </div>
  )
}

const STATUS_WORD: Record<string, string> = {
  draft: 'Draft', with_manager: 'With manager', with_coordinator: 'With coordinator', with_desk: 'With Travel Desk',
  approved: 'Approved', paid: 'Paid', returned: 'Sent back', recalled: 'Recalled',
}
const ADVANCE_WORD: Record<string, string> = { with_manager: 'With manager', with_desk: 'With Travel Desk', given: 'Approved', declined: 'Declined', cancelled: 'Withdrawn' }
const DEP_WORD: Record<string, string> = { with_manager: 'With manager', approved: 'Approved', returned: 'Sent back', withdrawn: 'Withdrawn', replaced: 'Changed', edited: 'Edited' }
/*
  Delete a claim (Travel te_0028; the user, 18 Oct: "for sw_admin like in revive lab also need option to
  delete claim" — "only for swadmin"), as Revive Lab deletes a ticket: type its number, see whose it
  is, confirm. Its bills go first, then the claim with its days and history; one audit line keeps what
  it was. The tab shows only for SW Admin, and the database refuses anybody else.
  An advance is deleted the same way by its EA number (te_0066; the user, 24 Oct: "for deletion also need
  ea tickets"); what claims took of it goes with it, so those claims no longer have it taken off.
  A deputation by its DP number (te_0090; the user, 30 Oct: "give deputation no so can sw admin can remove"): every
  request of it, then its letters; a claim day that took its DA is then outside any deputation, said in Observations.
  The same box in KPI's SW Admin and Travel's admin page.
*/
type FoundClaim = { kind: 'claim'; id: string; number: string; name: string; ecode: string; month: string; status: string; total: number; days: number; paths: string[] }
type FoundAdvance = { kind: 'advance'; id: string; number: string; name: string; ecode: string; month: string; status: string; amount: number; dest: string; used: number; claims: string[] }
type FoundDeputation = { kind: 'deputation'; id: string; number: string; name: string; ecode: string; state: string; from_day: string; to_day: string; status: string; requests: number; claims: string[] }
function DeleteClaim() {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<FoundClaim | FoundAdvance | FoundDeputation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ at: 'find' | 'delete'; text: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lookUp = async () => {
    setError(null); setNotice(null); setFound(null); setBusy(true)
    try {
      setFound(/^\s*ea/i.test(typed)
        ? { kind: 'advance', ...(await rpc<Omit<FoundAdvance, 'kind'>>('te_find_advance', { p_number: typed })) }
        : /^\s*dp/i.test(typed)
          ? { kind: 'deputation', ...(await rpc<Omit<FoundDeputation, 'kind'>>('te_find_deputation', { p_number: typed })) }
          : { kind: 'claim', ...(await rpc<Omit<FoundClaim, 'kind'>>('te_find_claim', { p_number: typed })) })
    } catch (e) { setError({ at: 'find', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!found) return
    setBusy(true); setError(null)
    try {
      if (found.kind === 'advance') await rpc('te_delete_advance', { p_advance: found.id })
      else if (found.kind === 'deputation') {
        const letters = await rpc<string[]>('te_delete_deputation', { p_root: found.id })
        // The letters go after: one left behind names no deputation and harms nothing.
        if (letters?.length) await supabase.storage.from('te-letters').remove(letters)
      } else {
        if (found.paths.length) {
          const { error: rm } = await supabase.storage.from('te-bills').remove(found.paths)
          if (rm) throw new Error(rm.message)
        }
        await rpc('te_delete_claim', { p_claim: found.id })
      }
      setNotice(`Deleted ${found.number}.`); setFound(null); setTyped('')
      void qc.invalidateQueries()
    } catch (e) { setError({ at: 'delete', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const mon = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return `${d.toLocaleDateString('en-GB', { month: 'short' })}-${String(d.getFullYear()).slice(2)}` }
  const date = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Trash2 className="h-4 w-4 text-cyrixRed-600" />
        <h3 className="text-sm font-semibold text-ink-800">Delete a claim, advance or deputation</h3>
      </div>
      <div className="space-y-3 p-4">
        {notice && <Alert kind="success">{notice}</Alert>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void lookUp() }}>
          <label className="block w-44"><span className="label">Number</span>
            <input className="input mt-1 h-11 font-mono" value={typed} onChange={e => { setTyped(e.target.value); setFound(null); setError(null) }} placeholder="TE-02, EA-01, DP-01" /></label>
          <button type="submit" className="btn-secondary h-11 !text-cyrixRed-700" disabled={busy || !typed.trim()}>
            {busy && !found ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} Delete
          </button>
        </form>
        {error?.at === 'find' && <Alert kind="error">{error.text}</Alert>}
        {found && (
          <div className="rounded-xl border border-cyrixRed-200 bg-cyrixRed-50 p-3">
            {found.kind === 'claim' ? <>
              <p className="text-sm font-medium text-cyrixRed-900">Delete {found.number} · {found.name} ({found.ecode}) · {mon(found.month)} · {rupees(found.total)} for good?</p>
              <p className="mt-0.5 text-xs text-cyrixRed-800">{STATUS_WORD[found.status] ?? found.status} · {found.days} day{found.days === 1 ? '' : 's'}. Its days, bills and history go with it. This cannot be undone.</p>
            </> : found.kind === 'advance' ? <>
              <p className="text-sm font-medium text-cyrixRed-900">Delete advance {found.number} · {found.name} ({found.ecode}) · {mon(found.month)} · {rupees(found.amount)} for good?</p>
              <p className="mt-0.5 text-xs text-cyrixRed-800">
                {ADVANCE_WORD[found.status] ?? found.status} · to {found.dest}.{' '}
                {found.used > 0
                  ? `${rupees(found.used)} of it is taken off ${found.claims.join(', ')}; ${found.claims.length === 1 ? 'that claim' : 'those claims'} will no longer have it taken off.`
                  : 'Its approvals go with it.'}{' '}
                This cannot be undone.
              </p>
            </> : <>
              <p className="text-sm font-medium text-cyrixRed-900">Delete deputation {found.number} · {found.name} ({found.ecode}) · {found.state} · {date(found.from_day)} – {date(found.to_day)} for good?</p>
              <p className="mt-0.5 text-xs text-cyrixRed-800">
                {DEP_WORD[found.status] ?? found.status}{found.requests > 1 ? ` · ${found.requests} requests` : ''}.{' '}
                {found.claims.length > 0
                  ? `Deputation DA is claimed on ${found.claims.join(', ')}; those days will show as outside any deputation.`
                  : 'Its letter and history go with it.'}{' '}
                This cannot be undone.
              </p>
            </>}
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Yes, delete {found.number}</button>
              <button type="button" className="btn-secondary" onClick={() => { setFound(null); setError(null) }}>Cancel</button>
            </div>
            {error?.at === 'delete' && <div className="mt-2"><Alert kind="error">{error.text}</Alert></div>}
          </div>
        )}
      </div>
    </div>
  )
}

// Places our engineers taught the search, put right here (te_0038, te_0071): the list shared with KPI's SW Admin.
function LearnedPlaces() {
  const ask = useAsk()
  return <LearnedPlacesTable call={rpc} confirmRemove={name => ask.confirm({ title: `Remove ${name}?`, body: 'It is no longer offered when engineers search. Claims that used it keep it.', yes: 'Remove', danger: true })} />
}
