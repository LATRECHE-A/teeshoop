/**
 * STUB — module A3 replaces this file entirely (see docs/CONTRACTS.md §A3).
 */
import type { Garment3DProps } from '@/lib/types'

export function isWebGLAvailable(): boolean {
  return false
}

export default function Garment3D(props: Garment3DProps) {
  void props
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="panel-title">3D module not built yet</div>
    </div>
  )
}
