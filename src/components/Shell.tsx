import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { ClipboardCheck, Grid2x2, IndianRupee, LogOut, Navigation, ReceiptText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTrips } from '@/lib/travel'
import { TONE_TEXT, type Tone } from '@/lib/tones'
import { Logo } from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import Avatar from '@/components/Avatar'

/**
 * The frame every Travel Expense screen sits in — KPI's header, part for
 * part, as in every module: the chrome is common and only the tabs differ.
 */
export default function Shell() {
  const { employee, isSwAdmin, signOut } = useAuth()
  const { data: trips } = useTrips()
  // Claims of other people's that wait on this person's decision.
  const waiting = (trips ?? []).filter(t => t.can_decide && t.status === 'submitted').length
  const manages = (trips ?? []).some(t => t.can_decide)

  const items: Array<{ to: string; label: string; short: string; icon: typeof Navigation; tone: Tone; end?: boolean; badge?: number }> = [
    { to: '/', label: 'Trip', short: 'Trip', icon: Navigation, tone: 'sky', end: true },
    { to: '/claims', label: 'My claims', short: 'Claims', icon: ReceiptText, tone: 'amber' },
    ...(manages || isSwAdmin ? [{ to: '/approvals', label: 'Approvals', short: 'Approve', icon: ClipboardCheck, tone: 'green' as Tone, badge: waiting }] : []),
    ...(isSwAdmin ? [{ to: '/rates', label: 'Rates', short: 'Rates', icon: IndianRupee, tone: 'violet' as Tone }] : []),
  ]

  const handleSignOut = async () => {
    await signOut()
    // The portal owns the session: the way back is its door.
    window.location.assign('/')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:h-16">
          <a href="/" className="btn-press flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-1" aria-label="All Cyrix modules" title="All Cyrix modules">
            <Logo className="h-9 sm:h-11" />
          </a>
          <div className="relative ml-6 hidden min-w-0 flex-1 lg:block">
            <nav className="nav-scroll flex items-center gap-1 overflow-x-auto">
              {items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                  <item.icon className={clsx('h-4 w-4', TONE_TEXT[item.tone])} />
                  {item.label}
                  <Badge count={item.badge} />
                </NavLink>
              ))}
              <a href="/" className="nav-link" title="All Cyrix modules">
                <Grid2x2 className="h-4 w-4 text-ink-400" />
                Modules
              </a>
            </nav>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* The name is the way to what is this person's own here: their home and their saved places. */}
            <NavLink to="/places" className="nav-profile flex items-center gap-3 rounded-lg py-1 pl-2 pr-1" aria-label="My places" title="My places">
              <span className="hidden text-right lg:block">
                <span className="block text-sm font-medium leading-tight text-ink-900">{employee?.full_name}</span>
                <span className="block text-xs leading-tight text-ink-500">{employee?.ecode}</span>
              </span>
              <Avatar name={employee?.full_name} src={employee?.avatar} size="header" />
            </NavLink>
            <ThemeToggle />
            <button onClick={handleSignOut} className="btn-icon" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4.5 w-4.5 text-cyrixRed-600" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-28 lg:pb-6">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-surface lg:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'relative flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                isActive ? 'text-[color:var(--page-strong)]' : 'text-ink-400',
              )}
            >
              <span className="relative">
                <item.icon className={clsx('h-5 w-5', TONE_TEXT[item.tone])} />
                {!!item.badge && item.badge > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyrixRed-600 px-1 text-[10px] font-bold text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center">{item.short}</span>
            </NavLink>
          ))}
          <a href="/" className="relative flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium text-ink-400 transition-colors">
            <span className="relative"><Grid2x2 className="h-5 w-5" /></span>
            <span className="w-full truncate text-center">Modules</span>
          </a>
        </div>
      </nav>
    </div>
  )
}

/** Red because a badge here always means somebody is waiting on you. */
function Badge({ count }: { count?: number }) {
  if (!count || count <= 0) return null
  return (
    <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyrixRed-600 px-1.5 text-[11px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}
