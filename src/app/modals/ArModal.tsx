import { useEffect, useState } from 'react'
import { Copy, ExternalLink, RefreshCw, Smartphone, TriangleAlert, User, UserRound } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import type { Gender } from '@/lib/arExport'
import { makeQrDataUrl } from '@/lib/qr'
import { useMockupUrl } from '../hooks/useMockup'
import { useT } from '@/i18n'

type Phase = 'working' | 'ready' | 'error'

export default function ArModal() {
  const t = useT()
  const design = useStore((s) => s.design)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  const preview = useMockupUrl(design, 'front', 300)

  const [gender, setGender] = useState<Gender>('male')
  const [nonce, setNonce] = useState(0)
  const [phase, setPhase] = useState<Phase>('working')
  const [qr, setQr] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  // Bake the design onto the mannequin, upload GLB+USDZ+poster to R2, then show
  // a QR of the SHORT /v/{id} URL (scannable + cross-device). Re-runs on gender
  // change or retry.
  useEffect(() => {
    let on = true
    setPhase('working')
    setQr(null)
    ;(async () => {
      try {
        // Lazy — keeps the three exporters + mannequin out of the studio's
        // initial bundle until someone actually opens the AR modal.
        const { buildArModel, uploadArModel } = await import('@/lib/arExport')
        const blobs = await buildArModel(design, gender)
        const id = await uploadArModel(blobs)
        if (!on) return
        // The id travels as ?id=… , NOT /v/{id}: Cloudflare's html_handling
        // rewrites /v/{id} -> /v (dropping the id) because v.html is an asset.
        const link = `${location.origin}/v?id=${id}`
        setUrl(link)
        const dataUrl = await makeQrDataUrl(link)
        if (!on) return
        setQr(dataUrl)
        setPhase('ready')
      } catch {
        if (on) setPhase('error')
      }
    })()
    return () => {
      on = false
    }
  }, [design, gender, nonce])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('ok', t('toast.link_copied'))
    } catch {
      toast('error', t('toast.clipboard_failed'))
    }
  }

  return (
    <Modal title={t('ar.modal_title')} subtitle={t('ar.modal_subtitle')} onClose={() => closeModal('ar')} size="md">
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-line bg-white p-3">
            {phase === 'ready' && qr ? (
              <img src={qr} alt={t('ar.qr_alt')} className="h-full w-full" />
            ) : phase === 'error' ? (
              <div className="flex flex-col items-center gap-2 px-3 text-center text-tx3">
                <TriangleAlert size={34} className="text-yl" />
                <span className="text-[11px] leading-snug">{t('ar.error')}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-tx3">
                <RefreshCw size={34} className="animate-spin" />
                <span className="text-[11px]">{t('ar.generating')}</span>
              </div>
            )}
          </div>
          {preview && <img src={preview} alt="" className="h-16 rounded-lg border border-line bg-bg1 p-1" />}
        </div>

        <div className="flex flex-col gap-4">
          {/* The mannequin (and its gender) is only used for ship-your-own
              custom garments; tee/hoodie AR shows the real garment itself. */}
          {design.garmentId === 'custom' && (
            <div>
              <div className="panel-title mb-1.5">{t('ar.gender')}</div>
              <div className="flex gap-2">
                {(['male', 'female'] as Gender[]).map((g) => {
                  const Icon = g === 'male' ? User : UserRound
                  return (
                    <button
                      key={g}
                      className={`btn flex-1 ${gender === g ? 'btn-primary' : ''}`}
                      aria-pressed={gender === g}
                      onClick={() => setGender(g)}
                    >
                      <Icon size={15} />
                      {g === 'male' ? t('ar.gender_male') : t('ar.gender_female')}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="panel-title mb-1.5 flex items-center gap-1.5">
              <Smartphone size={13} /> {t('ar.how_title')}
            </div>
            <p className="text-[12.5px] leading-relaxed text-tx2">{t('ar.how_scan')}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {phase === 'error' ? (
              <button className="btn btn-primary" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw size={15} />
                {t('ar.retry')}
              </button>
            ) : (
              <>
                <a
                  className={`btn btn-primary ${phase !== 'ready' ? 'pointer-events-none opacity-50' : ''}`}
                  href={url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} />
                  {t('ar.open_here')}
                </a>
                <button className="btn" disabled={phase !== 'ready'} onClick={copyLink}>
                  <Copy size={15} />
                  {t('ar.copy_link')}
                </button>
              </>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-tx3">{t('ar.privacy_note')}</p>
        </div>
      </div>
    </Modal>
  )
}
