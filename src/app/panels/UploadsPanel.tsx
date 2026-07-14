import { useEffect, useRef, useState } from 'react'
import { CloudUpload, Plus, Scissors, Trash2, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '@/state/store'
import {
  addAsset,
  ensureAssetImage,
  getAssetBlob,
  listAssets,
  removeAsset,
  setAssetCutout,
} from '@/state/assets'
import { isBgRemovalSupported, removeBackground } from '@/lib/bgremove'
import { invalidateCustomBBox } from '@/lib/custom'
import type { AssetMeta } from '@/lib/types'

export function useAssetThumb(id: string): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    ensureAssetImage(id)
      .then((img) => on && setSrc(img.src))
      .catch(() => on && setSrc(null))
    return () => {
      on = false
    }
  }, [id])
  return src
}

export function AssetThumb({ asset, onPick }: { asset: AssetMeta; onPick: () => void }) {
  const src = useAssetThumb(asset.id)
  return (
    <button
      onClick={onPick}
      className="relative aspect-square overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(#1F2630_0%_25%,#181D25_0%_50%)] bg-[length:14px_14px] transition-colors hover:border-cy/60"
      title={`Add “${asset.name}” to the design`}
    >
      {src && <img src={src} alt={asset.name} className="h-full w-full object-contain" draggable={false} />}
    </button>
  )
}

export default function UploadsPanel() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [processing, setProcessing] = useState<Record<string, number>>({})
  const assets = useStore((s) => s.assets)
  const setAssets = useStore((s) => s.setAssets)
  const addImageLayer = useStore((s) => s.addImageLayer)
  const toast = useStore((s) => s.toast)

  const ingest = async (files: FileList | File[]) => {
    let added = 0
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast('warn', `“${file.name}” is not an image`)
        continue
      }
      try {
        await addAsset(file, file.name)
        added++
      } catch {
        toast('error', `Could not read “${file.name}”`)
      }
    }
    if (added > 0) {
      setAssets(await listAssets())
      toast('ok', added === 1 ? 'Added to your library' : `Added ${added} images`)
    }
  }

  // paste support while the panel is open
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (files?.length) void ingest(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cutout = async (asset: AssetMeta) => {
    if (!isBgRemovalSupported()) {
      toast('warn', 'Background removal is not supported in this browser')
      return
    }
    setProcessing((p) => ({ ...p, [asset.id]: 0 }))
    try {
      const blob = await getAssetBlob(asset.id)
      if (!blob) throw new Error('missing')
      const result = await removeBackground(blob, {
        onProgress: (p) => {
          if (p.stage === 'model' && p.pct !== undefined)
            setProcessing((prev) => ({ ...prev, [asset.id]: Math.round(p.pct! * 0.6) }))
          if (p.stage === 'inference') setProcessing((prev) => ({ ...prev, [asset.id]: 75 }))
          if (p.stage === 'compositing') setProcessing((prev) => ({ ...prev, [asset.id]: 92 }))
        },
      })
      setAssets(await setAssetCutout(asset.id, result))
      invalidateCustomBBox(asset.id)
      toast('ok', `Background removed from “${asset.name}”`)
    } catch {
      toast('error', 'Background removal failed — try a different photo')
    } finally {
      setProcessing((p) => {
        const { [asset.id]: _drop, ...rest } = p
        return rest
      })
    }
  }

  const del = async (asset: AssetMeta) => {
    setAssets(await removeAsset(asset.id))
    toast('info', `Removed “${asset.name}” from the library`)
  }

  return (
    <div className="flex flex-col gap-4 p-3.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void ingest(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void ingest(e.dataTransfer.files)
        }}
        className={clsx(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors',
          dragOver ? 'border-cy bg-cy/10' : 'border-line2 bg-bg1 hover:border-cy/50',
        )}
      >
        <CloudUpload size={22} className="text-cy" />
        <div className="text-[12.5px] font-medium text-tx">Upload images</div>
        <div className="text-[11px] text-tx3">Click, drop files, or paste — PNG · JPG · SVG</div>
      </button>

      {assets.length === 0 ? (
        <div className="rounded-lg border border-line bg-bg1 p-3 text-[12px] leading-relaxed text-tx2">
          Your library is empty. Uploads stay on this device and appear here so
          you can reuse them across designs.
        </div>
      ) : (
        <section>
          <div className="panel-title mb-2">Library · {assets.length}</div>
          <div className="grid grid-cols-2 gap-2">
            {assets.map((a) => (
              <div key={a.id} className="group relative">
                <AssetThumb asset={a} onPick={() => addImageLayer(a)} />
                {a.hasCutout && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-ok/15 px-1.5 py-px text-[9px] font-bold tracking-wide text-ok">
                    CUTOUT
                  </span>
                )}
                {processing[a.id] !== undefined ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-bg0/80 backdrop-blur-[2px]">
                    <Wand2 size={16} className="animate-pulse text-cy" />
                    <div className="h-1 w-3/5 overflow-hidden rounded-full bg-bg3">
                      <div
                        className="h-full rounded-full bg-cy transition-all"
                        style={{ width: `${processing[a.id]}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      className="iconbtn h-7 w-7 bg-bg1/90 text-tx backdrop-blur"
                      title="Add to design"
                      onClick={() => addImageLayer(a)}
                    >
                      <Plus size={13} />
                    </button>
                    {!a.hasCutout && (
                      <button
                        className="iconbtn h-7 w-7 bg-bg1/90 text-cy backdrop-blur"
                        title="Remove background"
                        onClick={() => void cutout(a)}
                      >
                        <Scissors size={13} />
                      </button>
                    )}
                    <button
                      className="iconbtn h-7 w-7 bg-bg1/90 text-dg backdrop-blur"
                      title="Delete from library"
                      onClick={() => void del(a)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-tx3">
            <Scissors size={11} className="mr-1 inline" />
            Remove background runs on your device — nothing is uploaded anywhere.
          </p>
        </section>
      )}
    </div>
  )
}
