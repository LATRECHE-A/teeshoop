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
  shopContext,
  subscribeBridge,
  type BridgeStatus,
  type ShopContext,
} from '@/lib/teeshoop/bridge'

const standalone = (): BridgeStatus => 'standalone'
const noContext = (): ShopContext | null => null

export function useShopBridge(): { status: BridgeStatus; context: ShopContext | null } {
  return {
    status: useSyncExternalStore(subscribeBridge, bridgeStatus, standalone),
    context: useSyncExternalStore(subscribeBridge, shopContext, noContext),
  }
}
