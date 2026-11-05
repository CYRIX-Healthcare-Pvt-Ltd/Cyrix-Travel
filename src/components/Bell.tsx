/*
  Travel's own bell (KPI 0250; the user, 5 Nov: "i dont want other modules notiifcation in other modules, better add
  bell for travel module"). Advances, deputations, vehicle requests and changed amounts: whatever opens a Travel page.
  A press opens that page; the cross clears it. Opening the bell marks only Travel's messages read.
*/
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell as BellIcon, CheckCircle2, MessageSquare, X } from 'lucide-react'
import clsx from 'clsx'
import { supabase, friendlyError } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/** The buttons a message names, in bold (the user, 5 Nov: "is there option to highlight end my day?"). */
const PRESS = /(Start my day|End my day)/
const strong = (t: string) => t.split(PRESS).map((part, i) => i % 2 ? <strong key={i} className="font-semibold text-ink-900">{part}</strong> : part)
interface Msg { id: string; title: string; body: string; url: string | null; created_at: string; unread: boolean }
const KEY = ['bell', 'travel']

export default function Bell() {
  const { employee } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  // Which were new when the bell was opened: their dot stays while it is open.
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)

  const { data: msgs = [] } = useQuery({
    queryKey: [...KEY, employee?.id],
    enabled: !!employee?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_app_messages', { p_app: 'travel' })
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as Msg[]
    },
  })
  const unread = msgs.filter(m => m.unread).length
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  const read = useMutation({ mutationFn: async () => { await supabase.rpc('mark_app_messages_read', { p_app: 'travel' }) }, onSuccess: done })
  const clear = useMutation({ mutationFn: async (id: string) => { await supabase.rpc('dismiss_message', { p_id: id }) }, onSuccess: done })

  const toggle = () => {
    if (!open) {
      setFresh(new Set(msgs.filter(m => m.unread).map(m => m.id)))
      if (unread > 0) read.mutate()
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc) }
  }, [open])

  const go = (m: Msg) => {
    setOpen(false)
    if (!m.url) return
    const path = m.url.replace(/^\/travel/, '') || '/'
    nav(path)
  }

  return (
    <div ref={box} className="relative">
      <button onClick={toggle} className="btn-icon relative" aria-label="Notifications" title="Notifications" aria-expanded={open} aria-haspopup="dialog">
        <BellIcon className={clsx('h-4.5 w-4.5', unread > 0 ? 'text-amber-500' : 'text-amber-600')} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyrixRed-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
          className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)_+_3.75rem)] z-40 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h2 className="flex-1 text-sm font-semibold text-ink-800">Notifications</h2>
            <span className="text-xs text-ink-400">{msgs.length === 0 ? 'All clear' : `${msgs.length} ${msgs.length === 1 ? 'item' : 'items'}`}</span>
          </div>
          {msgs.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
              <p className="mt-2 text-sm font-medium text-ink-700">Nothing new</p>
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-y-auto sm:max-h-[26rem]">
              {msgs.map(m => (
                <li key={m.id} className="flex gap-3 px-4 py-3">
                  <button type="button" onClick={() => go(m)} className="flex min-w-0 flex-1 gap-3 text-left">
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-900">{m.title}</span>
                      {m.body && <span className="mt-0.5 block whitespace-pre-line text-xs leading-relaxed text-ink-600">{strong(m.body)}</span>}
                      <span className="mt-1 block text-[11px] text-ink-400">
                        {new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                  </button>
                  <span className="flex w-4 shrink-0 flex-col items-center gap-2">
                    {fresh.has(m.id) && <span className="mt-1.5 block h-2 w-2 rounded-full bg-cyrixRed-600" aria-label="New" />}
                    <button onClick={() => clear.mutate(m.id)} className="text-ink-300 hover:text-ink-600" aria-label="Clear" title="Clear">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
