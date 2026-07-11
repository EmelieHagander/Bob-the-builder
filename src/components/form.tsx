/*
 * Tiny shared form primitives — the same input look everywhere a form
 * appears (start screen, account settings, project modals).
 */

import type { CSSProperties, ReactNode } from 'react'

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
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 5 }}>{label}</div>
      {children}
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
