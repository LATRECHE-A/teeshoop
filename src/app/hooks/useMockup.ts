import { useEffect, useState } from 'react'
import type { Design, Side } from '@/lib/types'
import { renderMockup } from '@/lib/renderDesign'

/** Debounced mockup PNG data-url for previews. */
export function useMockupUrl(design: Design, side: Side, widthPx = 480): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    const t = setTimeout(async () => {
      try {
        const canvas = await renderMockup(design, side, widthPx)
        if (on) setUrl(canvas.toDataURL('image/png'))
      } catch {
        if (on) setUrl(null)
      }
    }, 60)
    return () => {
      on = false
      clearTimeout(t)
    }
  }, [design, side, widthPx])
  return url
}
