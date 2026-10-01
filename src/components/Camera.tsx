import { useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, RotateCcw, Check } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { whereAmI, type Point } from '@/lib/geo'

/** A photograph taken here and now, and where the phone was when it was. */
export interface Shot { blob: Blob; at: Point; url: string }

/**
 * The camera, in the page.
 *
 * There is deliberately no way to choose a picture from the phone: a bill
 * or a proof has to be photographed on the spot (the user, 1 Oct: "only
 * camera mode, so he can't manipulate it"). The live picture comes straight
 * from the camera, a press freezes one frame, and the phone's location is
 * read at that same press — a photograph with no location is not accepted.
 */
export default function Camera({ label, onShot, optional = false }: {
  label: string
  onShot: (shot: Shot | null) => void
  /** Photographs are switched off as a requirement (te_0006): one may still be taken, and none is asked for. */
  optional?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setLive(false) }

  const start = async () => {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      stream.current = s
      if (video.current) { video.current.srcObject = s; await video.current.play() }
      setLive(true)
    } catch {
      setError('The camera could not be opened. Allow the camera for this page, then try again.')
    }
  }

  useEffect(() => { void start(); return stop }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const take = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    setBusy(true); setError(null)
    try {
      // The frame first, so what is kept is what was on screen at the press.
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale)
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.8))
      if (!blob) throw new Error('The photograph could not be made. Try again.')
      const at = await whereAmI()
      const next = { blob, at, url: URL.createObjectURL(blob) }
      stop(); setShot(next); onShot(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photograph could not be taken.')
    } finally {
      setBusy(false)
    }
  }

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null); onShot(null); void start()
  }

  return (
    <div className="space-y-2">
      <p className="label !mb-0">{label} {optional ? <span className="font-normal normal-case tracking-normal text-ink-400">— not required for now</span> : <span className="text-cyrixRed-600">*</span>}</p>
      {/* With no camera to open, a required photograph is a dead end and says so; one that is not required only notes it. */}
      {error && (optional
        ? <Alert kind="info">No camera could be opened here. Photographs are not required at the moment, so you can go on without one.</Alert>
        : <Alert kind="error">{error}</Alert>)}
      <div className="relative overflow-hidden rounded-xl border border-ink-200 bg-black">
        {shot
          ? <img src={shot.url} alt={label} className="max-h-72 w-full object-contain" />
          : <video ref={video} playsInline muted className="max-h-72 w-full object-contain" />}
      </div>
      {shot ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700"><Check className="h-4 w-4" /> Taken here, with its location</span>
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={retake}><RotateCcw className="h-4 w-4" /> Take again</button>
        </div>
      ) : (
        <button type="button" className="btn-primary w-full justify-center" onClick={take} disabled={busy || !live}>
          {busy ? <Spinner className="h-4 w-4" /> : <CameraIcon className="h-4 w-4" />} Take photograph
        </button>
      )}
    </div>
  )
}
