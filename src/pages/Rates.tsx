import { useState } from 'react'
import { Camera as CameraIcon, IndianRupee } from 'lucide-react'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import ModeArt from '@/components/ModeArt'
import { rupees, useModes, usePhotosRequired, useSetPhotosRequired, useSetRate, type Mode } from '@/lib/travel'

/**
 * What each mode pays, kept by the software administrator. A mode with a
 * rate is paid by the kilometre; one without is paid on the actual fare,
 * with a photograph of its bill. A change applies to legs closed after it.
 *
 * Also here: whether photographs are required at all (te_0006). The same
 * three things are on the Travel Expense tab of SW Admin in KPI.
 */
export default function Rates() {
  const { data: modes, isLoading } = useModes()
  if (isLoading) return <PageLoader />
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Rates</h1>
        <p className="mt-0.5 text-sm text-ink-500">What a kilometre pays on each mode. A change applies to legs closed from then on; claims already made keep the rate they were made at.</p>
      </div>
      <div className="card overflow-hidden">
        <h2 className="flex items-center gap-2.5 border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">
          <IconChip icon={IndianRupee} tone="violet" /> Per mode
        </h2>
        <ul className="divide-y divide-ink-100">
          {(modes ?? []).map(m => <RateRow key={m.mode} m={m} />)}
        </ul>
      </div>
      <PhotosSwitch />
    </div>
  )
}

/** Whether a stop needs its proof and a fare-paid leg its bill. Off is for trying the module where there is no camera. */
function PhotosSwitch() {
  const required = usePhotosRequired()
  const set = useSetPhotosRequired()
  const [error, setError] = useState<string | null>(null)
  const flip = async () => {
    setError(null)
    try { await set.mutateAsync({ on: !required }) } catch (e) { setError(e instanceof Error ? e.message : 'That was not saved.') }
  }
  return (
    <div className="card overflow-hidden">
      <h2 className="flex items-center gap-2.5 border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-semibold text-ink-800">
        <IconChip icon={CameraIcon} tone="indigo" /> Photographs
      </h2>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">Photographs are required</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {required
                ? 'A stop cannot be closed without its proof, nor a bus, train or auto leg ended without its bill.'
                : 'Off: a stop can be closed and a fare-paid leg ended with no photograph. The claim says where one is missing.'}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={required} aria-label="Photographs are required" onClick={flip} disabled={set.isPending}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${required ? 'bg-green-600' : 'bg-ink-300'}`}>
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${required ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {!required && <Alert kind="warning">Switch this back on before Travel Expense is given to engineers: the photograph is the proof the claim rests on.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </div>
  )
}

function RateRow({ m }: { m: Mode }) {
  const set = useSetRate()
  const [value, setValue] = useState(m.per_km?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const changed = m.per_km !== null && Number(value) !== m.per_km
  // Moving a mode between the kilometre and the fare: asked for first, since it changes what every later leg on it pays.
  const [moving, setMoving] = useState(false)
  const [rate, setRate] = useState('')
  const toFare = async () => {
    setError(null)
    try { await set.mutateAsync({ mode: m.mode, perKm: null }); setMoving(false) } catch (e) { setError(e instanceof Error ? e.message : 'That was not saved.') }
  }
  const toKm = async () => {
    setError(null)
    const n = Number(rate)
    if (!rate.trim() || !Number.isFinite(n) || n <= 0) { setError('Enter a rate above zero.'); return }
    try { await set.mutateAsync({ mode: m.mode, perKm: n }); setMoving(false); setValue(String(n)); setRate('') } catch (e) { setError(e instanceof Error ? e.message : 'That was not saved.') }
  }

  const save = async () => {
    setError(null); setSaved(false)
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a rate above zero.'); return }
    try { await set.mutateAsync({ mode: m.mode, perKm: n }); setSaved(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'The rate was not saved.') }
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex w-36 items-center gap-2.5 text-sm font-medium text-ink-900">
          <ModeArt mode={m.mode} className="w-10 rounded-md" /> {m.label}
        </span>
        {!m.is_active && <span className="badge bg-ink-100 text-ink-500">not in use</span>}
        {m.per_km === null ? (
          <span className="text-sm text-ink-500">Paid on the actual fare, with a photograph of the bill</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-ink-600">
              ₹
              <input className="input !w-24 !py-1.5 tabular-nums" inputMode="decimal" value={value}
                onChange={e => { setValue(e.target.value.replace(/[^0-9.]/g, '')); setSaved(false) }} aria-label={`${m.label} rate per km`} />
              a km
            </label>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={save} disabled={!changed || set.isPending}>
              {set.isPending && <Spinner className="h-4 w-4" />} Save
            </button>
            {saved && <span className="text-xs font-medium text-green-700">Saved</span>}
          </>
        )}
      </div>
      {moving ? (
        m.per_km === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-600">
              Pay {m.label.toLowerCase()} at ₹
              <input className="input !w-24 !py-1.5 tabular-nums" inputMode="decimal" value={rate} autoFocus
                onChange={e => setRate(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`${m.label} rate per km`} />
              a km
            </label>
            <button type="button" className="btn-primary !py-1.5 text-sm" onClick={toKm} disabled={set.isPending}>{set.isPending && <Spinner className="h-4 w-4" />} Pay by the kilometre</button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { setMoving(false); setError(null) }}>Cancel</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-ink-700">Pay {m.label.toLowerCase()} on the actual fare, with a photograph of the bill, instead of {rupees(m.per_km)} a km?</p>
            <button type="button" className="btn-primary !py-1.5 text-sm" onClick={toFare} disabled={set.isPending}>{set.isPending && <Spinner className="h-4 w-4" />} Pay on the fare</button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => { setMoving(false); setError(null) }}>Cancel</button>
          </div>
        )
      ) : (
        <button type="button" className="link-accent text-xs text-ink-500 underline" onClick={() => { setMoving(true); setError(null) }}>
          {m.per_km === null ? 'Pay by the kilometre instead' : 'Pay on the actual fare instead'}
        </button>
      )}
      {error && <Alert kind="error">{error}</Alert>}
    </li>
  )
}
