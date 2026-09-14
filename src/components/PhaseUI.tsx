import { useState, type CSSProperties, type ReactNode } from 'react'
import type { ProjectPhase } from '../data/types'
import { PHASE_META, PROJECT_PHASES, phaseLabel } from '../lib/projectPhase'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Icon } from './ui'

const pillStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 26,
  padding: '4px 9px', borderRadius: 999, border: '1px solid var(--line)',
  background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 12, fontWeight: 750,
  whiteSpace: 'nowrap',
}

export function PhasePill({ phase, prefix }: { phase?: ProjectPhase | null; prefix?: string }) {
  const meta = phase ? PHASE_META[phase] : null
  return <span style={pillStyle} aria-label={`${prefix ? prefix + ' ' : ''}phase: ${phaseLabel(phase)}`}>
    <Icon name={meta?.icon ?? 'signpost'} size={13} color={phase ? 'var(--accent-2)' : 'var(--ink-faint)'} />
    {prefix && <span style={{ color: 'var(--ink-soft)', fontWeight: 650 }}>{prefix}</span>}
    {meta?.label ?? 'Not classified'}
  </span>
}

export function PhaseRail({ phase, compact = false }: { phase?: ProjectPhase | null; compact?: boolean }) {
  const currentIndex = phase ? PROJECT_PHASES.indexOf(phase) : -1
  return <div aria-label={`Lifecycle phase: ${phaseLabel(phase)}`} style={{ display: 'flex', alignItems: 'center', gap: compact ? 3 : 5, flexWrap: 'wrap' }}>
    {PROJECT_PHASES.map((item, index) => {
      const current = item === phase
      const passed = currentIndex >= 0 && index < currentIndex
      return <div key={item} style={{ display: 'flex', alignItems: 'center', gap: compact ? 3 : 5 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          minHeight: compact ? 25 : 29, padding: compact ? '3px 7px' : '4px 9px', borderRadius: 999,
          border: current ? '1.5px solid var(--accent-2)' : '1px solid var(--line)',
          background: current ? 'var(--surface)' : 'var(--surface-2)',
          color: current ? 'var(--ink)' : passed ? 'var(--ink-soft)' : 'var(--ink-faint)',
          fontSize: compact ? 11 : 12, fontWeight: current ? 800 : 650,
        }}>
          {!compact && <Icon name={passed ? 'check' : PHASE_META[item].icon} size={12} />}
          {PHASE_META[item].short}
        </span>
        {index < PROJECT_PHASES.length - 1 && <Icon name="caret-right" size={10} color="var(--ink-faint)" />}
      </div>
    })}
  </div>
}

export function NextActionCard({ eyebrow = 'What next?', title, text, icon, action }: {
  eyebrow?: string; title: string; text: string; icon: string; action?: ReactNode
}) {
  return <div className="card" style={{ padding: 17, borderColor: 'var(--accent-2)' }}>
    <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <Icon name={icon} size={21} color="var(--accent-2)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 750, color: 'var(--accent-2)' }}>{eyebrow}</div>
        <h2 className="font-display" style={{ fontSize: 20, lineHeight: 1.12, margin: '4px 0 5px' }}>{title}</h2>
        <p className="foundation-hint" style={{ margin: 0 }}>{text}</p>
        {action && <div className="foundation-actions" style={{ marginTop: 11 }}>{action}</div>}
      </div>
    </div>
  </div>
}

export function PhaseTransitionDialog({ title, current, onClose, onSave }: {
  title: string
  current?: ProjectPhase | null
  onClose: () => void
  onSave: (phase: ProjectPhase, reason: string) => Promise<void>
}) {
  const [next, setNext] = useState<ProjectPhase>(current ?? 'concept')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={title} onClose={() => { if (!busy) onClose() }}>
    <p className="foundation-hint">Phase is explicit project truth. Readiness can guide the choice, but Bob will not advance it automatically.</p>
    <div style={{ margin: '12px 0' }}><PhaseRail phase={current} compact /></div>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !reason.trim() || next === current) return
      setBusy(true); setError('')
      try { await onSave(next, reason.trim()) } catch (err) {
        setError(err instanceof Error ? err.message : String(err)); setBusy(false)
      }
    }} className="foundation-form">
      <Field label="Move to phase">
        <select style={inputStyle} value={next} onChange={event => setNext(event.target.value as ProjectPhase)}>
          {PROJECT_PHASES.map(phase => <option key={phase} value={phase}>{PHASE_META[phase].label}</option>)}
        </select>
      </Field>
      <p className="foundation-hint">{PHASE_META[next].purpose}</p>
      <Field label="Reason for this change">
        <textarea style={inputStyle} rows={3} maxLength={1000} required value={reason} onChange={event => setReason(event.target.value)} placeholder="What changed or became ready?" />
      </Field>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || next === current || !reason.trim()}>{busy ? 'Saving…' : 'Save phase'}</button>
      </div>
    </form>
  </Modal>
}
