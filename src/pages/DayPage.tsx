import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import DayEditor from '@/components/DayEditor'
import { Alert, PageLoader } from '@/components/ui'
import { useClaim, type Day } from '@/lib/claims'

/*
  A day of the claim on its own page (the user, 17 Oct: "instead of popup form ... make it a page,
  with back button"). The day travels in the history state, so Back and a reload both keep it.
*/
export default function DayPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const loc = useLocation()
  const { data, isLoading, error } = useClaim(id)
  const day = (loc.state as { day?: Day; chosen?: boolean } | null)?.day
  const chosen = !!(loc.state as { chosen?: boolean } | null)?.chosen
  /*
    The calendar's date counts once, when the form opens. Left in the history it came back on a reload over the date
    changed in the form (the user, 28 Oct: picked the 28th, changed it to the 27th, reloaded, the 28th again).
  */
  useEffect(() => {
    if (chosen && day) nav(loc.pathname + loc.search, { replace: true, state: { ...(loc.state as object), chosen: false } })
  }, [chosen]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!day) return <Navigate to={`/claim/${id}`} replace />
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'That claim could not be opened.'}</Alert>
  // The saved copy when the day is already on the claim, so an edit starts from what is stored.
  const initial = data.days.find(x => x.id === day.id) ?? day
  return <DayEditor data={data} initial={initial} chosen={chosen} onClose={() => nav(`/claim/${id}`, { replace: true })} />
}
