/**
 * The filled admin slots: the ONLY module in the repo that imports the
 * supplier catalogue, the DTF gang-sheet builder and the product ingest tool.
 *
 * Everything reachable from here is shop-internal: our purchase cost per SKU,
 * our film cost per linear metre, and the WooCommerce credential form. Because
 * this file is reachable only from src/admin/main.tsx (admin.html), Rollup
 * cannot place any of it in the customer bundle. src/app/adminBoundary.test.ts
 * proves that by walking the real import graph, and scripts/bundle-guard.mjs
 * proves it again against the built output.
 *
 * If you need one of these tools from customer code, the answer is no. Extract
 * the part that is genuinely customer-facing instead.
 */
import { lazy, useState } from 'react'
import { Layers, PackagePlus, Store, Wrench } from 'lucide-react'
import { useStore } from '@/state/store'
import { LazyModal } from '@/app/modals/lazyModal'
import type { AdminSlots } from '@/app/adminSlots'
import { useAdminT } from './adminI18n'
import { useCatalogT } from '@/app/modals/catalogI18n'

// Still lazy inside the admin build: DtfModal and CatalogModal are large, and
// the operator opens the studio far more often than the tools. It also keeps
// LazyModal's chunk-failure handling in play.
const CatalogModal = lazy(() => import('@/app/modals/CatalogModal'))
const DtfModal = lazy(() => import('@/app/modals/DtfModal'))
const AdminIngestModal = lazy(() => import('@/app/modals/AdminIngestModal'))

function AdminModals() {
  const modals = useStore((s) => s.modals)
  return (
    <>
      {modals.catalog && (
        <LazyModal modal="catalog">
          <CatalogModal />
        </LazyModal>
      )}
      {modals.dtf && (
        <LazyModal modal="dtf">
          <DtfModal />
        </LazyModal>
      )}
      {modals.adminIngest && (
        <LazyModal modal="adminIngest">
          <AdminIngestModal />
        </LazyModal>
      )}
    </>
  )
}

/** The wrench menu, lifted out of TopBar. */
function AdminTools() {
  const openModal = useStore((s) => s.openModal)
  const [open, setOpen] = useState(false)
  const t = useAdminT()

  return (
    <div className="relative hidden sm:block">
      <button
        className="iconbtn"
        aria-label={t('admin.menu')}
        aria-expanded={open}
        title={t('admin.menu')}
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-line bg-bg1 p-1 shadow-xl">
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-tx transition-colors hover:bg-bg3"
              onClick={() => {
                setOpen(false)
                openModal('dtf')
              }}
            >
              <Layers size={14} className="text-cy" />
              {t('admin.dtf')}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-tx transition-colors hover:bg-bg3"
              onClick={() => {
                setOpen(false)
                openModal('adminIngest')
              }}
            >
              <PackagePlus size={14} className="text-cy" />
              {t('admin.products')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The supplier-catalogue card, lifted out of ProductPanel. */
function CatalogEntry() {
  const openModal = useStore((s) => s.openModal)
  const ct = useCatalogT()

  return (
    <button
      onClick={() => openModal('catalog')}
      className="mt-2 flex w-full items-center gap-3 rounded-xl border border-line bg-bg1 p-3 text-left transition-colors hover:border-cy/60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg3 text-cy">
        <Store size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-tx">
          {ct('catalog.entry.title')}
        </span>
        <span className="block text-[11px] leading-snug text-tx2">
          {ct('catalog.entry.cta')}
        </span>
      </span>
    </button>
  )
}

export const ADMIN_SLOTS: AdminSlots = {
  modals: <AdminModals />,
  tools: <AdminTools />,
  productEntry: <CatalogEntry />,
}
