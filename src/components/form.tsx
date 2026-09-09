/*
 * Tiny shared form primitives — the same input look everywhere a form
 * appears (start screen, account settings, project modals).
 */

import { cloneElement, isValidElement, useId, type CSSProperties, type ReactNode } from 'react'

export const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--surface)',
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--ink)',
  outline: 'none',
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId()
  // A wrapping label otherwise includes a select's option text in its name.
  const control = isValidElement<{ 'aria-labelledby'?: string }>(children)
    && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-labelledby': children.props['aria-labelledby'] ?? labelId }) : children
  return (
    <label style={{ display: 'block' }}>
      <div id={labelId} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 5 }}>{label}</div>
      {control}
    </label>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>
      {children}
    </div>
  )
}
