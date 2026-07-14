import Modal from './Modal'
import { useStore } from '@/state/store'

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Canvas',
    rows: [
      ['Scroll', 'Zoom in / out'],
      ['Space + drag', 'Pan around'],
      ['F', 'Fit garment to screen'],
      ['Double-click text', 'Edit its content'],
    ],
  },
  {
    title: 'Layers',
    rows: [
      ['Delete / Backspace', 'Remove selected layer'],
      ['Ctrl + D', 'Duplicate selected layer'],
      ['Arrow keys', 'Nudge 0.05″ (Shift = 0.5″)'],
      ['Esc', 'Deselect / close dialogs'],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Shift + Z', 'Redo'],
      ['T', 'Add a text layer'],
      ['?', 'This cheatsheet'],
    ],
  },
]

export default function ShortcutsModal() {
  const closeModal = useStore((s) => s.closeModal)
  return (
    <Modal title="Keyboard shortcuts" onClose={() => closeModal('shortcuts')}>
      <div className="grid gap-5 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="panel-title mb-2">{g.title}</div>
            <dl className="flex flex-col gap-2">
              {g.rows.map(([key, what]) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  <dt>
                    <kbd className="rounded-md border border-line bg-bg1 px-1.5 py-0.5 font-mono text-[11px] text-tx2">
                      {key}
                    </kbd>
                  </dt>
                  <dd className="text-right text-[12px] leading-snug text-tx2">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-6 border-t border-line pt-3 text-[10.5px] leading-relaxed text-tx3">
        3D hoodie model based on{' '}
        <a
          className="underline decoration-line2 underline-offset-2 hover:text-tx2"
          href="https://sketchfab.com/3d-models/hoodie-2c674228f1e946b5b8f508f8f818e130"
          target="_blank"
          rel="noreferrer"
        >
          “Hoodie” by yogaminggames
        </a>{' '}
        (CC-BY-4.0, simplified & recolored) · t-shirt model CC0 via pmndrs
        market · fonts via Google Fonts (OFL) · icons by lucide (ISC).
      </p>
    </Modal>
  )
}
