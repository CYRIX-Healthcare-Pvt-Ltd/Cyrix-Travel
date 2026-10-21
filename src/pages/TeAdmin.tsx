import { lazy, Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Hospital, Map as MapIcon, Settings2, Trash2 } from 'lucide-react'
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
  purposes: Array<{ id: number; label: string; gives_da: boolean; is_active: boolean }>
  projects: Array<{ id: number; label: string; is_active: boolean }>
  coordinators: Array<{ ecode: string; name: string; coordinator_ecode: string; coordinator: string }>
  desk: Array<{ ecode: string; name: string }>
  /** SW Admin, who alone deletes claims (te_0028). */
  sw?: boolean
}
const TABS = [['rules', 'Allowances by grade'], ['policy', 'Settings'], ['purposes', 'Purposes'], ['projects', 'Projects'], ['coord', 'Coordinators'], ['desk', 'Travel Desk'], ['places', 'Places']] as const
const RULE_COLS: Array<[keyof Rule, string]> = [
  ['da_in_district', 'DA in district'], ['da_out_district', 'DA out of district'], ['da_out_state', 'DA out of state'], ['da_out_state_stay', 'DA out of state, staying'],
  ['hotel_in_single', 'Hotel in state S'], ['hotel_in_double', 'Hotel in state D'], ['hotel_out_single', 'Hotel out of state S'], ['hotel_out_double', 'Hotel out of state D'],
  ['bike_rate', 'Bike ₹/km'], ['bike_km_month', 'Bike km/month'], ['car_rate', 'Car ₹/km'], ['car_km_month', 'Car km/month'],
]
const POLICY: Array<[string, string]> = [
  ['km_tolerance_pct', 'Km over the map allowed, %'], ['bill_over', 'Bill needed above ₹'], ['auto_month', 'Auto allowance a month ₹'],
  ['phone_month', 'Phone allowance a month ₹'], ['tool_max', 'Tools above ₹ go to petty cash'], ['metro_extra_pct', 'Metro city hotel extra %'],
  ['bike_two_way_km', 'Bike two-way limit km'], ['car_two_way_km', 'Car two-way limit km'], ['submit_by_day', 'Submit by day of next month'],
  ['late_pct', 'Late deduction % (1, 2, 3 months)'], ['auto_per_km', 'Auto fare ₹ a km'], ['auto_min_fare', 'Auto minimum fare ₹'],
]

