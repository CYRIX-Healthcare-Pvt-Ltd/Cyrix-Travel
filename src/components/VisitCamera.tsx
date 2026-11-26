import { useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, CameraOff, Check, Loader2, LocateFixed, Lock, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui'
import { onlyApproximate, PRECISE_HELP, type Fix } from '@/lib/geo'
import { deviceId, deviceName, grab, onComputer, newPending, queuePhoto, sendPhoto, stamp, stampPlace } from '@/lib/visits'

/*
  The app's own camera (the user, 28 Oct: "no upload option only camera"): a live view and a shutter, no file picker,
  so nothing from the gallery can come in. The location is read all the while; the frame is taken at the press and
  stamped with the date, time, place, point and who before it is kept.
*/
/** Within this many metres a photo can be taken, as Start my day (te_0107). */
const CLOSE_M = 500

/** How to switch the camera back on, for the browser in use. */
function cameraSteps(): React.ReactNode[] {
  const ua = navigator.userAgent
  const iphone = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
  if (iphone) return ['Tap aA at the left of the address bar', 'Website Settings → Camera', 'Choose Allow, then come back']
  if (installed) return ['Open app.cyrix.in in Chrome', <>Tap the <Lock className="inline h-3.5 w-3.5" /> beside the address → Permissions</>, 'Camera → Allow, then come back']
  return [<>Tap the <Lock className="inline h-3.5 w-3.5" /> beside the address</>, 'Permissions → Camera', 'Choose Allow, then come back']
}

/** `forDay`: the day before, for a visit of its trip after midnight (te_0108). */
export default function VisitCamera({ onClose, onDone, forDay }: { forDay?: string | null; onClose: () => void; onDone: (text: string, queued: boolean, at?: { lat: number; lng: number; place: string | null }) => void }) {
  const { employee } = useAuth()
  const video = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [shot, setShot] = useState<{ blob: Blob; url: string; at: Date; fix: Fix; place: string | null } | null>(null)
  const [busy, setBusy] = useState<'taking' | 'sending' | null>(null)
  // The camera's own trouble, apart from location's, with a Try again (the user, 26 Nov: Travel Desk's phone said
  // "not allowed" for every camera failure, including one that was only busy).
  const [camErr, setCamErr] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /*
   * Whether the phone lets this page use the camera, asked before the camera starts (the user, 26 Nov: a pop-up only
   * when the camera is opened). Blocked → how to switch it on; never asked → a button that brings up the phone's own
   * question; a browser that cannot say → straight to the camera.
   */
  const [access, setAccess] = useState<'checking' | 'ask' | 'blocked' | 'ok'>('checking')
  const recheck = async () => {
    try {
      const st = await navigator.permissions.query({ name: 'camera' as PermissionName })
      setAccess(st.state === 'granted' ? 'ok' : st.state === 'denied' ? 'blocked' : 'ask')
    } catch { setAccess('ok') }
  }
  useEffect(() => {
    let status: PermissionStatus | null = null, gone = false
    if (!navigator.permissions?.query) { setAccess('ok'); return }
    navigator.permissions.query({ name: 'camera' as PermissionName })
      .then(st => {
        if (gone) return
        status = st
        const apply = () => setAccess(st.state === 'granted' ? 'ok' : st.state === 'denied' ? 'blocked' : 'ask')
        apply()
        // Switched on in the phone's settings while this screen waits: carry on by itself.
        st.onchange = () => { if (st.state === 'granted') setAccess('ok') }
      })
      .catch(() => { if (!gone) setAccess('ok') })
    return () => { gone = true; if (status) status.onchange = null }
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null, gone = false
    setCamErr(null)
    if (access !== 'ok') return
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('This browser gives the page no camera. Open the app in Chrome or Safari.'); return }
    // Asked plainer each time: some phones refuse the 1080p back-camera request but give a camera when asked simply.
    const asks: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ]
    const open = async () => {
      let last: unknown = null
      for (const ask of asks) {
        try { return await navigator.mediaDevices.getUserMedia(ask) } catch (e) {
          last = e
          // A refusal is the same however it is asked.
          if ((e as DOMException)?.name === 'NotAllowedError' || (e as DOMException)?.name === 'SecurityError') break
        }
      }
      throw last
    }
    open()
      .then(s => {
        if (gone) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; void video.current.play().then(() => setLive(true)) }
      })
      .catch((e: unknown) => {
        if (gone) return
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') { setAccess('blocked'); return }
        setCamErr(name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError'
            ? 'Another app is using the camera. Close it or stop screen recording, then press Try again.'
            : name === 'NotFoundError' || name === 'DevicesNotFoundError'
              ? 'No camera was found on this phone.'
              : 'The camera did not start. Press Try again.')
      })
    return () => { gone = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [attempt, access])

  useEffect(() => {
    const watch = navigator.geolocation?.watchPosition(
      p => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => setErr(e.code === e.PERMISSION_DENIED ? 'Location is switched off for this page. Allow location in the browser, then try again.' : 'Your location could not be read. Step outside or wait a moment.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
    return () => { if (watch != null) navigator.geolocation.clearWatch(watch) }
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

  // The shutter waits for a close fix, as Start my day does (te_0139; the user, 9 Nov: a ±100 km network guess put a
  // photo 8.8 km away and made a ride of it).
  const exact = !!fix && fix.accuracy <= CLOSE_M
  // A phone or tablet only (te_0147; the user, 10 Nov); the test accounts may try the camera at a desk.
  const desk = onComputer() && !['E6666', 'E7777', 'E8888', 'E9999'].includes((employee?.ecode ?? '').toUpperCase())
  const take = async () => {
    if (!video.current || !fix || !exact || !employee) return
    setBusy('taking'); setErr(null)
    const at = new Date(), here = fix, frame = grab(video.current)
    try {
      const place = await stampPlace(here)
      const blob = await stamp(frame, at, here, place, `${employee.full_name} · ${employee.ecode}`, phone, forDay)
      setShot({ blob, url: URL.createObjectURL(blob), at, fix: here, place })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const use = async () => {
    if (!shot || !employee) return
    setBusy('sending'); setErr(null)
    const p = newPending(shot.blob, employee.id, shot.fix, shot.at, shot.place, forDay)
    const where = { lat: shot.fix.lat, lng: shot.fix.lng, place: shot.place }
    try { await sendPhoto(p); onDone('Photo saved', false, where) }
    catch (e) {
      if ((e as { refused?: boolean }).refused) { setErr((e as Error).message); setBusy(null); return }
      // No signal: it waits on the phone and goes when the phone is back online.
      await queuePhoto(p)
      onDone('No signal. The photo is kept on this phone and goes by itself when the signal is back', true, where)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Close the camera" onClick={onClose}><X className="h-5 w-5" /></button>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${fix ? (fix.accuracy <= 50 ? 'bg-emerald-600/90' : exact ? 'bg-amber-600/90' : 'bg-cyrixRed-600/90') : 'bg-white/15'}`}>
          {exact ? <LocateFixed className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {fix ? (exact ? `Location ±${Math.round(fix.accuracy)} m` : `Finding exact location · ±${fix.accuracy >= 10_000 ? `${Math.round(fix.accuracy / 1000)} km` : `${Math.round(fix.accuracy)} m`}`) : 'Finding location…'}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${shot ? 'invisible' : ''}`} />
        {shot && <img src={shot.url} alt="The visit photo" className="absolute inset-0 h-full w-full object-contain" />}
        {desk && <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-cyrixRed-600 px-4 py-3 text-center text-sm font-semibold">Visit photos are taken on a phone. Open Cyra on your phone</p>}
        {!live && !err && !camErr && !shot && (access === 'ok' || access === 'checking') && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
        {(access === 'blocked' || access === 'ask') && !shot && (
          <div className="absolute inset-0 flex items-end bg-black/50">
            <div role="dialog" aria-modal="true" className="w-full rounded-t-2xl bg-white p-5 text-ink-900">
              {access === 'blocked' ? (
                <>
                  <p className="flex items-center gap-2 text-base font-semibold"><CameraOff className="h-5 w-5 text-cyrixRed-600" /> Camera is off for Travel</p>
                  <ol className="mt-3 space-y-2 text-sm">
                    {cameraSteps().map((step, n) => (
                      <li key={n} className="flex items-start gap-2.5">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800">{n + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <button type="button" className="mt-4 h-11 w-full rounded-xl bg-emerald-700 text-sm font-semibold text-white" onClick={() => { setLive(false); void recheck().then(() => setAttempt(a => a + 1)) }}>I've allowed it · check again</button>
                  <button type="button" className="mt-2 h-11 w-full rounded-xl border border-ink-200 text-sm font-semibold" onClick={onClose}>Later</button>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-base font-semibold"><CameraIcon className="h-5 w-5 text-emerald-700" /> Allow the camera</p>
                  <p className="mt-2 text-sm text-ink-600">The phone will ask once. Choose Allow.</p>
                  <button type="button" className="mt-4 h-11 w-full rounded-xl bg-emerald-700 text-sm font-semibold text-white" onClick={() => setAccess('ok')}>Allow camera</button>
                  <button type="button" className="mt-2 h-11 w-full rounded-xl border border-ink-200 text-sm font-semibold" onClick={onClose}>Later</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {!err && !exact && onlyApproximate(fix) && <p role="alert" className="rounded-lg bg-cyrixRed-600/90 px-3 py-2 text-center text-sm font-medium">{PRECISE_HELP.replace(', then press Try again', '')}</p>}
        {err && <p role="alert" className="rounded-lg bg-cyrixRed-600/90 px-3 py-2 text-center text-xs font-medium">{err}</p>}
        {camErr && !shot && (
          <div role="alert" className="flex items-center gap-2 rounded-lg bg-cyrixRed-600/90 px-3 py-2">
            <p className="flex-1 text-xs font-medium">{camErr}</p>
            <button type="button" onClick={() => { setLive(false); setAttempt(a => a + 1) }} className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-cyrixRed-700">Try again</button>
          </div>
        )}
        {shot ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white/15 font-semibold" disabled={!!busy} onClick={() => setShot(null)}><RotateCcw className="h-4 w-4" /> Retake</button>
            <button type="button" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold" disabled={!!busy} onClick={() => void use()}>
              {busy === 'sending' ? <Spinner /> : <Check className="h-4 w-4" />} Use photo
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button type="button" aria-label="Take the photo" disabled={!live || !exact || desk || !!busy} onClick={() => void take()}
              className="grid h-[72px] w-[72px] place-items-center rounded-full border-4 border-white/80 disabled:opacity-40">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white">{busy === 'taking' && <Spinner />}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
