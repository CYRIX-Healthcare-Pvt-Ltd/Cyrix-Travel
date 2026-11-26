import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, type ModeCode } from '@/lib/claims'

/*
  A vehicle the grade does not give, approved before it is used (te_0096; the user, 2 Nov): asked from My profile with
  the dates and why, approved by the reporting manager and then the Travel Desk. Approved, the rides in its dates are
  not marked out of policy; the manager can remove it, and the days from then on are again.
*/
export type VehicleMode = Extract<ModeCode, 'car' | 'bike' | 'taxi' | 'flight'>
export interface VehicleApproval {
  id: string; employee_id: string; number: string | null; mode: VehicleMode; label: string
  from_day: string; to_day: string; until: string; reason: string; letter_path: string | null; letter_name: string | null
  status: 'with_manager' | 'with_desk' | 'approved' | 'returned' | 'withdrawn' | 'removed'
  manager_name: string | null; manager_at: string | null; desk_name: string | null; desk_at: string | null
  returned_name: string | null; returned_at: string | null; removed_name: string | null; removed_at: string | null
  note: string | null; created_at: string; name: string; ecode: string
}
export interface MyVehicleApprovals { items: VehicleApproval[]; modes: VehicleMode[]; manager: string | null }
export type InboxVehicle = VehicleApproval & { waiting: boolean; can_remove: boolean }
/** An approved vehicle over a claim's days, as te_claim_vehicles gives it. */
export interface VehicleSpan { mode: string; from_day: string; to_day: string; number: string | null }

export const VA_STATUS: Record<VehicleApproval['status'], { label: string; tone: string }> = {
  with_manager: { label: 'With manager', tone: 'bg-amber-100 text-amber-900' },
  with_desk: { label: 'With Travel Desk', tone: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Approved', tone: 'bg-green-100 text-green-900' },
  returned: { label: 'Sent back', tone: 'bg-cyrixRed-100 text-cyrixRed-900' },
  withdrawn: { label: 'Withdrawn', tone: 'bg-slate-100 text-slate-900' },
  removed: { label: 'Removed', tone: 'bg-slate-100 text-slate-900' },
}

export const useMyVehicles = () => useQuery({ queryKey: ['te_my_vehicle_approvals'], queryFn: () => rpc<MyVehicleApprovals>('te_my_vehicle_approvals') })
export const useVehicleInbox = (enabled = true) => useQuery({ queryKey: ['te_va_inbox'], enabled, queryFn: () => rpc<InboxVehicle[]>('te_va_inbox') })
/** After an approval moves: both lists, and the claims whose rides it marks. */
export function useVehicleRefresh() {
  const qc = useQueryClient()
  return () => Promise.all(['te_my_vehicle_approvals', 'te_va_inbox', 'te_claim'].map(k => qc.invalidateQueries({ queryKey: [k] })))
}
