import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Copy, FileText, Paperclip, Sparkles, TriangleAlert, X } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { billUrl, inkVars, readBill, uploadBill, money, type Bill, type ModeCode } from '@/lib/claims'
import type { HotelStay, TicketRoute } from '@/lib/ticket'
import { supabase } from '@/lib/supabase'
import BillView from '@/components/BillView'
import { useAsk } from '@/components/Ask'

/*
  The bills on one ride, hotel night or expense. Attaching reads the amount off a photo with the
  free reader in the phone (the user, 17 Oct) and hands it back to fill the amount; the same file
  twice is refused, naming the claim it was used on; a look-alike is flagged for the approvers.

  Where a bill fills the amount, the paperclip wears a small spark (the user, 26 Oct: management wants people to know
  attaching a bill fills it in). On a phone the paperclip offers the camera as well as a file ("on click attachment in
  mobile they should have option to scan bill also").
*/
export default function BillButton({ claimId, kind, ownerId, bills, needed, editable, onRead, onTicket, onStay, onMode, onSameTicket, onChange, compact = false, large = false, claimed, part = 'both', accent, fills = false }: {
  /** A bill attached here fills the amount: a fare, a hotel night or an expense — not a bike or car ride's km. */
  fills?: boolean
  /** Where a ticket goes, and a voucher's hotel, read off it (the user, 21 Oct). */
  onTicket?: (route: TicketRoute, mode: ModeCode | null, refs: string[]) => void
  onStay?: (stay: HotelStay) => void
  /** The mode a ticket shows it is — a MakeMyTrip booking id says flight, train or bus (the user, 22 Oct). */
  onMode?: (mode: ModeCode) => void
  /** In the day form: link this ride as a ticket's return there and then; true when it was (te_0059). */
  onSameTicket?: (refs: string[]) => boolean
  /** Only the paperclip, or only the bills (the day form shows the bills on their own line). */
  part?: 'both' | 'attach' | 'bills'
  /** The colour a needed bill's paperclip wears: a ride's mode, instead of amber. */
  accent?: { color: string; onDark: string }
  /** The amount claimed, to set against what the bill reads (the user, 18 Oct). */
  claimed?: number | null
  compact?: boolean
  /** Thumb-sized, for the day form on a phone. */
  large?: boolean
  claimId: string
  kind: Bill['owner_kind']
  ownerId: string
  bills: Bill[]
  needed: boolean
  editable: boolean
  /** The amount read, and the mode the ticket shows — set first, so a fare fills on a ride that was a bike. */
  onRead?: (amount: number, mode: ModeCode | null) => void
  onChange: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement & HTMLSpanElement>(null)
  const menuBox = useRef<HTMLSpanElement>(null)
  /*
    On a phone: Scan bill or Choose file, under the button pressed, on the side with room — over the page, so the card
    the paperclip sits in does not cut it off; pinned to the page, it scrolls with the paperclip.
  */
  const [menu, setMenu] = useState<{ top: number; left?: number; right?: number } | null>(null)
  // The spark's bubble opens toward the side with room: a card cuts off what sticks out of it. A mouse's only: a tap shows none.
  const [tipRight, setTipRight] = useState(false)
  const [tip, setTip] = useState<'clip' | 'spark' | null>(null)
  const attach = (e: React.MouseEvent<HTMLElement>) => {
    if (!window.matchMedia('(pointer: coarse)').matches) { input.current?.click(); return }
    const r = e.currentTarget.getBoundingClientRect()
    const top = r.bottom + window.scrollY + 6
    setMenu(m => (m ? null : r.left > window.innerWidth / 2 ? { top, right: document.documentElement.clientWidth - r.right } : { top, left: r.left + window.scrollX }))
  }
  useEffect(() => {
    if (!menu) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !menuBox.current?.contains(e.target as Node)) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) } }
    document.addEventListener('pointerdown', away); window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc, true) }
  }, [menu])
  const ask = useAsk()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const mine = bills.filter(b => b.owner_id === ownerId)
  const sparked = fills && !mine.length && !busy

  const pick = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    try {
      setBusy('Reading the bill…')
      const read = await readBill(f).catch(() => ({ amount: null, date: null, billno: null, refs: [] as string[], route: null, stay: null }))
      // A hotel's bill on a ride is the wrong line (the user, 22 Oct): said, and not attached.
      // Only a hotel's own signs: its night-stay line or an NH booking id; a 'Booking Voucher' heading alone is on bus and train vouchers too.
      if (kind === 'ride' && (read.stay?.name || read.refs.some(x => x.toUpperCase().startsWith('NH')))) {
        throw new Error('This is a hotel bill. Attach it under Hotel night, not on a ride.')
      }
      /*
        The ticket already on an earlier flight of this claim, whose return this ride is: linked, not refused as the
        same bill (te_0059; the user, 22 Oct) — in the form at once, on the claim page through the server.
      */
      const booking = read.refs.filter(x => /^N[A-Z]/.test(x))
      if (kind === 'ride' && booking.length) {
        if (onSameTicket ? onSameTicket(booking) : false) return
        if (!onSameTicket) {
          const { data: day } = await supabase.rpc('te_link_return', { p_ride: ownerId, p_refs: booking })
          if (day) { onChange(); void ask.alert('Linked to your ticket', `This is the return on your ${day} ticket. It claims ₹0 and needs no bill of its own.`); return }
        }
      }
      setBusy('Attaching…')
      await uploadBill(claimId, kind, ownerId, f, read)
      // Filled only once the bill is in: one already added is refused, and fills nothing.
      const mode = modeOfBill(read.refs, read.route ?? null)
      if (mode && onMode) onMode(mode)
      if (read.amount && onRead) onRead(read.amount, mode)
      if (read.route && onTicket) onTicket(read.route, mode, read.refs)
      if (read.stay && onStay) onStay(read.stay)
      onChange()
    } catch (e) { setErr((e as Error).message); if (compact) void ask.alert('Bill not attached', (e as Error).message) } finally { setBusy(null) }
  }
  // Opened in the app, never in another tab (the user, 17 Oct).
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)
  const open = async (b: Bill) => { const u = await billUrl(b.path); if (u) setViewing({ url: u, name: b.name ?? 'Bill' }) }
  const viewer = viewing && <BillView url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />
  const remove = async (b: Bill) => {
    // Until the claim goes to the manager (the user, 22 Oct); the server refuses after.
    if (compact && !(await ask.confirm({ title: 'Remove this bill?', body: `${b.name ?? 'The bill'} comes off this line.`, yes: 'Remove', danger: true }))) return
    const { data: path, error } = await supabase.rpc('te_remove_bill', { p_bill: b.id })
    if (error) { setErr(error.message); return }
    if (path) await supabase.storage.from('te-bills').remove([path as string])
    onChange()
  }

  // On a line of figures the clip comes first, so the clips stand in one column (the user, 19 Oct).
  const clip = editable && part !== 'bills' && (
    <button type="button" disabled={!!busy} onClick={attach} title={sparked ? undefined : busy ?? (needed ? 'Bill needed' : 'Attach bill')} aria-label="Attach bill" aria-expanded={menu ? true : undefined}
      onPointerEnter={e => { if (e.pointerType !== 'mouse') return; const b = root.current?.getBoundingClientRect(); setTipRight(!!b && b.left > window.innerWidth / 2); setTip('clip') }}
      onPointerLeave={() => setTip(null)} onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setTip('clip') }} onBlur={() => setTip(null)}
      style={needed && !mine.length && accent ? { borderColor: accent.color + '99', background: accent.color + '14', ...inkVars(accent) } : undefined}
      className={`btn-lift relative grid ${large ? 'h-10 w-10 rounded-lg' : 'h-7 w-7 rounded-md'} shrink-0 place-items-center border ${needed && !mine.length ? (accent ? 'mode-ink' : 'border-amber-400 bg-amber-50 text-amber-700') : 'border-ink-200 text-ink-500 hover:bg-ink-100'}`}>
      {busy ? <Spinner className="h-3 w-3" /> : <Paperclip className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
      {sparked && (
        <>
          <span className="absolute -right-2 -top-2 grid h-4 w-4 place-items-center rounded-full bg-surface" onPointerEnter={e => { if (e.pointerType === 'mouse') setTip('spark') }} onPointerLeave={e => { if (e.pointerType === 'mouse') setTip('clip') }}>
            <Sparkles className="bill-spark h-3 w-3 text-violet-700" />
          </span>
          {/* The paperclip says Attach bill; only the spark says what it means ("on hover on spark, say it can read automatically"). */}
          <span role="tooltip" className={`pointer-events-none absolute bottom-full z-30 mb-2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-surface transition duration-200 ${tip ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'} ${tipRight ? 'right-0' : 'left-0'}`}>
            {tip === 'spark' ? <><Sparkles className="mr-1 inline h-3 w-3 align-[-2px]" />Reads the amount from the bill automatically</> : 'Attach bill'}
          </span>
        </>
      )}
    </button>
  )
  const pickers = (
    <>
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      {menu && createPortal(
        <span ref={menuBox} style={{ top: menu.top, left: menu.left, right: menu.right }} className="absolute z-[70] flex w-44 flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface py-1 shadow-lg">
          <button type="button" className="flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink-900 hover:bg-ink-100" onClick={() => { setMenu(null); camera.current?.click() }}><Camera className="h-4 w-4 text-violet-700" /> Scan bill</button>
          <button type="button" className="flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink-900 hover:bg-ink-100" onClick={() => { setMenu(null); input.current?.click() }}><FileText className="h-4 w-4 text-ink-500" /> Choose file</button>
        </span>,
        document.body,
      )}
    </>
  )
  if (compact) return (
    <span ref={root} className="relative inline-flex items-center gap-1">
      {!large && clip}
      {/* Each bill says what it reads (the user, 18 Oct: "the approver should see easily that this is the
          amount fetched"): green when it matches the claim, amber with a mark when it does not. */}
      {part !== 'attach' && mine.map(b => {
        const read = b.ocr_amount != null ? Number(b.ocr_amount) : null
        const off = read != null && claimed != null && Math.abs(read - claimed) > 1
        return (
          <span key={b.id} className="inline-flex items-center">
          <button type="button" onClick={() => void open(b)}
            title={b.twin ? `Looks like ${b.twin}` : off ? `The bill reads ${money(read)} · claimed ${money(claimed)}` : read != null ? `The bill reads ${money(read)}` : 'Bill · the amount could not be read'}
            className={`btn-lift inline-flex shrink-0 items-center gap-1 font-semibold ${large ? 'h-10 rounded-lg px-2.5 text-sm' : 'h-7 rounded-md px-2 text-xs'} ${b.twin ? 'bg-cyrixRed-100 text-cyrixRed-800 hover:bg-cyrixRed-200' : off ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400 hover:bg-amber-200' : 'bg-green-100 text-green-800 hover:bg-green-200'}`}>
            <FileText className="h-3.5 w-3.5" />{read != null ? money(read) : 'Bill'}{off && <TriangleAlert className="h-3.5 w-3.5" />}
          </button>
          {editable && (
            <button type="button" onClick={() => void remove(b)} title="Remove this bill" aria-label="Remove this bill"
              className={`btn-press -ml-1 grid ${large ? 'h-10 w-8' : 'h-7 w-6'} place-items-center rounded-r-md text-ink-400 hover:bg-cyrixRed-100 hover:text-cyrixRed-700`}><X className="h-3.5 w-3.5" /></button>
          )}
          </span>
        )
      })}
      {large && clip}
      {editable && part !== 'bills' && !large && needed && !mine.length && !busy && (
        <button type="button" onClick={attach} className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md bg-cyrixRed-100 px-2 text-xs font-semibold text-cyrixRed-800 hover:bg-cyrixRed-200">Bill needed</button>
      )}
      {!editable && needed && !mine.length && <span className="text-xs text-amber-700">No bill</span>}
      {pickers}
      {err && <span className="text-xs font-bold text-cyrixRed-700" title={err}>!</span>}
      {viewer}
    </span>
  )
  return (
    <div ref={root} className="relative flex flex-wrap items-center gap-1.5">
      {mine.map(b => (
        <span key={b.id} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${b.twin ? 'bg-cyrixRed-100 text-cyrixRed-900' : 'bg-green-100 text-green-900'}`}>
          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => void open(b)} title={b.name ?? 'Bill'}>
            <FileText className="h-3.5 w-3.5" /> Bill{b.ocr_amount ? ` · ${money(b.ocr_amount)}` : ''}
          </button>
          {b.twin && <span className="inline-flex items-center gap-0.5 font-semibold"><Copy className="h-3 w-3" /> Looks like {b.twin}</span>}
          {editable && <button type="button" onClick={() => void remove(b)} aria-label="Remove bill" className="ml-0.5 opacity-70 hover:opacity-100"><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {editable && (
        <>
          <button type="button" disabled={!!busy} onClick={attach}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${needed && !mine.length ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}>
            {busy ? <Spinner className="h-3 w-3" /> : <Paperclip className="h-3.5 w-3.5" />}
            {busy ?? (mine.length ? 'Another bill' : needed ? 'Bill needed' : 'Attach bill')}
          </button>
          {pickers}
        </>
      )}
      {!editable && needed && !mine.length && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No bill</span>}
      {err && <span className="w-full text-xs text-cyrixRed-700">{err}</span>}
      {viewer}
    </div>
  )
}

/** A booking id's first letters say what was booked (MakeMyTrip: NF flight, NR train, NU bus); else an airport says flight. */
function modeOfBill(refs: string[], route: TicketRoute | null): ModeCode | null {
  for (const ref of refs) {
    const k = ref.slice(0, 2).toUpperCase()
    if (k === 'NF') return 'flight'
    if (k === 'NR') return 'train'
    if (k === 'NU') return 'bus'
  }
  return route?.airportFrom || route?.airportTo ? 'flight' : null
}
