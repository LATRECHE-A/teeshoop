import { useEffect, useState } from 'react'

/**
 * True below the `md` breakpoint (768px): the phone/desktop divide used by the
 * mobile chrome (bottom nav + slide-up sheets). Reactive to viewport changes.
 */
// 767.98px is the exact complement of Tailwind's `md` (min-width: 768px), so JS
// and the CSS `md:` utilities flip at the same boundary (no 767–768px gap).
export function useIsMobile(query = '(max-width: 767.98px)'): boolean {
  const [match, setMatch] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = matchMedia(query)
    const onChange = () => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    setMatch(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}
