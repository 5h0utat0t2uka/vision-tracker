import type { ReactNode, Ref } from 'react'
import styles from './index.module.css'

export function Page({ children }: { children: ReactNode }) {
  return <main className={styles.page}>{children}</main>
}

type PageStageProps = {
  children: ReactNode
  ref?: Ref<HTMLElement>
  'aria-label': string
}

export function PageStage({ children, ref, 'aria-label': ariaLabel }: PageStageProps) {
  return <section className={styles.stage} ref={ref} aria-label={ariaLabel}>{children}</section>
}
