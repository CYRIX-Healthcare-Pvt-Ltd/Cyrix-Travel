import {
  createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase, SESSION_KEY } from '@/lib/supabase'

/**
 * Who is here. As in every module on app.cyrix.in, the portal owns signing
 * in and its session is already in this page's storage when it opens.
 */

export interface Employee {
  id: string
  ecode: string
  full_name: string
  designation: string | null
  avatar: string | null
}

interface AuthState {
  session: Session | null
  employee: Employee | null
  /** The software administrator: sets the rates. */
  isSwAdmin: boolean
  /** May open the module: given it in SW Admin. */
  hasAccess: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [isSwAdmin, setIsSwAdmin] = useState(false)
  const [hasAccess, setHasAccess] = useState(false)
  const [loading, setLoading] = useState(true)
  /** Whose screen this is, to tell a new person from the same one coming back. */
  const signedInAs = useRef<string | null>(null)

  const load = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setEmployee(null); setIsSwAdmin(false); setHasAccess(false)
      return
    }
    // Filtered to this person explicitly: the employees policy also shows
    // your manager and your reports.
    const [emp, access] = await Promise.all([
      supabase.from('employees').select('id, ecode, full_name, designation, avatar').eq('auth_user_id', uid).maybeSingle(),
      supabase.rpc('travel_has_access'),
    ])
    const me = (emp.data as Employee | null) ?? null
    setEmployee(me)
    setHasAccess(access.data === true)
    if (me) {
      const { data: roles } = await supabase.from('user_roles').select('role').eq('employee_id', me.id)
      setIsSwAdmin((roles ?? []).some(r => r.role === 'sw_admin' || r.role === 'super_admin'))
    } else setIsSwAdmin(false)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      signedInAs.current = data.session?.user.id ?? null
      setSession(data.session)
      await load(data.session?.user.id)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!s) {
        signedInAs.current = null
        qc.clear(); setSession(null); setEmployee(null); setIsSwAdmin(false); setHasAccess(false)
        return
      }
      // The same person, back — the tab came into view, or the camera gave
      // the page back. A trip half-entered must not be thrown away for it.
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && s.user.id === signedInAs.current) {
        setSession(s)
        return
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        signedInAs.current = s.user.id
        setLoading(true)
        // Deferred out of the callback: supabase-js holds a lock while it runs.
        setTimeout(() => {
          void load(s.user.id).finally(() => { setSession(s); setLoading(false) })
        }, 0)
        return
      }
      setSession(s)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [load, qc])

  // Somebody else, or nobody, in another tab on this origin: start again as whoever is there now.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY && e.key !== null) return
      let now: string | null = null
      try {
        const raw = e.key === null ? null : e.newValue
        now = raw ? (JSON.parse(raw)?.user?.id ?? null) : null
      } catch { now = null }
      if (now !== signedInAs.current) window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    qc.clear()
  }, [qc])

  return (
    <AuthContext.Provider value={{ session, employee, isSwAdmin, hasAccess, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
