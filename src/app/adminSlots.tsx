/**
 * The seam between the customer studio and the admin studio.
 *
 * The app ships as TWO Vite entries built from the same component tree:
 *   index.html → src/main.tsx        the CUSTOMER studio (slots are null)
 *   admin.html → src/admin/main.tsx  the ADMIN studio (slots are filled)
 *
 * WHY A BUILD-TIME SEAM AND NOT A ROLE FLAG. Admin tooling carries our
 * purchase costs, our €/linear-metre film economics and a WooCommerce
 * credential form. A runtime `if (isAdmin)` hides the buttons but still ships
 * the code and the data to every visitor, where anyone can read it out of the
 * bundle. The only way to not send it is to not build it in, so the admin
 * modules must have exactly ONE static importer, `src/admin/**`, which only
 * admin.html reaches.
 *
 * THE INVARIANT: this file, and every file that renders one of these slots,
 * may never import anything under `src/admin/`, nor any module on the admin
 * deny-list in src/app/adminBoundary.test.ts. That test walks the real import
 * graph from src/main.tsx and fails the build if an edge appears. Note this
 * file imports from 'react' and NOTHING else, on purpose.
 *
 * (Build-time splitting hides the CODE, not the URL: admin.html is still
 * served as a static asset. Gating that path is the Worker's job.)
 */
import { createContext, useContext, type ReactNode } from 'react'

export interface AdminSlots {
  /** Extra modals rendered beside the customer ones (Modals.tsx). */
  modals: ReactNode
  /** Extra controls in TopBar's right-hand cluster (the wrench menu). */
  tools: ReactNode
  /** Extra entry card in the Product panel (the supplier catalogue). */
  productEntry: ReactNode
}

/** The customer build's value. Frozen so nothing can fill it at runtime. */
const EMPTY: AdminSlots = Object.freeze({ modals: null, tools: null, productEntry: null })

export const AdminSlotsContext = createContext<AdminSlots>(EMPTY)

export const useAdminSlots = (): AdminSlots => useContext(AdminSlotsContext)
