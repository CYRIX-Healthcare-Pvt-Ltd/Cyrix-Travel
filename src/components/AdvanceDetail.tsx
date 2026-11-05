import { HandCoins } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { money } from '@/lib/claims'
import { ADVANCE_STATUS, type Advance } from '@/lib/advances'

/*
  One advance in full, on a press of its row (the user, 5 Nov: "on click a basic detailed thing should show"): what was
  asked, where from and to, the cost centre, and each step with who and when — the manager's edit with what changed.
*/
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

export default function AdvanceDetail({ a, onClose }: { a: Advance; onClose: () => void }) {
  const s = ADVANCE_STATUS[a.status]
  const rows: Array<[string, React.ReactNode]> = [
    ['Person', <>{a.name} <span className="text-ink-500">{a.ecode}</span></>],
    ['Amount', <b>{money(a.amount)}</b>],
    ['Purpose', a.purpose],
    ['Reason', a.reason],
    ['From', `${a.base_name ?? 'Home'} · ${a.base_state}`],
    ['To', `${a.dest_name}${a.dest_state && !a.dest_name.includes(a.dest_state) ? ` · ${a.dest_state}` : ''}`],
    ['Project or cost centre', a.cost_centre ?? '—'],
  ]
  const steps: Array<{ when: string; text: React.ReactNode; tone?: string }> = [{ when: a.created_at, text: `Requested by ${a.name}` }]
  if (a.edited_at) steps.push({ when: a.edited_at, text: <>Edited by {a.edited_name ?? 'the manager'}{a.edit_note ? <span className="block text-ink-600">{a.edit_note}</span> : null}</>, tone: 'text-amber-800' })
  if (a.manager_at) steps.push({ when: a.manager_at, text: <>Approved by {a.manager_name}{a.manager_note ? <span className="block text-ink-600">{a.manager_note}</span> : null}</> })
  if (a.desk_at) steps.push({ when: a.desk_at, text: <>Approved by {a.desk_name} · Travel Desk{a.desk_note ? <span className="block text-ink-600">{a.desk_note}</span> : null}</> })
  if (a.declined_at) steps.push({ when: a.declined_at, text: <>Declined by {a.declined_name}<span className="block">{a.decline_note}</span></>, tone: 'text-cyrixRed-700' })
  steps.sort((x, y) => x.when.localeCompare(y.when))
  return (
    <Dialog title={`${a.number} · ${money(a.amount)}`} icon={<HandCoins className="h-5 w-5 text-indigo-600" />} onClose={onClose}>
      <div className="space-y-4">
        <span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span>
        <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-500">{k}</dt>
              <dd className="min-w-0 break-words text-ink-900">{v}</dd>
            </div>
          ))}
          {a.status === 'given' && (
            <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-500">Used</dt>
              <dd className="text-ink-900">{money(a.used)} used · <b>{money(a.left)} left</b></dd>
            </div>
          )}
        </dl>
        <ol className="space-y-2.5 border-l-2 border-ink-200 pl-4">
          {steps.map((st, i) => (
            <li key={i} className={`text-sm ${st.tone ?? 'text-ink-900'}`}>
              {st.text}
              <span className="block text-xs text-ink-500">{at(st.when)}</span>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  )
}
