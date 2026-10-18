import { BadgeCheck, Check, CornerUpLeft, FilePlus2, Hourglass, History as HistoryIcon, PencilLine, Send, Trash2, Undo2, UserMinus, Wallet, type LucideIcon } from 'lucide-react'
import { money, type ClaimData, type HistoryStep } from '@/lib/claims'

/*
  The claim's history (te_0025; the user, 18 Oct: "need a history like revive lab ie when applied,
  when approved, etc"): each step with who and when, the note given, and on the thread between two
  steps how long it took — amber when it was a day or more. While it waits on somebody, the last
  step says who, and for how long so far.
*/
const TONE = {
  slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-700', orange: 'bg-orange-100 text-orange-700',
  green: 'bg-green-100 text-green-700', violet: 'bg-violet-100 text-violet-700', sky: 'bg-sky-100 text-sky-700', teal: 'bg-teal-100 text-teal-700', red: 'bg-cyrixRed-100 text-cyrixRed-700',
} as const
const ON: Record<string, string> = { with_coordinator: ' · on to the coordinator', with_desk: ' · on to the Travel Desk', approved: '' }

function look(e: HistoryStep): { title: string; icon: LucideIcon; tone: keyof typeof TONE; note: string | null } {
  switch (e.action) {
    case 'created': return { title: 'Started claim', icon: FilePlus2, tone: 'slate', note: null }
    case 'submitted': return { title: `Submitted to the manager${e.note ? ` as ${e.note}` : ''}`, icon: Send, tone: 'amber', note: null }
    case 'resubmitted': return { title: 'Submitted again', icon: Send, tone: 'amber', note: null }
    case 'recalled': return { title: 'Recalled to edit', icon: Undo2, tone: 'orange', note: null }
    case 'manager_approved': return { title: `Manager approved${ON[e.to_status ?? ''] ?? ''}`, icon: Check, tone: 'green', note: e.note }
    case 'coordinator_approved': return { title: `Coordinator approved${ON[e.to_status ?? ''] ?? ''}`, icon: Check, tone: 'green', note: e.note }
    case 'desk_approved': return { title: 'Travel Desk approved', icon: BadgeCheck, tone: 'sky', note: e.note }
    case 'paid': return { title: 'Paid', icon: Wallet, tone: 'teal', note: null }
    case 'returned': return { title: 'Sent back', icon: CornerUpLeft, tone: 'red', note: e.note }
    case 'coordinator_removed': return { title: 'Coordinator removed · on to the Travel Desk', icon: UserMinus, tone: 'slate', note: null }
    case 'delete_requested': return { title: 'Asked to delete it', icon: Trash2, tone: 'red', note: e.note }
    case 'delete_refused': return { title: 'Deletion refused · kept', icon: Check, tone: 'slate', note: null }
    case 'delete_withdrawn': return { title: 'Deletion request withdrawn', icon: Undo2, tone: 'slate', note: null }
    case 'adjusted': return { title: 'Changed an amount', icon: PencilLine, tone: 'violet', note: e.note }
    case 'advance': return { title: `Advance set to ${money(Number(e.note ?? 0))}`, icon: Wallet, tone: 'teal', note: null }
    default: return { title: e.action, icon: Check, tone: 'slate', note: e.note }
  }
}

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}
/** "<1m", "9m", "2h 5m", "3d 4h" — as Revive Lab writes a gap. */
function gapLabel(ms: number) {
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
  if (!Number.isFinite(ms) || ms < MIN) return '<1m'
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

export default function History({ data }: { data: ClaimData }) {
  const c = data.claim
  const steps = data.history ?? []
  if (!steps.length) return null
  const waiting = c.status === 'with_manager' ? `Waiting on ${c.manager ?? 'the manager'}`
    : c.status === 'with_coordinator' ? `Waiting on ${c.coordinator ?? 'the coordinator'}`
    : c.status === 'with_desk' ? 'Waiting on the Travel Desk'
    : c.status === 'approved' ? 'Waiting to be paid' : null
  const rows = [...steps.map(e => ({ e, ...look(e) })), ...(waiting ? [{ e: null, title: waiting, icon: Hourglass, tone: 'amber' as const, note: null }] : [])]
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-ink-100 bg-ink-50 px-4 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-700"><HistoryIcon className="h-4 w-4" /></span>
        <h2 className="text-sm font-semibold text-ink-800">History</h2>
      </div>
      <ol className="p-4">
        {rows.map((s, i) => {
          const next = rows[i + 1]
          const gap = next ? Math.max(0, (next.e ? Date.parse(next.e.at) : Date.now()) - Date.parse(s.e!.at)) : null
          const I = s.icon
          return (
            <li key={s.e?.id ?? 'now'} className={`relative flex gap-3 ${next ? 'pb-9' : ''}`}>
              {next && <span aria-hidden className={`absolute bottom-0 left-4 top-8 w-px -translate-x-1/2 ${next.e ? 'bg-ink-200' : 'border-l border-dashed border-amber-300'}`} />}
              {gap !== null && (
                <span aria-hidden className={`absolute left-4 top-[calc(50%+1rem)] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${gap >= 86_400_000 ? 'text-amber-800 ring-amber-300' : 'text-ink-500 ring-ink-200'}`}>
                  {gapLabel(gap)}
                </span>
              )}
              <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONE[s.tone]} ${s.e ? '' : 'ring-2 ring-amber-300 ring-offset-2 ring-offset-surface'}`}><I className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm font-medium text-ink-900">{s.title}</p>
                {s.e && <p className="mt-0.5 text-xs text-ink-500">{when(s.e.at)} · {s.e.actor ?? 'System'}</p>}
                {s.note && <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-ink-50 px-2.5 py-1.5 text-sm text-ink-700">{s.note}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
