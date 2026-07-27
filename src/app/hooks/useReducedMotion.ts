import { useEffect, useState } from 'react'

/**
 * True when the OS asks for reduced motion. The board's zoom-to-focus flight
 * and the 3D turntable are exactly the kind of large, unrequested movement this
 * setting exists to suppress, so both consult it.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    setReduced(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