export default function TeAdmin() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['te_admin'], queryFn: () => rpc<AdminData>('te_admin_data') })
  const [tab, setTab] = useState<typeof TABS[number][0] | 'delete'>('rules')
  const [msg, setMsg] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const call = async (fn: string, args: Record<string, unknown>, done = 'Saved.') => {
    setMsg(null); setFail(null)
    try { await rpc(fn, args); await qc.invalidateQueries({ queryKey: ['te_admin'] }); setMsg(done) } catch (e) { setFail((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'Could not open.'}</Alert>
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><Settings2 className="h-5 w-5 text-violet-600" /> Travel policy</h1>
      <div className="flex flex-wrap gap-1.5">
        {[...TABS, ...(data.sw ? [['delete', 'Delete'] as const] : [])].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={clsx('rounded-full px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>{l}</button>)}
      </div>
      {msg && <Alert kind="success">{msg}</Alert>}
      {fail && <Alert kind="error">{fail}</Alert>}

      {tab === 'rules' && <Rules rules={data.rules} onSave={r => void call('te_set_rule', { p_rule: r })} />}
      {tab === 'policy' && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          {POLICY.map(([k, l]) => <PolicyField key={k} label={l} value={data.policy[k]} onSave={v => void call('te_set_policy', { p_key: k, p_value: v })} />)}
        </div>
      )}
      {tab === 'purposes' && <Purposes list={data.purposes} call={call} />}
      {tab === 'projects' && <Projects list={data.projects} call={call} />}
      {tab === 'coord' && <Coordinators list={data.coordinators} call={call} />}
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
          <th className="px-3 py-2">Grade</th>{RULE_COLS.map(([, l]) => <th key={l} className="px-2 py-2">{l}</th>)}<th className="px-2 py-2">Flight</th><th className="px-2 py-2">Taxi</th><th />
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

type Call = (fn: string, args: Record<string, unknown>, done?: string) => Promise<void>
function Purposes({ list, call }: { list: AdminData['purposes']; call: Call }) {
  const [label, setLabel] = useState('')
  return (
    <div className="card space-y-2 p-4">
      {list.map(p => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
          <span className={clsx('min-w-[12rem] font-medium', p.is_active ? 'text-ink-900' : 'text-ink-400 line-through')}>{p.label}</span>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.gives_da} onChange={e => void call('te_set_purpose', { p_id: p.id, p_label: p.label, p_gives_da: e.target.checked, p_active: p.is_active })} /> Gives DA</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.is_active} onChange={e => void call('te_set_purpose', { p_id: p.id, p_label: p.label, p_gives_da: p.gives_da, p_active: e.target.checked })} /> In use</label>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input max-w-xs" placeholder="New purpose" value={label} onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!label.trim()} onClick={() => { void call('te_set_purpose', { p_id: null, p_label: label, p_gives_da: true, p_active: true }, 'Purpose added.'); setLabel('') }}>Add</button>
      </div>
    </div>
  )
}

function Coordinators({ list, call }: { list: AdminData['coordinators']; call: Call }) {
  const [e, setE] = useState(''), [k, setK] = useState('')
  return (
    <div className="card space-y-2 p-4">
      {list.length === 0 && <p className="text-sm text-ink-500">No coordinators set. Claims go from the manager straight to the Travel Desk.</p>}
      {list.map(c => (
        <div key={c.ecode} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-ink-900">{c.name} <span className="text-ink-500">{c.ecode}</span></span>
          <span className="text-ink-400">→ coordinator</span>
          <span className="font-medium text-ink-900">{c.coordinator} <span className="text-ink-500">{c.coordinator_ecode}</span></span>
          <button type="button" className="btn-icon text-cyrixRed-600" aria-label="Remove" onClick={() => void call('te_set_coordinator', { p_ecode: c.ecode, p_coordinator: '' }, 'Removed.')}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-2">
        <input className="input w-36" placeholder="Employee E-code" value={e} onChange={x => setE(x.target.value)} />
        <input className="input w-40" placeholder="Coordinator E-code" value={k} onChange={x => setK(x.target.value)} />
        <button type="button" className="btn-secondary" disabled={!e.trim() || !k.trim()} onClick={() => { void call('te_set_coordinator', { p_ecode: e, p_coordinator: k }); setE(''); setK('') }}>Set</button>
      </div>
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
        <div key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
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
/*
  Delete a claim (Travel te_0028; the user, 18 Oct: "for sw_admin like in revive lab also need option to
  delete claim" — "only for swadmin"), as Revive Lab deletes a ticket: type its number, see whose it
  is, confirm. Its bills go first, then the claim with its days and history; one audit line keeps what
  it was. The tab shows only for SW Admin, and the database refuses anybody else.
*/
function DeleteClaim() {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<{ id: string; number: string; name: string; ecode: string; month: string; status: string; total: number; days: number; paths: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lookUp = async () => {
    setError(null); setNotice(null); setFound(null); setBusy(true)
    try { setFound(await rpc('te_find_claim', { p_number: typed })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!found) return
    setBusy(true); setError(null)
    try {
      if (found.paths.length) {
        const { error: rm } = await supabase.storage.from('te-bills').remove(found.paths)
        if (rm) throw new Error(rm.message)
      }
      await rpc('te_delete_claim', { p_claim: found.id })
      setNotice(`Deleted ${found.number}.`); setFound(null); setTyped('')
      void qc.invalidateQueries()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const mon = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return `${d.toLocaleDateString('en-GB', { month: 'short' })}-${String(d.getFullYear()).slice(2)}` }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Trash2 className="h-4 w-4 text-cyrixRed-600" />
        <h3 className="text-sm font-semibold text-ink-800">Delete a claim</h3>
      </div>
      <div className="space-y-3 p-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void lookUp() }}>
          <label className="block w-44"><span className="label">Claim number</span>
            <input className="input mt-1 h-11 font-mono" value={typed} onChange={e => { setTyped(e.target.value); setFound(null) }} placeholder="TE-02" /></label>
          <button type="submit" className="btn-secondary h-11 !text-cyrixRed-700" disabled={busy || !typed.trim()}>
            {busy && !found ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} Delete
          </button>
        </form>
        {found && (
          <div className="rounded-xl border border-cyrixRed-200 bg-cyrixRed-50 p-3">
            <p className="text-sm font-medium text-cyrixRed-900">Delete {found.number} · {found.name} ({found.ecode}) · {mon(found.month)} · ₹{Math.round(found.total).toLocaleString('en-IN')} for good?</p>
            <p className="mt-0.5 text-xs text-cyrixRed-800">{STATUS_WORD[found.status] ?? found.status} · {found.days} day{found.days === 1 ? '' : 's'}. Its days, bills and history go with it. This cannot be undone.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Yes, delete {found.number}</button>
              <button type="button" className="btn-secondary" onClick={() => setFound(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/*
  Places learned from tickets (Travel te_0038; the user, 21 Oct): every hospital a ticket was saved
  against, offered to everyone who searches. Nobody keeps this list; a wrong one is taken off here.
*/
// The map only when a place is opened on it, so this page does not carry it otherwise.
const PlaceMapDialog = lazy(() => import('@/components/PlaceMapDialog'))
function LearnedPlaces() {
  const qc = useQueryClient()
  const ask = useAsk()
  const { data, isLoading, error } = useQuery({ queryKey: ['te_admin_places'], queryFn: () => rpc<Array<{ id: string; name: string; full_name: string; district: string | null; visits: number; first_by: string | null; created_at: string; lat: number; lng: number }>>('te_admin_places') })
  const [onMap, setOnMap] = useState<{ id: string; name: string; full_name: string; lat: number; lng: number } | null>(null)
  const [q, setQ] = useState('')
  const [fail, setFail] = useState<string | null>(null)
  const remove = async (id: string, name: string) => {
    if (!(await ask.confirm({ title: `Remove ${name}?`, body: 'It is no longer offered when engineers search. Claims that used it keep it.', yes: 'Remove', danger: true }))) return
    try { await rpc('te_hide_place', { p_id: id }); await qc.invalidateQueries({ queryKey: ['te_admin_places'] }) } catch (e) { setFail((e as Error).message) }
  }
  if (isLoading) return <PageLoader />
  const list = (data ?? []).filter(p => !q.trim() || `${p.name} ${p.full_name} ${p.district ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800"><Hospital className="h-4 w-4 text-cyrixRed-600" /> Learned places <span className="font-normal text-ink-500">· {data?.length ?? 0}</span></h3>
        <input className="input h-9 w-full sm:w-56" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {(fail || error) && <div className="p-3"><Alert kind="error">{fail ?? (error as Error).message}</Alert></div>}
      {list.length === 0 ? <p className="p-6 text-center text-sm text-ink-500">No places yet.</p> : (
        <div className="divide-y divide-ink-100">
          {list.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-900">{p.name}{p.district && <span className="font-normal text-ink-500"> · {p.district}</span>}</p>
                <p className="truncate text-xs text-ink-500">{p.visits} visit{p.visits === 1 ? '' : 's'} · first by {p.first_by ?? '—'} · {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
              </div>
              <button type="button" className="btn-icon text-teal-600" aria-label={`${p.name} on the map`} title="See and move on the map" onClick={() => setOnMap(p)}><MapIcon className="h-4 w-4" /></button>
              <button type="button" className="btn-icon text-cyrixRed-600" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => void remove(p.id, p.name)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      {onMap && (
        <Suspense fallback={null}>
          <PlaceMapDialog place={onMap} onClose={() => setOnMap(null)}
            onSave={async p => { await rpc('te_edit_place', { p_id: onMap.id, p_name: p.name, p_lat: p.lat, p_lng: p.lng }); setOnMap(null); await qc.invalidateQueries({ queryKey: ['te_admin_places'] }) }} />
        </Suspense>
      )}
    </div>
  )
}
