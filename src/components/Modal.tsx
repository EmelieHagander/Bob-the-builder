/*
 * Shared modal: scrim, Escape to close, click outside to close.
 * Ported from the Djuvanäs farm portal, restyled with bob's tokens.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui'

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    if (!element?.contains(document.activeElement)) element?.querySelector<HTMLElement>('input,textarea,select,button,a[href]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] !== element) return
      if (event.key === 'Escape') { event.stopImmediatePropagation(); close.current() }
      if (event.key === 'Tab') {
        const targets = Array.from(element?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]') ?? [])
          .filter(node => node.getClientRects().length > 0)
        const first = targets[0], last = targets[targets.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [])

  // Page/parent animations create containing blocks and stacking contexts.
  // A body portal keeps long and nested dialogs above the fixed mobile controls.
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={dialog} className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 style={{ fontSize: 19, margin: 0 }}>{title}</h3>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={onClose} aria-label="Close">
            <Icon name="x" weight="bold" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>, document.body
  )
}
