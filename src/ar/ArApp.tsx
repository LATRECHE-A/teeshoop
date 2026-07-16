/**
 * AR page chrome (module: AR). React owns UI + permissions; ArScene owns WebGL.
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, Download, RotateCcw, Share2, Smartphone, Sparkles, X } from 'lucide-react'
import { ArScene } from './arScene'
import { loadArDesign, type ArDesignBundle } from './loadDesign'
import { downloadBlob } from '@/lib/download'
import { art } from './i18n'
import type { Gender } from './mannequin'
import type { MannequinSide } from './mannequin'

type Phase = 'loading' | 'ready' | 'live' | 'nodesign'

function RegMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx="32" cy="32" r="19" fill="none" stroke="#35C7FF" strokeWidth="3" />
      <circle cx="32" cy="32" r="3" fill="#EEF1F5" />
      <path d="M32 5v16M32 43v16M5 32h16M43 32h16" stroke="#FF3D8F" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function ArApp() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ArScene | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [bundle, setBundle] = useState<ArDesignBundle | null>(null)
  const [gender, setGender] = useState<Gender>('male')
  const [side, setSide] = useState<MannequinSide>('front')
  const [xrOk, setXrOk] = useState(false)
  const [camWarn, setCamWarn] = useState(false)
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null)
  const [busy, setBusy] = useState(false)

  // Load design + probe XR once.
  useEffect(() => {
    let alive = true
    void (async () => {
      const b = await loadArDesign().catch(() => null)
      if (!alive) return
      if (!b) {
        setPhase('nodesign')
        return
      }
      setBundle(b)
      setPhase('ready')
    })()
    void ArScene.supportsXR().then((ok) => alive && setXrOk(ok))
    return () => {
      alive = false
    }
  }, [])

  // Instantiate the scene ONCE the design bundle is loaded — keyed on `bundle`
  // only, NOT `phase`. Keying on phase would tear down and rebuild the scene on
  // the ready→live transition (right after start() called startCamera()), which
  // would silently kill the camera passthrough + motion on every Start.
  useEffect(() => {
    if (!hostRef.current || !bundle || sceneRef.current) return
    const scene = new ArScene(hostRef.current)
    sceneRef.current = scene
    scene.setTextures({
      front: bundle.front,
      back: bundle.back,
      frontIn: bundle.frontIn,
      backIn: bundle.backIn,
    })
    scene.setGarmentColor(bundle.garmentColor)
    scene.setGender(gender)
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle])

  useEffect(() => {
    sceneRef.current?.setGender(gender)
  }, [gender])
  useEffect(() => {
    sceneRef.current?.showSide(side)
  }, [side])
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url)
    }
  }, [shot])

  const start = async () => {
    const scene = sceneRef.current
    if (!scene) return
    try {
      await scene.startCamera()
    } catch {
      setCamWarn(true)
    }
    void scene.enableMotion()
    setPhase('live')
  }

  const snapshot = async () => {
    const scene = sceneRef.current
    if (!scene || busy) return
    setBusy(true)
    try {
      const blob = await scene.capture()
      setShot({ url: URL.createObjectURL(blob), blob })
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const saveShot = () => {
    if (shot) downloadBlob(shot.blob, `tshop-ar-${Date.now()}.png`)
  }

  const shareShot = async () => {
    if (!shot) return
    const file = new File([shot.blob], 'tshop-ar.png', { type: 'image/png' })
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: art('ar.share_title'), text: art('ar.share_text') })
        return
      } catch {
        /* fall through to download */
      }
    }
    saveShot()
  }

  const enterXR = async () => {
    try {
      await sceneRef.current?.enterXR(hostRef.current ?? undefined)
    } catch {
      setCamWarn(false)
    }
  }

  // --- render --------------------------------------------------------------

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0c0f13] text-[#eef1f5]" style={{ height: '100dvh' }}>
      {/* WebGL host (camera video + canvas injected by ArScene) */}
      <div ref={hostRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 backdrop-blur">
          <RegMark size={20} />
          <span className="text-[13px] font-bold tracking-wide">Tshop AR</span>
        </div>
        <a href="/" className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/45 backdrop-blur" aria-label={art('ar.close')}>
          <X size={18} />
        </a>
      </div>

      {/* Loading */}
      {phase === 'loading' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <RegMark size={54} />
        </div>
      )}

      {/* No design */}
      {phase === 'nodesign' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <RegMark size={48} />
          <div className="text-[15px] font-bold">{art('ar.nodesign_title')}</div>
          <p className="max-w-xs text-[13px] leading-relaxed text-[#9aa5b4]">{art('ar.nodesign_body')}</p>
          <a href="/" className="rounded-lg bg-[#35c7ff] px-4 py-2 text-[13px] font-semibold text-[#06121a]">
            {art('ar.open_studio')}
          </a>
        </div>
      )}

      {/* Start gate */}
      {phase === 'ready' && bundle && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/55 px-8 text-center backdrop-blur-sm">
          <Sparkles size={34} className="text-[#35c7ff]" />
          <div className="text-[17px] font-bold">{art('ar.start_title')}</div>
          <p className="max-w-xs text-[13px] leading-relaxed text-[#c3cad5]">{art('ar.start_body')}</p>
          <button onClick={start} className="flex items-center gap-2 rounded-xl bg-[#35c7ff] px-5 py-3 text-[14px] font-semibold text-[#06121a]">
            <Camera size={17} /> {art('ar.start_cta')}
          </button>
          <p className="text-[11px] text-[#6b7686]">{art('ar.start_hint')}</p>
        </div>
      )}

      {/* Live controls */}
      {phase === 'live' && (
        <>
          {camWarn && (
            <div className="absolute inset-x-0 z-20 flex justify-center px-4" style={{ top: 'calc(env(safe-area-inset-top) + 3.5rem)' }}>
              <div className="rounded-lg bg-[#ffc940]/15 px-3 py-2 text-center text-[11.5px] text-[#ffc940]">
                {art('ar.no_camera')}
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {/* gender + side segmented controls */}
            <div className="pointer-events-auto flex gap-2">
              <Segmented
                value={gender}
                onChange={(v) => setGender(v as Gender)}
                options={[
                  { v: 'female', label: art('ar.female') },
                  { v: 'male', label: art('ar.male') },
                ]}
              />
              <Segmented
                value={side}
                onChange={(v) => setSide(v as MannequinSide)}
                options={[
                  { v: 'front', label: art('ar.front') },
                  { v: 'back', label: art('ar.back'), disabled: !bundle?.hasBack },
                ]}
              />
            </div>

            {/* action row */}
            <div className="pointer-events-auto flex items-center gap-4">
              <RoundBtn onClick={() => sceneRef.current?.resetPose()} label={art('ar.reset')}>
                <RotateCcw size={20} />
              </RoundBtn>
              <button
                onClick={snapshot}
                disabled={busy}
                aria-label={art('ar.snapshot')}
                className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/85 bg-white/25 backdrop-blur active:scale-95"
              >
                <Camera size={26} />
              </button>
              {xrOk ? (
                <RoundBtn onClick={enterXR} label={art('ar.place')}>
                  <Smartphone size={20} />
                </RoundBtn>
              ) : (
                <div className="h-12 w-12" />
              )}
            </div>
            <p className="pointer-events-none text-center text-[11px] text-white/70">{art('ar.gesture_hint')}</p>
          </div>
        </>
      )}

      {/* Snapshot preview */}
      {shot && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/85 p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <img src={shot.url} alt={art('ar.snapshot')} className="max-h-full max-w-full rounded-xl border border-white/15" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={() => setShot(null)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2.5 text-[13px] font-medium">
              <RotateCcw size={15} /> {art('ar.retake')}
            </button>
            <button onClick={saveShot} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2.5 text-[13px] font-medium">
              <Download size={15} /> {art('ar.save')}
            </button>
            <button onClick={shareShot} className="flex items-center gap-1.5 rounded-lg bg-[#35c7ff] px-4 py-2.5 text-[13px] font-semibold text-[#06121a]">
              <Share2 size={15} /> {art('ar.share')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { v: string; label: string; disabled?: boolean }[]
}) {
  return (
    <div className="flex overflow-hidden rounded-full bg-black/45 p-1 backdrop-blur">
      {options.map((o) => (
        <button
          key={o.v}
          disabled={o.disabled}
          onClick={() => onChange(o.v)}
          className={
            'min-w-[52px] rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ' +
            (value === o.v ? 'bg-[#35c7ff] text-[#06121a]' : o.disabled ? 'text-white/25' : 'text-white/80')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function RoundBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur active:scale-95"
    >
      {children}
    </button>
  )
}
