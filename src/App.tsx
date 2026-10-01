import { Suspense, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Grid2x2, LogIn, Navigation } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, ecodeToEmail, friendlyError } from '@/lib/supabase'
import { Alert, PageLoader, Spinner } from '@/components/ui'
import Shell from '@/components/Shell'
import { Logo } from '@/components/Logo'
import { lazyRoute } from '@/lib/lazyRoute'

const Trip   = lazyRoute(() => import('@/pages/Trip'))
const Claims = lazyRoute(() => import('@/pages/Claims'))
const Claim  = lazyRoute(() => import('@/pages/Claim'))
const Rates  = lazyRoute(() => import('@/pages/Rates'))
const Places = lazyRoute(() => import('@/pages/Places'))

export default function App() {
  const { session, loading, hasAccess, isSwAdmin } = useAuth()

  if (loading) return <PageLoader />
  if (!session) return <SignInElsewhere />
  if (!hasAccess) return <NotGiven />

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Trip />} />
          <Route path="claims" element={<Claims />} />
          <Route path="claims/:id" element={<Claim />} />
          <Route path="approvals" element={<Claims team />} />
          <Route path="places" element={<Places />} />
          <Route path="rates" element={isSwAdmin ? <Rates /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo className="h-12" />
      <div className="card w-full max-w-md space-y-3 p-6 text-center">{children}</div>
    </div>
  )
}

/** The one host where the portal and this module share an origin, and so a session. */
const PORTAL_HOST = 'app.cyrix.in'

/**
 * Not signed in.
 *
 * On app.cyrix.in the portal owns signing in for every module, and its
 * session is already in this page's storage the moment somebody signs in
 * there — so this sends people to it rather than keeping a second form.
 *
 * Anywhere else — a developer's localhost, the Vercel domain opened
 * directly — there is no portal on the same origin to borrow a session
 * from, so the same sign-in happens here, against the same project with
 * the same employee codes.
 */
function SignInElsewhere() {
  if (window.location.hostname === PORTAL_HOST) {
    return (
      <Frame>
        <Navigation className="mx-auto h-8 w-8 text-ink-300" />
        <h1 className="text-lg font-semibold text-ink-900">Travel Expense</h1>
        <p className="text-sm text-ink-500">
          Sign in on the Cyrix portal with your employee code, then open Travel Expense from your modules.
        </p>
        <a href="/" className="btn-primary inline-flex">
          <LogIn className="h-4 w-4" /> Go to sign in
        </a>
      </Frame>
    )
  }
  return <SignInHere />
}

function SignInHere() {
  const [ecode, setEcode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: ecodeToEmail(ecode), password,
    })
    setBusy(false)
    if (err) setError(friendlyError(err))
    // On success the auth listener picks the session up and the app renders.
  }

  return (
    <Frame>
      <Navigation className="mx-auto h-8 w-8 text-ink-300" />
      <h1 className="text-lg font-semibold text-ink-900">Travel Expense</h1>
      <p className="text-sm text-ink-500">Sign in with your employee code.</p>
      <form onSubmit={submit} className="space-y-3 text-left">
        {error && <Alert kind="error">{error}</Alert>}
        <label className="block">
          <span className="label">Employee code</span>
          <input className="input mt-1" value={ecode} onChange={e => setEcode(e.target.value)} autoComplete="username" required />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input className="input mt-1" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} Sign in
        </button>
      </form>
    </Frame>
  )
}

function NotGiven() {
  return (
    <Frame>
      <Navigation className="mx-auto h-8 w-8 text-ink-300" />
      <h1 className="text-lg font-semibold text-ink-900">Travel Expense is not on your account yet</h1>
      <p className="text-sm text-ink-500">
        The software administrator gives it to the people who claim travel. Ask them to add it, then come back.
      </p>
      <a href="/" className="btn-secondary inline-flex">
        <Grid2x2 className="h-4 w-4" /> Back to my modules
      </a>
    </Frame>
  )
}
