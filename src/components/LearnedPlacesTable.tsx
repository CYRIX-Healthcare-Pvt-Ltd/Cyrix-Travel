import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Hospital, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Alert, PageLoader } from '@/components/ui'

/*
  The places our engineers have taught the search, for a Travel admin or SW Admin — the same file in Travel
  (src/components) and in KPI's SW Admin (src/components); change both.

  A ticket's hospital is learned when its day is saved (te_0038), and so is any spot the map does not have that an
  engineer named by hand (te_0071). An admin puts a wrong name or pin right with Edit; there is no tick to check each
  one (the user, 30 Oct: "remove the tick, keep edit so checked column no needed, and keep added so we can see who
  added it"): with engineers in nearly every state the new ones would pile up unchecked.

  Search, sort and filter, as every admin table has (the user, 26 Oct: "whenever created table for admin always
  remember admins need to sort filter and search"); the date added in its own column to sort by ("date in diff
  column bcz i need to sort when needed"); who added it by name and code ("name - ecode"). A table on a computer,
  sorted by its column headings; rows with a sort menu on a phone.
*/
const PlaceMapDialog = lazy(() => import('@/components/PlaceMapDialog'))

export interface LearnedPlace {
  id: string; name: string; full_name: string; district: string | null; visits: number; first_by: string | null; created_at: string
  lat: number; lng: number; source: string; checked_at: string | null; checked_by: string | null
}
type Col = 'name' | 'by' | 'date' | 'visits'
type Order = { col: Col; up: boolean }
// The way a column first sorts when its heading is pressed: dates and visits newest and most first.
const FIRST_UP: Record<Col, boolean> = { name: true, by: true, date: false, visits: false }
const PHONE_SORTS: Array<[string, string, Order]> = [
  ['new', 'Newest first', { col: 'date', up: false }], ['old', 'Oldest first', { col: 'date', up: true }],
  ['name', 'Name A–Z', { col: 'name', up: true }], ['by', 'Added by A–Z', { col: 'by', up: true }],
  ['visits', 'Most visits', { col: 'visits', up: false }],
]
type Show = 'all' | 'named' | 'ticket' | 'admin'
const SHOWS: Array<[Show, string]> = [['all', 'All places'], ['named', 'Named on the map'], ['ticket', 'From a ticket'], ['admin', 'Added by admin']]
const shown = (p: LearnedPlace, s: Show) => s === 'all' || p.source === s
const by = (a: LearnedPlace, b: LearnedPlace, col: Col) =>
  col === 'name' ? a.name.localeCompare(b.name)
    : col === 'by' ? (a.first_by ?? '').localeCompare(b.first_by ?? '')
    : col === 'visits' ? a.visits - b.visits
    : a.created_at.localeCompare(b.created_at)
