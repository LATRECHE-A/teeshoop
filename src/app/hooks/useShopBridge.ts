/**
 * The bridge's state, as React sees it.
 *
 * The bridge is a module singleton rather than store state on purpose: it has
 * to exist and post its handshake before React has mounted anything, and it
 * must keep working in the standalone studio where nothing subscribes at all.
 * `useSyncExternalStore` is the seam between the two.
 */
import { useSyncExternalStore } from 'react'
import {
  bridgeStatus,
  canOrderFromShop,
  shopContext,
  subscribeBridge,
  type BridgeStatus,
  type ShopContext,
} from '@/lib/teeshoop/bridge'

const standalone = (): BridgeStatus => 'standalone'
const noContext = (): ShopContext | null => null
const cannotOrder = (): boolean => false

export function useShopBridge(): {
  status: BridgeStatus
  context: ShopContext | null
  /** The shop answered AND the page it answered from can take an order. */
  canOrder: boolean
} {
  return {
    status: useSyncExternalStore(subscribeBridge, bridgeStatus, standalone),
    context: useSyncExternalStore(subscribeBridge, shopContext, noContext),
    canOrder: useSyncExternalStore(subscribeBridge, canOrderFromShop, cannotOrder),
  }
}
