import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { Mic, Play, Pause, Square, Trash2 } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { useAsk } from '@/components/Ask'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, friendlyError } from '@/lib/supabase'
import { newId } from '@/lib/claims'

/*
  Feedback by voice (te_0158; management, 13 Nov: "mainly voice, so sw admin can hear and improve"; the user: "max 1
  min", no AI). The 🎙️ in the top bar opens a sheet: press to record, press to stop, listen back, Send. A typed note
  is the other way. The page it was pressed on goes with it. Test accounts first, as every new Travel piece.
*/
export const FEEDBACK_TEST = new Set(['E6666', 'E7777', 'E8888', 'E9999'])
const MAX = 60

/** What this phone records in: Chrome and Android webm, iPhone mp4. */
function pickType() {
  const R = typeof MediaRecorder === 'undefined' ? null : MediaRecorder
  if (!R) return null
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => R.isTypeSupported(t)) ?? ''
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function FeedbackButton() {
  const { employee } = useAuth()
  const [open, setOpen] = useState(false)
  if (!FEEDBACK_TEST.has((employee?.ecode ?? '').toUpperCase())) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-icon" aria-label="Feedback" title="Feedback">
        <Mic className="h-4.5 w-4.5 text-sky-500" />
      </button>
      {open && <FeedbackSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const { employee } = useAuth()
  const ask = useAsk()
  const qc = useQueryClient()
  const where = useLocation().pathname
  // What this person has sent and where it is (the user, 13 Nov: "how user can know he sent a feedback?").
  const { data: mine } = useQuery({
    queryKey: ['te_feedback_mine', employee?.id],
    enabled: !!employee,
    queryFn: async () => {
      const { data } = await supabase.from('te_feedback').select('id, status, seconds, audio_path, note, created_at')
        .eq('employee_id', employee!.id).order('created_at', { ascending: false }).limit(1)
      return (data ?? []) as Array<{ id: string; status: 'new' | 'seen' | 'done'; seconds: number | null; audio_path: string | null; note: string | null; created_at: string }>
    },
  })
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle')
  const [secs, setSecs] = useState(0)
  const [clip, setClip] = useState<{ blob: Blob; url: string; secs: number } | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const tick = useRef<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const started = useRef(0)

  const release = () => {
    if (tick.current) window.clearInterval(tick.current)
    tick.current = null
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }
  useEffect(() => () => { release(); if (rec.current?.state === 'recording') rec.current.stop() }, [])
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url) }, [clip])

  const start = async () => {
    setErr(null)
    const type = pickType()
    if (type === null || !navigator.mediaDevices?.getUserMedia) { setErr('This phone cannot record here — type it instead'); return }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setErr('Allow the microphone for app.cyrix.in, then press again'); return
    }
    const chunks: Blob[] = []
    const r = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined)
    r.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    r.onstop = () => {
      release()
      const s = Math.min(MAX, Math.max(1, Math.round((Date.now() - started.current) / 1000)))
      const blob = new Blob(chunks, { type: (r.mimeType || type || 'audio/webm').split(';')[0] })
      if (blob.size === 0) { setState('idle'); setErr('Nothing was recorded — press again'); return }
      setClip({ blob, url: URL.createObjectURL(blob), secs: s })
      setState('done')
    }
    rec.current = r
    started.current = Date.now()
    setSecs(0)
    r.start()
    setState('rec')
    tick.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000)
      setSecs(Math.min(s, MAX))
      if (s >= MAX && r.state === 'recording') r.stop()
    }, 250)
  }
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop() }
  const drop = () => { audio.current?.pause(); setPlaying(false); setClip(null); setState('idle'); setSecs(0) }
  const play = () => {
    const a = audio.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) } else { void a.play(); setPlaying(true) }
  }

  const send = async () => {
    setErr(null)
    if (state === 'rec') { setErr('Press stop first'); return }
    if (!clip && !note.trim()) { setErr('Record or type something first'); return }
    if (!employee) return
    setBusy(true)
    let path: string | null = null
    try {
      if (clip) {
        const ext = clip.blob.type.includes('mp4') ? 'm4a' : clip.blob.type.includes('ogg') ? 'ogg' : 'webm'
        path = `${employee.id}/${newId()}.${ext}`
        const { error } = await supabase.storage.from('te-feedback').upload(path, clip.blob, { contentType: clip.blob.type })
        if (error) throw new Error(friendlyError(error))
      }
      const { error } = await supabase.rpc('te_feedback_add', {
        p_page: where, p_note: note.trim() || null, p_audio: path, p_seconds: clip?.secs ?? null, p_device: navigator.userAgent,
      })
      if (error) {
        if (path) await supabase.storage.from('te-feedback').remove([path])
        throw new Error(friendlyError(error))
      }
      void qc.invalidateQueries({ queryKey: ['te_feedback_mine'] })
      onClose()
      await ask.alert('Feedback sent ✅', `Thank you, ${employee.full_name.split(' ')[0]}. SW Admin will listen to it.`, 'success')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Feedback" icon={<Mic className="h-5 w-5 text-sky-500" />} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-2 py-2">
          {state !== 'done' ? (
            <button type="button" onClick={state === 'rec' ? stop : () => void start()}
              aria-label={state === 'rec' ? 'Stop' : 'Record'}
              className={clsx('flex h-20 w-20 items-center justify-center rounded-full text-white transition active:scale-95',
                state === 'rec' ? 'animate-pulse bg-cyrixRed-700' : 'bg-cyrixRed-600 hover:bg-cyrixRed-700')}>
              {state === 'rec' ? <Square className="h-8 w-8 fill-current" /> : <Mic className="h-9 w-9" />}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={play} aria-label={playing ? 'Pause' : 'Listen'}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-cyrixRed-600 text-white active:scale-95">
                {playing ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 fill-current" />}
              </button>
              <button type="button" onClick={drop} aria-label="Record again" title="Record again"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200">
                <Trash2 className="h-5 w-5" />
              </button>
              {clip && <audio ref={audio} src={clip.url} onEnded={() => setPlaying(false)} className="hidden" />}
            </div>
          )}
          <span className={clsx('text-sm font-semibold tabular-nums', state === 'rec' ? 'text-cyrixRed-700' : 'text-ink-500')}>
            {state === 'done' && clip ? mmss(clip.secs) : `${mmss(secs)} / ${mmss(MAX)}`}
          </span>
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000}
          placeholder="Type here" className="input w-full resize-none" />
        <div>
          <button type="button" onClick={() => void send()} disabled={busy} className="btn-primary w-full">
            {busy ? 'Sending…' : 'Send'}
          </button>
          {err && <p role="alert" className="mt-2 text-sm font-medium text-cyrixRed-700">{err}</p>}
        </div>
        {!!mine?.length && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Your last feedback</p>
            <ul className="space-y-1.5">
              {mine.map(f => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink-700">
                    {new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {f.audio_path ? `Voice ${mmss(f.seconds ?? 0)}` : (f.note ?? '')}
                  </span>
                  <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                    f.status === 'done' ? 'bg-emerald-100 text-emerald-800' : f.status === 'seen' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800')}>
                    {f.status === 'done' ? 'Done' : f.status === 'seen' ? 'Seen' : 'Sent'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  )
}