// Every word typed found in its name, address, district or who added it.
const matches = (p: LearnedPlace, q: string) => {
  const hay = `${p.name} ${p.full_name} ${p.district ?? ''} ${p.first_by ?? ''}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const how = (p: LearnedPlace) => (p.source === 'named' ? 'Named on the map' : p.source === 'admin' ? 'Added by admin' : 'From a ticket')
// Where the map opens for a new place: the Kochi office. A search or a pasted link takes it anywhere.
const START = { id: '', name: '', lat: 9.94752, lng: 76.33331 }

export default function LearnedPlacesTable({ call, confirmRemove }: {
  call: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>
  confirmRemove: (name: string) => Promise<boolean>
}) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['te_admin_places'], queryFn: () => call<LearnedPlace[]>('te_admin_places') })
  const [onMap, setOnMap] = useState<LearnedPlace | null>(null)
  // An admin adds a place themselves (te_0087; the user, 30 Oct: "why there is no option for sw admin to add place?").
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [order, setOrder] = useState<Order>({ col: 'date', up: false })
  const [fail, setFail] = useState<{ id: string; text: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['te_admin_places'] })
  const remove = async (p: LearnedPlace) => {
    if (!(await confirmRemove(p.name))) return
    try { setFail(null); await call('te_hide_place', { p_id: p.id }); await refresh() } catch (e) { setFail({ id: p.id, text: (e as Error).message }) }
  }
  if (isLoading) return <PageLoader />
  const all = data ?? []
  const list = all.filter(p => shown(p, show) && matches(p, q))
    .sort((a, b) => (order.up ? 1 : -1) * by(a, b, order.col) || b.created_at.localeCompare(a.created_at))
  const sortBy = (col: Col) => setOrder(o => (o.col === col ? { col, up: !o.up } : { col, up: FIRST_UP[col] }))
  const phoneSort = PHONE_SORTS.find(([, , o]) => o.col === order.col && o.up === order.up)?.[0] ?? ''

  const actions = (p: LearnedPlace) => (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" aria-label={`Edit ${p.name}`} title="Edit the name or pin" onClick={() => setOnMap(p)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
      <button type="button" className="btn-icon text-cyrixRed-600" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => void remove(p)}><Trash2 className="h-4 w-4" /></button>
    </div>
  )
  const failed = (p: LearnedPlace) => fail?.id === p.id && <p className="mt-1 text-xs font-medium text-cyrixRed-700">{fail.text}</p>
  const Th = ({ col, children, right }: { col: Col; children: ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : ''}`} aria-sort={order.col === col ? (order.up ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`inline-flex items-center gap-1 hover:text-ink-900 ${order.col === col ? 'text-ink-900' : ''}`} onClick={() => sortBy(col)}>
        {children}{order.col === col && (order.up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
      </button>
    </th>
  )

  return (
    <div className="card overflow-hidden">
      <div className="space-y-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-800"><Hospital className="h-4 w-4 text-cyrixRed-600" /> Learned places <span className="font-normal text-ink-500">· {all.length}</span>
          <button type="button" className="btn-secondary ml-auto !px-2.5 !py-1.5 text-xs" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add place</button></h3>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input h-9 pl-9" placeholder="Search name, district or who added" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input h-9 min-w-0 flex-1 basis-32 md:w-auto md:flex-none md:basis-auto" value={show} onChange={e => setShow(e.target.value as Show)} aria-label="Show">
            {SHOWS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <select className="input h-9 min-w-0 flex-1 basis-32 md:hidden" value={phoneSort} aria-label="Sort"
            onChange={e => { const o = PHONE_SORTS.find(([v]) => v === e.target.value)?.[2]; if (o) setOrder(o) }}>
            {!phoneSort && <option value="">Sorted by column</option>}
            {PHONE_SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="p-3"><Alert kind="error">{(error as Error).message}</Alert></div>}
      {list.length === 0 ? <p className="p-6 text-center text-sm text-ink-500">{q.trim() || show !== 'all' ? 'No place matches.' : 'No places yet.'}</p> : (
        <>
          {/* A computer: columns, each heading sorts. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 text-left text-xs text-ink-500">
                <tr>
                  <Th col="name">Place</Th><Th col="by">Added by</Th><Th col="date">Added on</Th><Th col="visits" right>Visits</Th>
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {list.map(p => (
                  <tr key={p.id} className="align-top hover:bg-ink-50">
                    <td className="px-3 py-2.5"><p className="font-medium text-ink-900">{p.name}</p><p className="text-xs text-ink-500">{[p.district, how(p)].filter(Boolean).join(' · ')}</p>{failed(p)}</td>
                    <td className="px-3 py-2.5 text-ink-800">{p.first_by ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-800">{longDate(p.created_at)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-800">{p.visits}</td>
                    <td className="px-2 py-1.5">{actions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* A phone: one row each, sorted from the menu above. */}
          <div className="divide-y divide-ink-100 md:hidden">
            {list.map(p => (
              <div key={p.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-900">{p.name}</p>
                    <p className="text-xs text-ink-700">Added by <span className="font-medium">{p.first_by ?? '—'}</span> · <span className="whitespace-nowrap">{longDate(p.created_at)}</span></p>
                    <p className="text-xs text-ink-500">{[p.district, how(p), `${p.visits} visit${p.visits === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                  </div>
                  {actions(p)}
                </div>
                {failed(p)}
              </div>
            ))}
          </div>
        </>
      )}
      {onMap && (
        <Suspense fallback={null}>
          <PlaceMapDialog place={onMap} onClose={() => setOnMap(null)}
            onSave={async p => { await call('te_edit_place', { p_id: onMap.id, p_name: p.name, p_lat: p.lat, p_lng: p.lng }); setOnMap(null); await refresh() }} />
        </Suspense>
      )}
      {adding && (
        <Suspense fallback={null}>
          <PlaceMapDialog place={START} title="Add a place" onClose={() => setAdding(false)}
            onSave={async p => { await call('te_admin_add_place', { p_name: p.name, p_lat: p.lat, p_lng: p.lng }); setAdding(false); setShow('all'); await refresh() }} />
        </Suspense>
      )}
    </div>
  )
}
