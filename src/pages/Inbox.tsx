import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { Alert, PageLoader } from '@/components/ui'
import { STATUS, claimName, dayRange, km, money, useInbox } from '@/lib/claims'

/** Claims waiting on this person — manager, coordinator or Travel Desk — and the ones they passed on. */
export default function Inbox() {
  const { data, isLoading, error } = useInbox()
  const done = (useLocation().state as { done?: string } | null)?.done
  if (isLoading) return <PageLoader />
  const waiting = (data ?? []).filter(c => c.waiting), rest = (data ?? []).filter(c => !c.waiting)
  const Row = ({ c }: { c: NonNullable<typeof data>[number] }) => {
    const s = STATUS[c.status] ?? STATUS.draft
    return (
      // The same grid as My claims: on a phone the person and amount on top, the status under; on a computer fixed columns.
      <Link to={`/claim/${c.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-ink-100/60 sm:grid-cols-[minmax(0,1fr)_11rem_6rem_1rem]">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{c.name} <span className="text-xs text-ink-500">{c.ecode}</span></p>
          <p className="truncate text-xs text-ink-600"><b className="text-ink-900">{c.number}</b> · {claimName(c.month, c.part)} · {dayRange(c.first_day, c.last_day)}{c.days > 1 ? ` · ${c.days} days` : ''}{c.km > 0 ? ` · ${km(c.km)}` : ''}</p>
        </div>
        <span className="text-right text-base font-semibold text-ink-900 sm:order-3">{money(c.total)}</span>
        <span className="justify-self-start sm:order-2"><span className={`badge whitespace-nowrap ${s.tone}`}>{s.label}</span></span>
        <ChevronRight className="h-4 w-4 justify-self-end text-ink-400 sm:order-4" />
      </Link>
    )
  }
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900"><ClipboardCheck className="h-5 w-5 text-green-600" /> Approvals</h1>
      {done && <Alert kind="success">{done}</Alert>}
      {error && <Alert kind="error">{(error as Error).message}</Alert>}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-700">Waiting on you · {waiting.length}</h2>
        {waiting.length ? <div className="card divide-y divide-ink-100 overflow-hidden">{waiting.map(c => <Row key={c.id} c={c} />)}</div>
          : <div className="card p-6 text-center text-sm text-ink-500">Nothing waiting on you.</div>}
      </section>
      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-700">Your team's other claims</h2>
          <div className="card divide-y divide-ink-100 overflow-hidden">{rest.map(c => <Row key={c.id} c={c} />)}</div>
        </section>
      )}
    </div>
  )
}
