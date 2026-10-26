import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import { newId, rpc } from '@/lib/claims'

/*
  Deputation (te_0075; the user, 26 Oct): sent to another state for a project for a while — the state, from and to
  dates and the letter, approved by the reporting manager, and any change approved again. Days inside it whose places
  are all in that state take the deputation DA (₹800); a place in another state is a red observation.
*/
export interface Deputation {
  id: string; employee_id: string; state: string; from_day: string; to_day: string
  letter_path: string; letter_name: string | null
  status: 'with_manager' | 'approved' | 'returned' | 'withdrawn' | 'replaced'
  replaces: string | null; was: { state: string; from_day: string; to_day: string } | null
  decided_by: string | null; decided_name: string | null; decided_ecode: string | null; decided_at: string | null; note: string | null
  created_at: string; name: string; ecode: string
}
export interface MyDeputations { items: Deputation[]; manager: string | null; da: number }
export type InboxDeputation = Deputation & { waiting: boolean }
/** An approved deputation over a claim's month, as te_claim gives it. */
export interface DepSpan { state: string; from_day: string; to_day: string }

export const DEP_STATUS: Record<Deputation['status'], { label: string; tone: string }> = {
  with_manager: { label: 'With manager', tone: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Approved', tone: 'bg-green-100 text-green-900' },
  returned: { label: 'Sent back', tone: 'bg-cyrixRed-100 text-cyrixRed-900' },
  withdrawn: { label: 'Withdrawn', tone: 'bg-slate-100 text-slate-900' },
  replaced: { label: 'Changed', tone: 'bg-slate-100 text-slate-900' },
}

/** India's states and union territories, as the map names them. */
export const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]
const bare = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/orissa/, 'odisha').replace(/pondicherry/, 'puducherry').replace(/[^a-z]/g, '')
/** The map's state against the deputation's ("National Capital Territory of Delhi" is Delhi); unknown is not another. */
export function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return true
  const x = bare(a), y = bare(b)
  return x === y || x.includes(y) || y.includes(x)
}

/** The approved deputation a day is inside, or null. */
export const depOn = (spans: DepSpan[] | undefined, day: string) => (spans ?? []).find(s => day >= s.from_day && day <= s.to_day) ?? null

const fmt = (iso: string, year: boolean) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })
/** "1 Nov – 31 Dec 2026", the from date's year said only when it is another. */
export const depRange = (from: string, to: string) => `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to, true)}`
export const depDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1

export const useMyDeputations = () => useQuery({ queryKey: ['te_my_deputations'], queryFn: () => rpc<MyDeputations>('te_my_deputations') })
export const useDepInbox = (enabled = true) => useQuery({ queryKey: ['te_dep_inbox'], enabled, queryFn: () => rpc<InboxDeputation[]>('te_dep_inbox') })
/** After a deputation moves: both lists, and the claims whose DA and tag it changes. */
export function useDepRefresh() {
  const qc = useQueryClient()
  return () => Promise.all(['te_my_deputations', 'te_dep_inbox', 'te_claim', 'te_my_claims', 'te_inbox'].map(k => qc.invalidateQueries({ queryKey: [k] })))
}

/** The letter into the person's own folder of the private bucket; the request records it. */
export async function uploadLetter(employeeId: string, file: File) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const path = `${employeeId}/${newId()}.${ext}`
  const { error } = await supabase.storage.from('te-letters').upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (error) throw new Error(friendlyError(error))
  return path
}
export const dropLetter = (path: string) => supabase.storage.from('te-letters').remove([path]).then(() => undefined, () => undefined)
export async function letterUrl(path: string) {
  const { data } = await supabase.storage.from('te-letters').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}
