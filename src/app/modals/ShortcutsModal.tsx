import Modal from './Modal'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'

export default function ShortcutsModal() {
  const t = useT()
  const closeModal = useStore((s) => s.closeModal)

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: t('shortcuts.group_canvas'),
      rows: [
        [t('shortcuts.chord_scroll'), t('shortcuts.zoom')],
        [t('shortcuts.chord_space_drag'), t('shortcuts.pan')],
        ['F', t('shortcuts.fit')],
        [t('shortcuts.chord_dblclick_text'), t('shortcuts.edit_content')],
      ],
    },
    {
      title: t('shortcuts.group_layers'),
      rows: [
        [t('shortcuts.chord_delete'), t('shortcuts.remove_layer')],
        ['Ctrl + D', t('shortcuts.duplicate_layer')],
        [t('shortcuts.chord_arrows'), t('shortcuts.nudge')],
        ['Esc', t('shortcuts.deselect')],
      ],
    },
    {
      title: t('shortcuts.group_general'),
      rows: [
        ['Ctrl + Z', t('shortcuts.undo')],
        ['Ctrl + Shift + Z', t('shortcuts.redo')],
        ['T', t('shortcuts.add_text')],
        ['?', t('shortcuts.cheatsheet')],
      ],
    },
  ]

  return (
    <Modal title={t('rail.shortcuts')} onClose={() => closeModal('shortcuts')}>
      <div className="grid gap-5 sm:grid-cols-3">
        {groups.map((g) => (
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
        {t('shortcuts.credits_before')}{' '}
        <a
          className="underline decoration-line2 underline-offset-2 hover:text-tx2"
          href="https://sketchfab.com/3d-models/hoodie-2c674228f1e946b5b8f508f8f818e130"
          target="_blank"
          rel="noreferrer"
        >
          {t('shortcuts.credits_link')}
        </a>{' '}
        {t('shortcuts.credits_after')}
      </p>
    </Modal>
  )
}
