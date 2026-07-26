import { useEffect, useState } from 'react'
import type { Design, Side } from '@/lib/types'
import { renderMockup } from '@/lib/renderDesign'
import { useStore } from '@/state/store'

/** Debounced mockup PNG data-url for previews (at the shared preview size). */
export function useMockupUrl(design: Design, side: Side, widthPx = 480): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const previewSize = useStore((s) => s.previewSize)
  useEffect(() => {
    let on = true
    const t = setTimeout(async () => {
      try {
        const canvas = await renderMockup(design, side, widthPx, previewSize)
        if (on) setUrl(canvas.toDataURL('image/png'))
      } catch {
        if (on) setUrl(null)
      }
    }, 60)
    return () => {
      on = false
      clearTimeout(t)
    }
  }, [design, side, widthPx, previewSize])
  return url
}
