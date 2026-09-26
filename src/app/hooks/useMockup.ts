import { useEffect, useState } from 'react'
import type { Design, Side, SizeId } from '@/lib/types'
import { renderMockup } from '@/lib/renderDesign'
import { useStore } from '@/state/store'

/**
 * Debounced mockup PNG data-url for previews, at the shared preview size unless
 * a `size` is given: a basket line is drawn at ITS size (STU-09), not at the
 * studio's, or a 3XL line showed an S garment graded for S.
 */
export function useMockupUrl(design: Design, side: Side, widthPx = 480, size?: SizeId): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const shared = useStore((s) => s.previewSize)
  const previewSize = size ?? shared
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
