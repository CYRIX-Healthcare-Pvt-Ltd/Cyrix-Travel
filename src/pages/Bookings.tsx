import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BedDouble, Building2, Bus, CarTaxiFront, FileSpreadsheet, Plane, TrainFront, Upload } from 'lucide-react'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import { newId, rpc, type CompanyBooking } from '@/lib/claims'
import { readBookings } from '@/lib/bookings'

/*
  Company bookings (te_0042; the user, 21 Oct): the Travel Desk uploads MakeMyTrip's monthly report here.
  A ticket an engineer attaches is read for its booking id, and one the company paid for claims nothing.
  Each booking shows the claims that carry it, so one on no claim stands out too.
*/
type Row = CompanyBooking & { claims: Array<{ number: string; id: string; name: string; ecode: string }> }
const ICON: Record<string, typeof Plane> = { flight: Plane, hotel: BedDouble, bus: Bus, train: TrainFront, cab: CarTaxiFront }
const dn = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function Bookings() {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['te_bookings'], queryFn: () => rpc<{ uploads: Array<{ file: string; lines: number; at: string; by: string | null }>; bookings: Row[] }>('te_bookings') })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const upload = async (f: File | undefined) => {
    if (!f) return
    setFail(null); setNotice(null); setBusy('Reading the report…')
    try {
      const { lines, bySheet } = await readBookings(f)
      if (!lines.length) throw new Error('No bookings found. The report needs its Flight, Hotel, Bus or Rail sheet with a booking_id column.')
      const id = newId()
      for (let i = 0; i < lines.length; i += 300) {
        setBusy(`Uploading ${Math.min(i + 300, lines.length)} of ${lines.length}…`)
        await rpc('te_upload_bookings', { p_upload: id, p_file: f.name, p_rows: lines.slice(i, i + 300) })
      }
      setNotice(`${f.name}: ${lines.length} lines · ${Object.entries(bySheet).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
      await qc.invalidateQueries({ queryKey: ['te_bookings'] })
    } catch (e) { setFail((e as Error).message) } finally { setBusy(null) }
  }

  if (isLoading) return <PageLoader />
  const term = q.trim().toLowerCase()
  const list = (data?.bookings ?? []).filter(b => !term || [b.booking_id, b.pnr, b.from, b.to, b.hotel, b.passengers, ...b.claims.map(c => `${c.number} ${c.name} ${c.ecode}`)]
    .some(x => (x ?? '').toLowerCase().includes(term)))
  const onClaims = list.filter(b => b.claims.length).length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><Building2 className="h-5 w-5 text-sky-600" /> Company bookings</h1>
        <button type="button" className="btn-primary" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {busy ?? 'Upload report'}
        </button>
        <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      {(fail || error) && <Alert kind="error">{fail ?? (error as Error).message}</Alert>}
      {(data?.uploads ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-ink-500">
          {data!.uploads.slice(0, 4).map((u, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1"><FileSpreadsheet className="h-3.5 w-3.5" />{u.file} · {u.lines} lines · {new Date(u.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          ))}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <span className="text-sm font-semibold text-ink-800">{list.length} bookings <span className="font-normal text-ink-500">· {onClaims} on claims</span></span>
          <input className="input h-9 w-full sm:w-64" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {list.length === 0 ? <p className="p-6 text-center text-sm text-ink-500">No bookings yet.</p> : (
          <div className="divide-y divide-ink-100">
            {list.slice(0, 300).map(b => {
              const I = ICON[b.mode] ?? Building2
              return (
                <div key={b.booking_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <I className="h-4 w-4 shrink-0 text-sky-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{b.mode === 'hotel' ? `${b.hotel ?? 'Hotel'}${b.to ? ', ' + b.to : ''}` : `${b.from ?? '—'} → ${b.to ?? '—'}`}</span>
                    <span className="block truncate text-xs text-ink-500">{dn(b.travel_date)}{b.end_date && b.end_date !== b.travel_date ? ` – ${dn(b.end_date)}` : ''} · {b.passengers ?? '—'} · <span className="font-mono">{b.booking_id}</span></span>
                  </span>
                  <span className={`shrink-0 font-semibold ${b.cancelled ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{money(Number(b.net))}</span>
                  <span className="flex shrink-0 flex-wrap gap-1">
                    {b.claims.map(c => <Link key={c.id} to={`/claim/${c.id}`} className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 hover:underline">{c.number} · {c.name.split(' ')[0]}</Link>)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
