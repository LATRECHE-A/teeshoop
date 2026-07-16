import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Info, QrCode, Smartphone } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { canShareAsLink, designToShareHash } from '@/lib/shareLink'
import { makeQrDataUrl } from '@/lib/qr'
import { useMockupUrl } from '../hooks/useMockup'
import { useT } from '@/i18n'

export default function ArModal() {
  const t = useT()
  const design = useStore((s) => s.design)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  const preview = useMockupUrl(design, 'front', 300)

  const linkable = canShareAsLink(design)
  const arBase = `${location.origin}/ar.html`
  const url = linkable ? `${arBase}${designToShareHash(design)}` : arBase

  const [qr, setQr] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)

  useEffect(() => {
    if (!linkable) {
      setQr(null)
      return
    }
    let on = true
    setQrError(false)
    makeQrDataUrl(url).then(
      (d) => on && setQr(d),
      () => on && setQrError(true),
    )
    return () => {
      on = false
    }
  }, [url, linkable])

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
            {linkable && qr ? (
              <img src={qr} alt={t('ar.qr_alt')} className="h-full w-full" />
            ) : linkable && !qrError ? (
              <QrCode size={54} className="animate-pulse text-tx3" />
            ) : (
              <div className="flex flex-col items-center gap-2 px-3 text-center text-tx3">
                <Smartphone size={40} />
                <span className="text-[11px] leading-snug">{t('ar.qr_unavailable')}</span>
              </div>
            )}
          </div>
          {preview && (
            <img src={preview} alt="" className="h-16 rounded-lg border border-line bg-bg1 p-1" />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="panel-title mb-1.5 flex items-center gap-1.5">
              <Smartphone size={13} /> {t('ar.how_title')}
            </div>
            <p className="text-[12.5px] leading-relaxed text-tx2">
              {linkable ? t('ar.how_scan') : t('ar.how_device')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              className="btn btn-primary"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} />
              {t('ar.open_here')}
            </a>
            {linkable && (
              <button className="btn" onClick={copyLink}>
                <Copy size={15} />
                {t('ar.copy_link')}
              </button>
            )}
          </div>

          {!linkable && (
            <div className="flex items-start gap-2 rounded-lg border border-yl/25 bg-yl/10 p-3 text-[11.5px] leading-relaxed text-yl">
              <Info size={14} className="mt-px shrink-0" />
              {t('ar.photo_note')}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-tx3">{t('ar.privacy_note')}</p>
        </div>
      </div>
    </Modal>
  )
}
