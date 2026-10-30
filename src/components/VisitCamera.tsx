import { useEffect, useRef, useState } from 'react'
import { Check, LocateFixed, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui'
import type { Fix } from '@/lib/geo'
import { deviceId, deviceName, grab, newPending, queuePhoto, sendPhoto, stamp, stampPlace } from '@/lib/visits'

/*
  The app's own camera (the user, 28 Oct: "no upload option only camera"): a live view and a shutter, no file picker,
  so nothing from the gallery can come in. The location is read all the while; the frame is taken at the press and
  stamped with the date, time, place, point and who before it is kept.
*/
export default function VisitCamera({ onClose, onDone }: { onClose: () => void; onDone: (text: string, queued: boolean) => void }) {
  const { employee } = useAuth()
  const video = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [shot, setShot] = useState<{ blob: Blob; url: string; at: Date; fix: Fix; place: string | null } | null>(null)
  const [busy, setBusy] = useState<'taking' | 'sending' | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null, gone = false
    if (!navigator.mediaDevices?.getUserMedia) setErr('This browser gives the page no camera. Open the app in Chrome or Safari.')
    else navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(s => {
        if (gone) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; void video.current.play().then(() => setLive(true)) }
      })
      .catch(() => setErr('The camera is not allowed for this page. Allow the camera in the browser, then try again.'))
    const watch = navigator.geolocation?.watchPosition(
      p => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => setErr(e.code === e.PERMISSION_DENIED ? 'Location is switched off for this page. Allow location in the browser, then try again.' : 'Your location could not be read. Step outside or wait a moment.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
    return () => { gone = true; stream?.getTracks().forEach(t => t.stop()); if (watch != null) navigator.geolocation.clearWatch(watch) }
  }, [])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  // The phone's model where the browser tells it, and its own id's first four, so two phones alike still differ on the photo.
  const [phone, setPhone] = useState<string | null>(null)
  useEffect(() => {
    void deviceName().then(n => {
      const id = deviceId()
      setPhone([n ?? 'Phone', id ? id.replace(/-/g, '').slice(0, 4).toUpperCase() : null].filter(Boolean).join(' · '))
    })
  }, [])

  const take = async () => {
    if (!video.current || !fix || !employee) return
    setBusy('taking'); setErr(null)
    const at = new Date(), here = fix, frame = grab(video.current)
    try {
      const place = await stampPlace(here)
      const blob = await stamp(frame, at, here, place, `${employee.full_name} · ${employee.ecode}`, phone)
      setShot({ blob, url: URL.createObjectURL(blob), at, fix: here, place })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const use = async () => {
    if (!shot || !employee) return
    setBusy('sending'); setErr(null)
    const p = newPending(shot.blob, employee.id, shot.fix, shot.at, shot.place)
    try { await sendPhoto(p); onDone('Photo saved', false) }
    catch (e) {
      if ((e as { refused?: boolean }).refused) { setErr((e as Error).message); setBusy(null); return }
      // No signal: it waits on the phone and goes when the phone is back online.
      await queuePhoto(p)
      onDone('No signal. The photo is kept on this phone and goes by itself when the signal is back', true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Close the camera" onClick={onClose}><X className="h-5 w-5" /></button>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${fix ? (fix.accuracy <= 50 ? 'bg-emerald-600/90' : 'bg-amber-600/90') : 'bg-white/15'}`}>
          <LocateFixed className="h-3.5 w-3.5" />{fix ? `Location ±${Math.round(fix.accuracy)} m` : 'Finding location…'}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${shot ? 'invisible' : ''}`} />
        {shot && <img src={shot.url} alt="The visit photo" className="absolute inset-0 h-full w-full object-contain" />}
        {!live && !err && !shot && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
      </div>
      <div className="space-y-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {err && <p role="alert" className="rounded-lg bg-cyrixRed-600/90 px-3 py-2 text-center text-sm font-medium">{err}</p>}
        {shot ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white/15 font-semibold" disabled={!!busy} onClick={() => setShot(null)}><RotateCcw className="h-4 w-4" /> Retake</button>
            <button type="button" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold" disabled={!!busy} onClick={() => void use()}>
              {busy === 'sending' ? <Spinner /> : <Check className="h-4 w-4" />} Use photo
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button type="button" aria-label="Take the photo" disabled={!live || !fix || !!busy} onClick={() => void take()}
              className="grid h-[72px] w-[72px] place-items-center rounded-full border-4 border-white/80 disabled:opacity-40">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white">{busy === 'taking' && <Spinner />}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
