import { useEffect, type ReactNode } from 'react'
import { IconClose } from './Icons'

interface Props {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Extra control on the right of the header, e.g. a delete button. */
  action?: ReactNode
}

/** Bottom sheet — the app's one modal pattern. */
export function Sheet({ open, title, onClose, children, footer, action }: Props) {
  // Lock the page behind the sheet so only the sheet body scrolls.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sheet-wide" role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="truncate">{title}</h2>
          {action}
          <button className="icon-btn icon-btn-plain" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  )
}
