import { useEffect } from 'react'
import { redo, undo, useStore } from '@/state/store'

function inField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  )
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey

      const openModal = (Object.keys(s.modals) as (keyof typeof s.modals)[]).find(
        (k) => s.modals[k],
      )
      if (e.key === 'Escape') {
        if (openModal) s.closeModal(openModal)
        // Escape unwinds the board one level at a time: focused product →
        // board → out. Only then does it fall back to clearing the selection.
        else if (s.board.focusedId) s.unfocusLine()
        else if (s.board.on) s.exitBoard()
        else s.select(null)
        return
      }
      // While a dialog is up, no shortcut may mutate the design behind it.
      if (openModal || inField(e)) return

      // Browsing the board, `design` is the user's OWN document while the
      // screen shows somebody else's products — so every design-mutating
      // shortcut is off, and only navigation survives.
      if (s.board.on && !s.board.focusedId) {
        const zoom = (detail: string) =>
          window.dispatchEvent(new CustomEvent('tshop:zoom', { detail }))
        if (e.key.toLowerCase() === 'f' && !mod) zoom('fit')
        else if (e.key === '+' || e.key === '=') zoom('in')
        else if (e.key === '-' || e.key === '_') zoom('out')
        else if (e.key === '?' || (e.shiftKey && e.key === '/')) s.openModal('shortcuts')
        return
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (s.selectedId) s.duplicateLayer(s.selectedId)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        e.preventDefault()
        s.removeLayer(s.selectedId)
        return
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        s.openModal('shortcuts')
        return
      }
      if (e.key.toLowerCase() === 'f' && !mod && s.mode === '2d') {
        window.dispatchEvent(new CustomEvent('tshop:zoom', { detail: 'fit' }))
        return
      }
      if (e.key.toLowerCase() === 't' && !mod) {
        s.addTextLayer()
        return
      }

      // nudge selection
      if (s.selectedId && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 0.5 : 0.05
        const layer = s.design.layers.find((l) => l.id === s.selectedId)
        if (!layer) return
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        s.patchLayer(layer.id, {
          xIn: Math.round((layer.xIn + dx) * 100) / 100,
          yIn: Math.round((layer.yIn + dy) * 100) / 100,
        })
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
