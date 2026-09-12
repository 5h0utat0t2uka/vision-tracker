import type { ReactNode } from 'react'
import styles from './index.module.css'

type PopoverProps = {
  id: string
  title: string
  children: ReactNode
}

export function Popover({ id, title, children }: PopoverProps) {
  const titleId = `${id}-title`
  return (
    <aside id={id} className={styles.panel} aria-labelledby={titleId} popover="auto">
      <div className={styles.heading}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="設定を閉じる">
          <svg aria-hidden="true" width={24} height={24} viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L17.94 6M18 18L6.06 6" /></svg>
        </button>
      </div>
      {children}
    </aside>
  )
}
