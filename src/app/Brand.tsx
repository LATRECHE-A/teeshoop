import { useT } from '@/i18n/useT'

/**
 * La marque Teeshoop en icône : l'en-tête du studio et ses écrans de chargement.
 * C'était une mire d'imprimeur cyan et magenta, l'identité « Tshop » du prototype,
 * qui n'est pas celle de la boutique.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/icone-teeshoop.png"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={['rounded-[4px]', className].filter(Boolean).join(' ')}
    />
  )
}

export function Brand() {
  const t = useT()
  return (
    <div className="flex items-center gap-2.5 select-none">
      <BrandMark />
      <div className="leading-none max-sm:hidden">
        <div className="font-display text-[15px] font-bold tracking-[0.24em] text-tx">
          TEESHOOP
        </div>
        <div className="mt-0.5 hidden text-[10px] tracking-[0.08em] text-tx3 sm:block">
          {t('brand.tagline').toUpperCase()}
        </div>
      </div>
    </div>
  )
}
