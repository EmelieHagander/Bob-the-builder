/*
 * Tiny shared form primitives — the same input look everywhere a form
 * appears (start screen, account settings, project modals).
 */

import { cloneElement, isValidElement, useId, type CSSProperties, type ReactNode } from 'react'

export const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface)',
  padding: 'var(--field-padding)',
  minHeight: 'var(--control-height)',
  fontSize: 'var(--text-body)',
  color: 'var(--ink)',
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId()
  // A wrapping label otherwise includes a select's option text in its name.
  const control = isValidElement<{ 'aria-labelledby'?: string }>(children)
    && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-labelledby': children.props['aria-labelledby'] ?? labelId }) : children
  return (
    <label className="ui-field">
      <div id={labelId} className="ui-field-label">{label}</div>
      {control}
    </label>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="ui-form-error">
      {children}
    </div>
  )
}
