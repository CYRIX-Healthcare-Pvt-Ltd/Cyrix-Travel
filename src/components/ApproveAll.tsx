import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, CircleCheck, FolderOpen, type LucideIcon } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { claimIssues } from '@/pages/ClaimPage'
import { money, rpc, type ClaimData } from '@/lib/claims'

type Row = { id: string; number: string | null; name: string; total: number }
type Reason = { title: string; level: 'approve' | 'check'; icon: LucideIcon; n: number }

/*
  Approve all (the user, 23 Oct), in one window: the claims are read, then a summary — how many are ready and
  for how much, how many stay for the manager to open and why, by reason and how many claims — then the result.
  Never claim by claim: "think that there are 100 emp reportees". Out of 5 with 2 out of policy, the 3 are approved.
*/
export default function ApproveAll({ list, onClose }: { list: Row[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<'reading' | 'review' | 'approving' | 'done'>('reading')
  const [read, setRead] = useState(0)
  const [ready, setReady] = useState<Row[]>([])
  const [reasons, setReasons] = useState<Reason[]>([])
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const held = list.length - ready.length

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const out: Array<{ c: Row; issues: ReturnType<typeof claimIssues> }> = []
        // A few at a time, so a hundred claims do not go at once.
        for (let i = 0; i < list.length; i += 6) {
          // From the cache when the Approvals list has already read them.
          out.push(...await Promise.all(list.slice(i, i + 6).map(async c => ({ c, issues: claimIssues(await qc.fetchQuery({ queryKey: ['te_claim', c.id], queryFn: () => rpc<ClaimData>('te_claim', { p_claim: c.id }), staleTime: 60_000 })) }))))
          if (live) setRead(out.length)
        }
        const why = new Map<string, Reason>()
        for (const x of out) for (const t of x.issues) why.set(t.title, { ...t, n: (why.get(t.title)?.n ?? 0) + 1 })
        if (!live) return
        setReady(out.filter(x => !x.issues.length).map(x => x.c))
        setReasons([...why.values()].sort((a, b) => (a.level === b.level ? b.n - a.n : a.level === 'approve' ? -1 : 1)))
        setStep('review')
      } catch (e) { if (live) setErr((e as Error).message) }
    })()
    return () => { live = false }
  }, [list])

  const approve = async () => {
    setStep('approving')
    const bad: string[] = []
    for (const [i, c] of ready.entries()) {
      try { await rpc('te_decide', { p_claim: c.id, p_approve: true, p_note: '' }) } catch (e) { bad.push(`${c.number ?? c.name}: ${(e as Error).message}`) }
      setDone(i + 1)
    }
    setFailed(bad)
    void qc.invalidateQueries({ queryKey: ['te_inbox'] }); void qc.invalidateQueries({ queryKey: ['te_summary'] }); void qc.invalidateQueries({ queryKey: ['te_claim'] })
    setStep('done')
  }

  const total = ready.reduce((t, c) => t + c.total, 0)
  const approved = ready.length - failed.length
  const bar = (n: number, of: number) => (
    <div className="h-2 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${of ? (n / of) * 100 : 0}%` }} /></div>
  )
  // The claims left for the manager, and why: one row a reason, with how many claims have it.
  const heldCard = held > 0 && (
    <div className="overflow-hidden rounded-xl border border-amber-300/70">
      <div className="flex items-center gap-2.5 bg-amber-50 px-3 py-2.5">
        <FolderOpen className="h-5 w-5 shrink-0 text-amber-600" />
        <p className="text-sm font-semibold text-amber-900">{held} {held === 1 ? 'claim stays' : 'claims stay'} for you to open</p>
      </div>
      <ul className="divide-y divide-ink-100">
        {reasons.map(r => { const I = r.icon; return (
          <li key={r.title} className="flex items-center gap-2.5 px-3 py-2 text-sm">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${r.level === 'approve' ? 'bg-cyrixRed-100 text-cyrixRed-700' : 'bg-amber-100 text-amber-700'}`}><I className="h-3.5 w-3.5" /></span>
            <span className="min-w-0 flex-1 text-ink-800">{r.title}</span>
            <span className="tabular-nums font-semibold text-ink-900">{r.n}</span>
          </li>
        ) })}
      </ul>
    </div>
  )

  return (
    <Dialog title="Approve all" icon={<CheckCheck className="h-5 w-5 text-green-600" />} onClose={step === 'approving' ? () => undefined : onClose}>
      {err ? <p className="text-sm text-cyrixRed-700">{err}</p>
        : step === 'reading' ? (
          <div className="space-y-2 py-2">
            <p className="flex items-center gap-2 text-sm text-ink-700"><Spinner className="h-4 w-4" /> Checking {read} of {list.length} claims…</p>
            {bar(read, list.length)}
          </div>
        ) : step === 'approving' ? (
          <div className="space-y-2 py-2">
            <p className="flex items-center gap-2 text-sm text-ink-700"><Spinner className="h-4 w-4" /> Approving {done} of {ready.length}…</p>
            {bar(done, ready.length)}
          </div>
        ) : step === 'review' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-green-50 px-3 py-2.5 ring-1 ring-green-200">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-green-800">Ready to approve</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-green-900">{ready.length}</p>
                <p className="text-xs font-medium tabular-nums text-green-800">{money(total)}</p>
              </div>
              <div className={`rounded-xl px-3 py-2.5 ring-1 ${held ? 'bg-amber-50 ring-amber-200' : 'bg-ink-50 ring-ink-200'}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${held ? 'text-amber-800' : 'text-ink-500'}`}>To open</p>
                <p className={`mt-0.5 text-2xl font-bold tabular-nums ${held ? 'text-amber-900' : 'text-ink-700'}`}>{held}</p>
                <p className={`text-xs font-medium ${held ? 'text-amber-800' : 'text-ink-500'}`}>out of policy or to check</p>
              </div>
            </div>
            {heldCard}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={onClose}>{ready.length ? 'Cancel' : 'Close'}</button>
              {ready.length > 0 && (
                <button type="button" className="btn-primary" onClick={() => void approve()}>
                  <CheckCheck className="h-4 w-4" /> Approve {ready.length} · {money(total)}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-green-50 px-3 py-3 ring-1 ring-green-200">
              <CircleCheck className="h-8 w-8 shrink-0 text-green-600" />
              <div>
                <p className="text-base font-semibold text-green-900">{approved} {approved === 1 ? 'claim' : 'claims'} approved</p>
                <p className="text-xs font-medium tabular-nums text-green-800">{money(ready.filter(c => !failed.some(f => f.startsWith(`${c.number ?? c.name}:`))).reduce((t, c) => t + c.total, 0))}</p>
              </div>
            </div>
            {failed.length > 0 && <p className="text-sm text-cyrixRed-700">{failed.length} could not be approved: {failed.slice(0, 3).join('; ')}{failed.length > 3 ? '…' : ''}</p>}
            {heldCard}
            <div className="flex justify-end pt-1"><button type="button" className="btn-primary" onClick={onClose}>Done</button></div>
          </>
        )}
    </Dialog>
  )
}
