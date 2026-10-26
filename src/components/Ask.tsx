import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle, Info, type LucideIcon } from 'lucide-react'
import Dialog from '@/components/Dialog'

/*
  The app's own pop-ups in place of the browser's "app.cyrix.in says" boxes (the user, 17 Oct:
  "need in app popup"): a yes/no question, a question with a typed answer, and a message.
  const ask = useAsk(); if (await ask.confirm({ title, body, danger: true })) …

  Centred, with a large soft badge whose colour says what kind it is, and two equal buttons for the thumb
  (the user, 26 Oct: "Can you make that pop up more beautiful?"). A claim sent or approved draws its tick.
*/
type Tone = 'info' | 'success' | 'warn'
type Confirm = { title: string; body?: string; yes?: string; no?: string; danger?: boolean; icon?: LucideIcon; go?: boolean }
type Prompt = { title: string; body?: string; label?: string; placeholder?: string; yes?: string; required?: boolean }
type Open =
  | { kind: 'confirm'; opts: Confirm; done: (v: boolean) => void }
  | { kind: 'prompt'; opts: Prompt; done: (v: string | null) => void }
  | { kind: 'alert'; opts: { title: string; body?: string; tone: Tone }; done: () => void }

interface AskApi {
  confirm: (o: Confirm) => Promise<boolean>
  prompt: (o: Prompt) => Promise<string | null>
  alert: (title: string, body?: string, tone?: Tone) => Promise<void>
}
const Ctx = createContext<AskApi | null>(null)

const BADGE = {
  ask: 'bg-violet-100 text-violet-600 ring-violet-50',
  danger: 'bg-cyrixRed-100 text-cyrixRed-600 ring-cyrixRed-50',
  info: 'bg-sky-100 text-sky-600 ring-sky-50',
  warn: 'bg-amber-100 text-amber-600 ring-amber-50',
  success: 'bg-emerald-100 text-emerald-600 ring-emerald-50',
}

export function AskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const [text, setText] = useState('')
  const queue = useRef<Open[]>([])
  const show = useCallback((o: Open) => { if (open) queue.current.push(o); else { setText(''); setOpen(o) } }, [open])
  const finish = () => { const next = queue.current.shift() ?? null; setText(''); setOpen(next) }
  const api: AskApi = {
    confirm: o => new Promise(res => show({ kind: 'confirm', opts: o, done: res })),
    prompt: o => new Promise(res => show({ kind: 'prompt', opts: o, done: res })),
    alert: (title, body, tone = 'info') => new Promise(res => show({ kind: 'alert', opts: { title, body, tone }, done: res })),
  }
  const cancel = () => {
    if (!open) return
    if (open.kind === 'confirm') open.done(false)
    else if (open.kind === 'prompt') open.done(null)
    else open.done()
    finish()
  }
  const danger = open?.kind === 'confirm' && !!open.opts.danger
  const tone = !open ? 'ask' : open.kind === 'alert' ? open.opts.tone : danger ? 'danger' : 'ask'
  const Icon = open?.kind === 'confirm' && open.opts.icon ? open.opts.icon
    : tone === 'info' ? Info : tone === 'warn' || tone === 'danger' ? AlertTriangle : HelpCircle
  // A list ("• …" lines) reads down the left; a sentence sits centred under the title.
  const list = !!open?.opts.body?.includes('\n')
  return (
    <Ctx.Provider value={api}>
      {children}
      {open && (
        <Dialog title={open.opts.title} onClose={cancel} bare cross={open.kind !== 'alert'}>
          <div className="text-center">
            {/* Every badge pops in, breathes out a ring once and draws its icon (the user, 26 Oct: "show animation like this icons"). */}
            <span className={`ask-badge relative mx-auto grid h-14 w-14 place-items-center rounded-full ring-8 ${BADGE[tone]}`}>
              <span className="ask-burst absolute inset-0 rounded-full bg-current" aria-hidden />
              {tone === 'success' ? (
                <svg viewBox="0 0 24 24" className="relative h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path className="ask-check" d="M20 6 9 17l-5-5" pathLength={1} />
                </svg>
              ) : <Icon className="ask-draw relative h-6 w-6" strokeWidth={2.2} aria-hidden />}
            </span>
            <h2 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">{open.opts.title}</h2>
            {open.opts.body && (list
              ? <p className="mt-3 whitespace-pre-line rounded-2xl bg-ink-50 px-4 py-3 text-left text-[15px] leading-relaxed text-ink-700 sm:text-sm">{open.opts.body}</p>
              : <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-ink-600 sm:text-sm">{open.opts.body}</p>)}
          </div>
          {open.kind === 'prompt' && (
            <label className="mt-4 block">
              {open.opts.label && <span className="label">{open.opts.label}</span>}
              <textarea rows={3} className="input mt-1" autoFocus value={text} placeholder={open.opts.placeholder} onChange={e => setText(e.target.value)} />
            </label>
          )}
          <div className={`mt-6 grid gap-3 ${open.kind === 'alert' ? '' : 'grid-cols-2'}`}>
            {open.kind !== 'alert' && <button type="button" className="btn-secondary h-12 rounded-xl text-[15px]" onClick={cancel}>{(open.kind === 'confirm' && open.opts.no) || 'Cancel'}</button>}
            <button
              type="button"
              className={`h-12 rounded-xl text-[15px] font-semibold ${danger ? 'btn-primary !bg-cyrixRed-600 !text-white hover:!bg-cyrixRed-700' : open.kind === 'confirm' && open.opts.go ? 'btn-primary btn-go' : 'btn-primary'}`}
              disabled={open.kind === 'prompt' && open.opts.required !== false && !text.trim()}
              onClick={() => {
                if (open.kind === 'confirm') open.done(true)
                else if (open.kind === 'prompt') open.done(text.trim())
                else open.done()
                finish()
              }}
            >
              {open.kind === 'alert' ? 'OK' : open.opts.yes ?? 'Yes'}
            </button>
          </div>
        </Dialog>
      )}
    </Ctx.Provider>
  )
}

export function useAsk(): AskApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAsk outside AskProvider')
  return v
}
