import { useState } from 'react'
import { IndianRupee } from 'lucide-react'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import IconChip from '@/components/IconChip'
import ModeArt from '@/components/ModeArt'
import { useModes, useSetRate, type Mode } from '@/lib/travel'

/**
 * What each mode pays, kept by the software administrator. A mode with a
 * rate is paid by the kilometre; one without is paid on the actual fare,
 * with a photograph of its bill. A change applies to legs closed after it.
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
    </div>
  )
}

function RateRow({ m }: { m: Mode }) {
  const set = useSetRate()
  const [value, setValue] = useState(m.per_km?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const changed = m.per_km !== null && Number(value) !== m.per_km

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
      {error && <Alert kind="error">{error}</Alert>}
    </li>
  )
}
