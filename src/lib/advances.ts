import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/claims'

/*
  Expense advances (te_0063; the user, 24 Oct, under HR's rules): asked for out-of-state travel, approved by the
  reporting manager and then the Travel Desk, and taken off the person's claims from that month on until used up.
*/
export interface Advance {
  id: string; number: string; amount: number; purpose: string; reason: string; cost_centre: string | null
  base_name: string | null; base_state: string; dest_name: string; dest_state: string; month: string
  status: 'with_manager' | 'with_desk' | 'given' | 'declined' | 'cancelled'
  manager_at: string | null; manager_note: string | null; manager_name: string | null
  desk_at: string | null; desk_note: string | null; desk_name: string | null
  declined_at: string | null; decline_note: string | null; declined_name: string | null
  created_at: string; name: string; ecode: string
  /** Taken by claims sent or paid; what is left, once given. */
  used: number; left: number | null
  uses: Array<{ claim_id: string; number: string | null; month: string; part: number; amount: number; paid: boolean }>
}
export interface MyAdvances {
  advances: Advance[]
  month: { count: number; amount: number; max_count: number; max_amount: number }
  /** Why another cannot be asked for now (HR's rules 4 and 5), or null. */
  blocked: string | null
  manager: string | null
  cost_centre: string | null
  home: { lat: number; lng: number } | null
}
export type InboxAdvance = Advance & { waiting: boolean; month_count: number; month_amount: number }

export const ADVANCE_STATUS: Record<Advance['status'], { label: string; tone: string }> = {
  with_manager: { label: 'With manager', tone: 'bg-amber-100 text-amber-900' },
  with_desk: { label: 'With Travel Desk', tone: 'bg-sky-100 text-sky-900' },
  given: { label: 'Approved', tone: 'bg-green-100 text-green-900' },
  declined: { label: 'Declined', tone: 'bg-cyrixRed-100 text-cyrixRed-900' },
  cancelled: { label: 'Withdrawn', tone: 'bg-slate-100 text-slate-900' },
}

export const useMyAdvances = () => useQuery({ queryKey: ['te_my_advances'], queryFn: () => rpc<MyAdvances>('te_my_advances') })
export const useAdvanceInbox = (enabled = true) => useQuery({
  queryKey: ['te_advance_inbox'], enabled,
  queryFn: () => rpc<InboxAdvance[]>('te_advance_inbox'),
})
/** After an advance moves: both lists, and the claims whose deductions it changes. */
export function useAdvanceRefresh() {
  const qc = useQueryClient()
  return () => Promise.all(['te_my_advances', 'te_advance_inbox', 'te_claim'].map(k => qc.invalidateQueries({ queryKey: [k] })))
}
export const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
