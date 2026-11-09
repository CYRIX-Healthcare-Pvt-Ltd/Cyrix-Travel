import { useRef, useState } from 'react'
import { Check, ExternalLink, ImagePlus, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { km } from '@/lib/claims'
import { addRouteShot, googleRoute, needsShot, openRouteShot, overPct, removeRouteShot, shotBacks, type RouteShot } from '@/lib/routeShots'

type R = { id: string; mode: string; claimed_km: number | null; map_km: number | null; from_name?: string | null; to_name?: string | null; from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null }

/**
  Under a ride on its map (te_0140): Google Maps with the ride's From and To, and the screenshot taken there — added
  by the person while the claim can be changed, seen by everyone after, with the km read off it set against the km claimed.
*/
export default function RouteProof({ ride, shot, pct, claimId, onChange }: {
  ride: R; shot: RouteShot | undefined; pct: number
  /** Given while the claim can be changed: the screenshot can be added. */
  claimId?: string; onChange?: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (ride.from_lat == null || ride.to_lat == null) return null
  const need = needsShot(ride, pct), edit = !!claimId && !!onChange
  const read = shot?.km ?? null, backs = shotBacks(read, ride.claimed_km)

  const add = async (f: File) => {
    setBusy(true); setErr(null)
    try { await addRouteShot(claimId!, ride.id, f, ride.claimed_km); onChange!() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setErr(null)
    try { await removeRouteShot(shot!.id); onChange!() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="mt-2 w-full space-y-1.5">
      {need && !shot && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> {km(ride.claimed_km)} is {overPct(ride)}% over the map · Google Maps screenshot needed
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <a href={googleRoute(ride)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 text-sm font-semibold text-ink-800 hover:bg-ink-100">
          <ExternalLink className="h-4 w-4 text-teal-700" /> Google Maps
        </a>
        {shot ? (
          <button type="button" onClick={e => { e.stopPropagation(); void openRouteShot(shot.path) }}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${read == null ? 'bg-amber-100 text-amber-900' : backs ? 'bg-emerald-100 text-emerald-900' : 'bg-cyrixRed-100 text-cyrixRed-800'}`}>
            {read == null ? <TriangleAlert className="h-4 w-4" /> : backs ? <Check className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
            {read == null ? 'Screenshot · km not read' : `Screenshot ${km(read)}`}
          </button>
        ) : edit && (
          <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); file.current?.click() }}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${need ? 'bg-amber-500 text-white hover:bg-amber-600' : 'border border-ink-200 bg-surface text-ink-800 hover:bg-ink-100'}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Add screenshot
          </button>
        )}
        {shot && edit && (
          <>
            <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); file.current?.click() }} className="text-sm font-semibold text-violet-700 hover:underline">
              {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Change'}
            </button>
            <button type="button" disabled={busy} aria-label="Remove the screenshot" onClick={e => { e.stopPropagation(); void remove() }} className="btn-icon text-cyrixRed-600"><Trash2 className="h-4 w-4" /></button>
          </>
        )}
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add(f) }} />
      </div>
      {shot && read != null && !backs && (
        <p className="text-xs font-semibold text-cyrixRed-700">Claimed {km(ride.claimed_km)}, screenshot shows {km(read)}</p>
      )}
      {err && <p role="alert" className="text-xs font-semibold text-cyrixRed-700">{err}</p>}
    </div>
  )
}
