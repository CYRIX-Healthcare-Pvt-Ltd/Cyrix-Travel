import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ImagePlus, Loader2, Navigation, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import { inkVars, km, MODES } from '@/lib/claims'
import { useBackCloses } from '@/lib/useBackCloses'
import { addRouteShot, googleRoute, needsShot, removeRouteShot, routeShotUrl, shotBacks, shotFits, type Band, type RouteShot } from '@/lib/routeShots'

type R = { id: string; mode: string; claimed_km: number | null; map_km: number | null; from_lat: number | null; from_lng: number | null; to_lat: number | null; to_lng: number | null }

/**
  Under a ride (te_0140): Google Maps with the ride's own From and To points, and the screenshot taken there — added
  by the person while the claim can be changed, seen by everyone after, with the km read off it set against the km
  claimed. The screenshot opens in a popup in the app (the user, 9 Nov: "instead of popup it is going to new tab").
*/
export default function RouteProof({ ride, shot, band, claimId, onChange, onKm }: {
  ride: R; shot: RouteShot | undefined; band: Band
  /** Given while the claim can be changed: the screenshot can be added. */
  claimId?: string; onChange?: () => void
  /** The km the screenshot gives the ride, or null when it is removed (te_0141: the km box takes it, locked). */
  onKm?: (km: number | null) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (shot) void routeShotUrl(shot.path).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [shot?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  // Only where the km is paid: bike and car (the user, 9 Nov: "it is needed only for the mode whr we check km isnt?").
  if (ride.from_lat == null || ride.to_lat == null || (ride.mode !== 'bike' && ride.mode !== 'car')) return null
  const need = needsShot(ride, band), edit = !!claimId && !!onChange
  const read = shot?.km != null ? Number(shot.km) : null, backs = shotBacks(read, ride.claimed_km)
  // Taken for other points than the ride has now, or showing a point that is neither of the ride's (te_0141).
  const moved = !!shot && !shotFits(shot, ride), edited = shot?.places === 'edited'
  const tone = !shot ? 'amber' : moved || edited ? 'red' : read == null ? 'amber' : backs ? 'green' : 'red'
  // Waiting for the screenshot, the box takes the ride's own colour: blue for a car, amber for a bike (the user, 9 Nov).
  const mc = MODES[ride.mode as keyof typeof MODES], own = tone === 'amber'
  const ring = { amber: '', green: 'border-emerald-300 bg-emerald-50', red: 'border-cyrixRed-300 bg-cyrixRed-50' }[tone]
  const ink = { amber: 'mode-ink', green: 'text-emerald-900', red: 'text-cyrixRed-800' }[tone]
  const status = !shot ? 'Google Maps screenshot needed'
    : moved ? 'From or To changed after this screenshot'
    : edited ? `Google Maps ${km(read)} · From or To not the ride's`
    : read == null ? 'Screenshot · km not read'
    : backs ? `Google Maps ${km(read)} · km set from the screenshot`
    : `Claimed ${km(ride.claimed_km)} · Google Maps ${km(read)}`

  const add = async (f: File) => {
    setBusy(true); setErr(null)
    try { const k = await addRouteShot(claimId!, ride, f, ride.claimed_km); onKm?.(k); onChange!() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setErr(null)
    try { await removeRouteShot(shot!.id); setOpen(false); onKm?.(null); onChange!() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const pick = () => file.current?.click()
  const btn = 'inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold'

  return (
    <div className={`mt-2 w-full rounded-xl border p-2.5 ${ring}`} onClick={e => e.stopPropagation()}
      style={own ? { borderColor: mc.color + '99', background: mc.color + '14', ...inkVars(mc) } : undefined}>
      {(need || shot) && (
        <p className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${ink}`}>
          {tone === 'green' ? <Check className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />}{status}
        </p>
      )}
      <div className="flex gap-2">
        {shot && (
          <button type="button" onClick={() => setOpen(true)} aria-label="See the screenshot"
            className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-100">
            {url ? <img src={url} alt="" className="h-full w-full object-cover object-center" /> : <Loader2 className="m-auto h-4 w-4 animate-spin text-ink-400" />}
          </button>
        )}
        <div className={`grid min-w-0 flex-1 gap-2 ${shot ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
          <a href={googleRoute(ride)} target="_blank" rel="noreferrer" className={`${btn} border border-ink-200 bg-surface text-ink-900`}>
            <Navigation className="h-4 w-4 text-teal-700" /> Google Maps
          </a>
          {edit && (shot ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button type="button" disabled={busy} onClick={pick} className={`${btn} border border-ink-200 bg-surface text-violet-700`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Change
              </button>
              <button type="button" disabled={busy} onClick={() => void remove()} aria-label="Remove the screenshot"
                className="grid h-11 w-11 place-items-center rounded-xl border border-ink-200 bg-surface text-cyrixRed-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={pick} className={`${btn} ${need ? 'shot-need mode-bg text-white' : 'border border-ink-200 bg-surface text-ink-900'}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {busy ? 'Reading…' : 'Add screenshot'}
            </button>
          ))}
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add(f) }} />
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-cyrixRed-700">{err}</p>}
      {open && shot && <ShotView url={url} title={status} tone={ink} vars={inkVars(mc)} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The screenshot full screen in the app; back or the cross closes it. */
function ShotView({ url, title, tone, vars, onClose }: { url: string | null; title: string; tone: string; vars: CSSProperties; onClose: () => void }) {
  useBackCloses(onClose)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Google Maps screenshot" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3" onClick={e => e.stopPropagation()}>
        <p className={`min-w-0 text-sm font-semibold ${tone}`} style={vars}>{title}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {url ? <img src={url} alt="Google Maps screenshot" className="mx-auto max-h-full w-auto max-w-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          : <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-white" />}
      </div>
    </div>,
    document.body,
  )
}
