import { useEffect, useRef, useState } from 'react'
import { Ticket as TicketIcon } from 'lucide-react'
import BillView from '@/components/BillView'
import { Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { uploadReport, type Bill } from '@/lib/claims'

/*
  A service call's ticket looked up in Cyrix BEMP (KPI function bemp-ticket; the user, 10 Nov: "if we type ticket id
  there, automatically the service report should fetch"): once an AP ticket ID, or a PMPT job of Care360's FieldPro (14 Nov), is typed, its hospital, equipment and
  resolved time show under it with its service report as a picture that opens in a pop-up. It replaces the Service
  report upload for these tickets (the user, 10 Nov: "now we dont need option for sr upload button"). AP only for
  now; the test accounts only.
*/
export const TICKET_TEST = new Set(['E6666', 'E7777', 'E8888', 'E9999'])
/** A ticket looked up by itself: Cyrix BEMP's AP tickets (AP143084) and FieldPro's PMPT jobs (PMPT_000023). */
export const BEMP_TICKET = /^(AP\d+|PMPT_\d{6,})$/i

/** Care360's rides are private BEMMP (the user, 14 Nov: "this will be the cost centre"). */
export const isCare360 = (project: string | null | undefined) => /^care\s*360$/i.test((project ?? '').trim())

/** AP's call centres (APBEMP…): their tickets are AP numbers. */
export const isApCentre = (project: string | null | undefined) => /^ap/i.test((project ?? '').trim())

/**
 * The ticket ID made of what was typed, by the ride's call centre (the user, 14 Nov: only the number is typed):
 * Care360 → PMPT_000023; an AP call centre → AP143084 (143084 or ap 143084 typed). Anything else stays as typed.
 */
export function ticketFor(v: string | null | undefined, project: string | null | undefined): string {
  const t = (v ?? '').trim()
  if (isCare360(project)) return pmptOf(t)
  if (isApCentre(project)) { const m = t.match(/^(?:ap[\s_-]*)?(\d+)$/i); return m ? `AP${m[1]}` : t }
  return t
}

/**
 * A ticket that does not belong to the ride's call centre (the user, 14 Nov, a PMPT ticket left on an APBEMP ride):
 * PMPT jobs are Care360's, AP tickets are not. Null when it fits, or when there is no ticket or call centre yet.
 */
export function ticketMismatch(ticket: string | null | undefined, project: string | null | undefined): string | null {
  const id = (ticket ?? '').trim().toUpperCase()
  if (!id || !project?.trim()) return null
  if (/^PMPT_\d+$/.test(id) && !isCare360(project)) return `${id} is a Care360 ticket — this ride is ${project}`
  if (/^AP\d+$/.test(id) && isCare360(project)) return `${id} is an AP ticket — this ride is ${project}`
  return null
}

/**
 * On a Care360 ride the engineer types only the number and the PMPT ID is made of it (the user, 14 Nov: "if eng type
 * 000023 we should add auto pmpt"): 23, 000023, pmpt 23 and PMPT_000023 all become PMPT_000023. Anything else stays.
 */
export function pmptOf(v: string | null | undefined): string {
  const t = (v ?? '').trim()
  const m = t.match(/^(?:pmpt[\s_-]*)?(\d{1,8})$/i)
  return m ? `PMPT_${m[1].padStart(6, '0')}` : t
}

interface Found {
  id: string; status: string | null; hospital: string | null; city: string | null; equipment: string | null; model: string | null
  engineer: string | null; logged: string | null; resolved: string | null; closure: string | null
}

/** "09-11-2026 14:15:41" as the day it is, for setting beside the claim's day. */
const isoOf = (v: string | null) => { const m = v?.match(/^(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
/** "09-11-2026 14:04:48" shown as 09-Nov-2026 14:04 (the user, 10 Nov). */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const when = (v: string) => { const m = v.match(/^(\d{2})-(\d{2})-(\d{4})\s*(\d{2}:\d{2})?/); return m ? `${m[1]}-${MON[Number(m[2]) - 1] ?? m[2]}-${m[3]}${m[4] ? ' ' + m[4] : ''}` : v.slice(0, 16) }
const dayText = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default function TicketLookup({ ticket, day, claimId, project }: {
  ticket: string | null | undefined
  day: string | null | undefined
  /** The ride's call centre: a ticket of another one is shown as such and not looked up. */
  project?: string | null
  /** The claim it is on, so its manager and the Travel Desk may look it up too. */
  claimId?: string
}) {
  const id = (ticket ?? '').trim().toUpperCase()
  const wrong = ticketMismatch(id, project)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The service report from BEMP, shown as a picture to open (the user, 10 Nov: "need that image icon, so on click pop up the sr").
  const [img, setImg] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const asked = useRef('')

  useEffect(() => {
    if (!BEMP_TICKET.test(id) || wrong) { asked.current = ''; return } // cleared or changed: the same ticket typed again is asked again
    if (asked.current === id) return
    const t = setTimeout(async () => {
      asked.current = id
      setBusy(true); setError(null); setFound(null); setImg(null)
      try {
        const { data, error: fe } = await supabase.functions.invoke('bemp-ticket', { body: { ticket: id, claim: claimId } })
        if (fe) {
          let msg = 'The ticket could not be looked up'
          try { msg = (await (fe as { context?: Response }).context?.json())?.error ?? msg } catch { /* keep the plain one */ }
          throw new Error(msg)
        }
        setFound(data.ticket as Found)
        if (data.image) {
          const bin = atob(data.image as string)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const file = new File([bytes], (data.image_name as string) || `${id}.jpg`, { type: (data.image_type as string) || 'image/jpeg' })
          setImg(URL.createObjectURL(file))
        }
      } catch (e) {
        // Only our own words reach the engineer: never an address or another software's error (the user, 14 Nov).
        const m = (e as Error).message ?? ''
        setError(/^Ticket /.test(m) || /^KL tickets|^Not a ticket/.test(m) ? m : 'Ticket look-up did not answer, try again')
      }
      finally { setBusy(false) }
    }, 700)
    return () => clearTimeout(t)
  }, [id, wrong])

  if (wrong) return <p className="mt-1.5 pl-6 text-xs font-semibold text-red-700">{wrong}</p>
  if (!BEMP_TICKET.test(id)) return null
  if (busy) return <p className="mt-1.5 flex items-center gap-1.5 pl-6 text-xs text-sky-700"><Spinner className="h-3.5 w-3.5" />Finding {id}…</p>
  if (error) return <p className="mt-1.5 pl-6 text-xs font-semibold text-red-700">{error}</p>
  if (!found) return null
  const loggedDay = isoOf(found.logged), resolvedDay = isoOf(found.resolved)
  // A visit any day from the day it was logged to the day it was resolved is the ticket's own.
  const before = !!(day && loggedDay && day < loggedDay), after = !!(day && resolvedDay && day > resolvedDay)
  return (
    <div className="mt-1.5 ml-6 flex items-start gap-2.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900 ring-1 ring-sky-200">
      <div className="min-w-0 flex-1">
      <p className="flex items-center gap-1.5 font-semibold"><TicketIcon className="h-3.5 w-3.5 shrink-0" />{found.id} · {found.equipment}{found.model ? ` (${found.model})` : ''}</p>
      <p className="mt-0.5">{found.hospital}{found.city ? `, ${found.city}` : ''}</p>
      {found.logged && <p className="mt-0.5">Logged · {when(found.logged)}</p>}
      <p className="mt-0.5">
        {found.status ? found.status[0].toUpperCase() + found.status.slice(1) : 'Open'}
        {found.resolved && ` · ${when(found.resolved)}`}
        {found.closure === 'otp' && ' · Closed by OTP'}
      </p>
      {found.engineer && <p className="mt-0.5">Assigned · {found.engineer}</p>}
      {before && <p className="mt-0.5 font-semibold text-amber-800">Logged on {dayText(loggedDay!)} — this day is {dayText(day!)}</p>}
      {after && <p className="mt-0.5 font-semibold text-amber-800">Resolved on {dayText(resolvedDay!)} — this day is {dayText(day!)}</p>}
      </div>
      {img && (
        <button type="button" onClick={() => setViewing(true)} aria-label={`Service report of ${found.id}`}
          className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-sky-300 hover:ring-2">
          <img src={img} alt="" className="h-full w-full object-cover" />
        </button>
      )}
      {viewing && img && <BillView url={img} name={`Service report · ${found.id}`} onClose={() => setViewing(false)} />}
    </div>
  )
}

/**
 * On Send: each AP ticket on the claim gets its BEMP service report saved with the claim as its Service report, so
 * the manager and the Travel Desk see what was claimed even if BEMP changes it later (the user, 10 Nov: "save a copy
 * of the report with the claim at the moment the engineer submits it ... ya good"). A ticket that already has one is
 * left alone; one BEMP cannot give is left to the live look-up. Returns the tickets whose copy could not be saved.
 */
export async function copyTicketReports(claimId: string, tickets: Array<{ id: string; ticket_no: string }>, bills: Bill[]): Promise<string[]> {
  const missed: string[] = []
  for (const t of tickets) {
    const id = (t.ticket_no ?? '').trim().toUpperCase()
    if (!BEMP_TICKET.test(id) || bills.some(b => b.owner_id === t.id && b.owner_kind === 'report')) continue
    try {
      const { data, error } = await supabase.functions.invoke('bemp-ticket', { body: { ticket: id, claim: claimId } })
      if (error || !data?.image) { missed.push(id); continue }
      const bin = atob(data.image as string)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await uploadReport(claimId, t.id, new File([bytes], (data.image_name as string) || `${id}.jpg`, { type: (data.image_type as string) || 'image/jpeg' }))
    } catch (e) { if (!/same file/i.test((e as Error).message)) missed.push(id) }
  }
  return missed
}
