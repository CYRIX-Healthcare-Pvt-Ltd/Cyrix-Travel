// First of all: storage the browser refuses must not crash the page (lib/safeStorage).
import './lib/safeStorage'
import { startSessionGuard } from './lib/sessionGuard'
import { AskProvider } from '@/components/Ask'
import { startIdleSignOut } from './lib/idleSignOut'
import { supabase } from './lib/supabase'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { startTheme } from '@/lib/theme'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from './App'

/*
  The mouse wheel over a focused number box changes its value — a km of 23.7 became 23.6 by scrolling the page
  (the user, 22 Oct). The box lets go of the focus as the wheel turns, so the page scrolls and the figure stays.
*/
document.addEventListener('wheel', () => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
}, { passive: true })
// Nor the up and down arrow keys (the user, 22 Oct: "arrow keys not needed"): a figure changes only by typing.
document.addEventListener('keydown', e => {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target instanceof HTMLInputElement && e.target.type === 'number') e.preventDefault()
})
import './index.css'

// Before render, so nobody sees a flash of the wrong palette, and so a
// choice made in another module is already in force when this one opens.
startTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A ticket moves when somebody acts on it. Refetch on focus, so a
      // coordinator's acceptance appears for the field engineer without a
      // reload.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

// Signed out within a minute when another device signs everybody out (0149).
startSessionGuard()
// Signed out after 3 hours with nothing done, across every Cyrix app.
startIdleSignOut(supabase)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* The portal owns app.cyrix.in; this app owns /travel beneath it. */}
        <BrowserRouter basename="/travel">
          <AuthProvider>
            <AskProvider>
            <App />
            </AskProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
