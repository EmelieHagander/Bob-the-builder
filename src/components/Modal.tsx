/*
 * Shared modal: scrim, Escape to close, click outside to close.
 * Ported from the Djuvanäs farm portal, restyled with bob's tokens.
 */

import { useEffect, type ReactNode } from 'react'
import { Icon } from './ui'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 style={{ fontSize: 19, margin: 0 }}>{title}</h3>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={onClose} aria-label="Close">
            <Icon name="x" weight="bold" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
