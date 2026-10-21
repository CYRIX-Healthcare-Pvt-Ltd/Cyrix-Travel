import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle, Info } from 'lucide-react'
import Dialog from '@/components/Dialog'

/*
  The app's own pop-ups in place of the browser's "app.cyrix.in says" boxes (the user, 17 Oct:
  "need in app popup"): a yes/no question, a question with a typed answer, and a message.
  const ask = useAsk(); if (await ask.confirm({ title, body, danger: true })) …
*/
type Confirm = { title: string; body?: string; yes?: string; no?: string; danger?: boolean }
type Prompt = { title: string; body?: string; label?: string; placeholder?: string; yes?: string; required?: boolean }
type Open =
  | { kind: 'confirm'; opts: Confirm; done: (v: boolean) => void }
  | { kind: 'prompt'; opts: Prompt; done: (v: string | null) => void }
  | { kind: 'alert'; opts: { title: string; body?: string }; done: () => void }

interface AskApi {
  confirm: (o: Confirm) => Promise<boolean>
  prompt: (o: Prompt) => Promise<string | null>
  alert: (title: string, body?: string) => Promise<void>
}
const Ctx = createContext<AskApi | null>(null)

export function AskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const [text, setText] = useState('')
  const queue = useRef<Open[]>([])
  const show = useCallback((o: Open) => { if (open) queue.current.push(o); else { setText(''); setOpen(o) } }, [open])
  const finish = () => { const next = queue.current.shift() ?? null; setText(''); setOpen(next) }
  const api: AskApi = {
    confirm: o => new Promise(res => show({ kind: 'confirm', opts: o, done: res })),
    prompt: o => new Promise(res => show({ kind: 'prompt', opts: o, done: res })),
    alert: (title, body) => new Promise(res => show({ kind: 'alert', opts: { title, body }, done: res })),
  }
  const cancel = () => {
    if (!open) return
    if (open.kind === 'confirm') open.done(false)
    else if (open.kind === 'prompt') open.done(null)
    else open.done()
    finish()
  }
  return (
    <Ctx.Provider value={api}>
      {children}
      {open && (
        <Dialog
          title={open.opts.title}
          onClose={cancel}
          icon={open.kind === 'alert' ? <Info className="h-5 w-5 text-sky-600" />
            : open.kind === 'confirm' && open.opts.danger ? <AlertTriangle className="h-5 w-5 text-cyrixRed-600" />
            : <HelpCircle className="h-5 w-5 text-violet-600" />}
        >
          <div className="mt-3 space-y-4">
            {open.opts.body && <p className="whitespace-pre-line text-sm text-ink-700">{open.opts.body}</p>}
            {open.kind === 'prompt' && (
              <label className="block">
                {open.opts.label && <span className="label">{open.opts.label}</span>}
                <textarea rows={3} className="input mt-1" autoFocus value={text} placeholder={open.opts.placeholder} onChange={e => setText(e.target.value)} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              {open.kind !== 'alert' && <button type="button" className="btn-secondary" onClick={cancel}>{(open.kind === 'confirm' && open.opts.no) || 'Cancel'}</button>}
              <button
                type="button"
                className={open.kind === 'confirm' && open.opts.danger ? 'btn-primary !bg-cyrixRed-600 hover:!bg-cyrixRed-700' : 'btn-primary'}
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
