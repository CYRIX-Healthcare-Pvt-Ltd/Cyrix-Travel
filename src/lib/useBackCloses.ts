import { useEffect, useRef } from 'react'

/*
  The phone's or browser's Back closes what is open over the page — the map, a day, the place
  picker, a bill — and leaves the person where they were (the user, 17 Oct: "on click map and then
  clicking back it should land on same page itself"). Opening adds a history step; Back takes it
  away and closes; closing with the cross takes the step back out so history stays even.

  The step is taken out a moment after unmounting, and only if the overlay did not mount again:
  React's development mode mounts everything twice, and an immediate history.back() there closed
  the overlay the instant it opened.
*/
export function useBackCloses(onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  const mark = useRef<number | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    if (mark.current === null) {
      mark.current = Math.random()
      window.history.pushState({ ...(window.history.state ?? {}), overlay: mark.current }, '')
    }
    let popped = false
    const onPop = () => {
      if ((window.history.state as { overlay?: number } | null)?.overlay === mark.current) return
      popped = true; mark.current = null; close.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      mounted.current = false
      window.removeEventListener('popstate', onPop)
      const mine = mark.current
      window.setTimeout(() => {
        if (mounted.current || popped) return
        if ((window.history.state as { overlay?: number } | null)?.overlay === mine) window.history.back()
        mark.current = null
      }, 0)
    }
  }, [])
}
