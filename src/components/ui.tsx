/*
 * Small presentational primitives shared across screens. These are purely about
 * rendering — they hold no data and never call the database layer.
 */

import { useEffect, useState, type ChangeEventHandler, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { PROJECT_CHANGED_EVENT } from '../data/database'
import type { MaterialStatus, Person, SkillLevel, TaskStatus } from '../data/types'
import { withLoadDeadline } from '../lib/loadDeadline'

/* ─────────────────────────── Icon ─────────────────────────── */

type IconWeight = 'regular' | 'bold' | 'fill'

export function Icon({
  name,
  weight = 'regular',
  size = 16,
  color,
  style,
}: {
  name: string
  weight?: IconWeight
  size?: number
  color?: string
  style?: CSSProperties
}) {
  const weightClass = weight === 'fill' ? 'ph-fill' : weight === 'bold' ? 'ph-bold' : 'ph'
  return <i className={`${weightClass} ph-${name}`} style={{ fontSize: size, color, lineHeight: 1, ...style }} aria-hidden />
}

/* ─────────────────────────── Data loading ─────────────────────────── */

/** Run an async loader and track its result + loading state. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = [], options: { timeoutMs?: number } = {}): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const read = Promise.resolve().then(loader)
    const boundedRead = options.timeoutMs ? withLoadDeadline(read, options.timeoutMs) : read
    boundedRead.then((value) => {
      if (alive) {
        setData(value)
        setLoading(false)
      }
    }).catch((reason: unknown) => {
      if (alive) {
        setData(null)
        setError(reason instanceof Error ? reason : new Error('Could not load data.'))
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error }
}

/**
 * Bumps whenever the active project changes (project switch, first project
 * created) — pass it to useAsync deps so the screen refetches.
 */
export function useProjectVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    window.addEventListener(PROJECT_CHANGED_EVENT, bump)
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, bump)
  }, [])
  return version
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="ui-loading" role="status">
      <Icon name="spinner-gap" size={18} />
      {label}
    </div>
  )
}

/* ─────────────────────────── Avatars ─────────────────────────── */

export function Avatar({ person, size = 27, overlap = false }: { person: Pick<Person, 'initials' | 'color'>; size?: number; overlap?: boolean }) {
  return (
    <div
      title={person.initials}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.39,
        fontWeight: 700,
        flex: '0 0 auto',
        boxShadow: '0 0 0 2px var(--surface)',
        background: person.color,
        marginLeft: overlap ? -9 : 0,
      }}
    >
      {person.initials}
    </div>
  )
}

export function AvatarStack({ people, size = 27, max = 6 }: { people: Pick<Person, 'id' | 'initials' | 'color'>[]; size?: number; max?: number }) {
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <Avatar key={p.id} person={p} size={size} overlap={i > 0} />
      ))}
      {extra > 0 && (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.36,
            fontWeight: 700,
            marginLeft: -9,
            background: 'var(--surface-2)',
            color: 'var(--ink-soft)',
            border: '1px solid var(--line)',
            boxShadow: '0 0 0 2px var(--surface)',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── Progress ─────────────────────────── */

function pctColor(p: number) {
  return p >= 70 ? 'var(--leaf)' : p >= 40 ? 'var(--honey)' : 'var(--clay)'
}

export function ProgressBar({ label, value }: { label?: string; value: number }) {
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>
          <span>{label}</span>
          <span>{value}%</span>
        </div>
      )}
      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(value, 4)}%`, height: '100%', background: pctColor(value), borderRadius: 999, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

export function Ring({ value, size = 46 }: { value: number; size?: number }) {
  const color = value >= 70 ? 'var(--leaf)' : value >= 45 ? 'var(--honey)' : 'var(--clay)'
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        background: `conic-gradient(${color} ${value * 3.6}deg, var(--line) 0)`,
      }}
    >
      <div
        style={{
          width: size - 10,
          height: size - 10,
          borderRadius: '50%',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.27,
          fontWeight: 800,
          color,
        }}
      >
        {value}%
      </div>
    </div>
  )
}

/* ─────────────────────────── Status / skill / material pills ─────────────────────────── */

const STATUS_META: Record<TaskStatus, { label: string; icon: string; color: string; bg: string }> = {
  done: { label: 'Done', icon: 'check-circle', color: 'var(--leaf)', bg: 'var(--leaf-bg)' },
  doing: { label: 'In progress', icon: 'circle-half', color: '#9A6313', bg: 'var(--honey-bg)' },
  blocked: { label: 'Blocked', icon: 'warning', color: 'var(--clay)', bg: 'var(--clay-bg)' },
  todo: { label: 'Not started', icon: 'circle-dashed', color: 'var(--ink-soft)', bg: '#EEE9DC' },
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status]
  return (
    <span className="pill" style={{ color: m.color, background: m.bg }}>
      <Icon name={m.icon} size={13} /> {m.label}
    </span>
  )
}

export function statusCheck(status: TaskStatus): { icon: string; color: string } {
  switch (status) {
    case 'done':
      return { icon: 'check-circle', color: 'var(--leaf)' }
    case 'doing':
      return { icon: 'circle-half', color: 'var(--honey)' }
    case 'blocked':
      return { icon: 'x-circle', color: 'var(--clay)' }
    default:
      return { icon: 'circle', color: 'var(--ink-faint)' }
  }
}

const SKILL_META: Record<SkillLevel, { label: string; icon: string; color: string; bg: string }> = {
  novice: { label: 'Anyone', icon: 'hand-heart', color: 'var(--leaf)', bg: 'var(--leaf-bg)' },
  intermediate: { label: 'Some skill', icon: 'wrench', color: '#9A6313', bg: 'var(--honey-bg)' },
  expert: { label: 'Skilled', icon: 'medal', color: 'var(--clay)', bg: 'var(--clay-bg)' },
}

export function SkillPill({ level }: { level: SkillLevel }) {
  const m = SKILL_META[level]
  return (
    <span className="pill" style={{ color: m.color, background: m.bg }}>
      <Icon name={m.icon} size={13} /> {m.label}
    </span>
  )
}

export function skillDotColor(level: SkillLevel) {
  return { expert: 'var(--clay)', intermediate: 'var(--honey)', novice: 'var(--leaf)' }[level]
}

const MATERIAL_META: Record<MaterialStatus, { label: string; color: string; bg: string }> = {
  needed: { label: 'Needed', color: 'var(--clay)', bg: 'var(--clay-bg)' },
  ordered: { label: 'Ordered', color: '#9A6313', bg: 'var(--honey-bg)' },
  delivered: { label: 'Got it', color: 'var(--leaf)', bg: 'var(--leaf-bg)' },
  backorder: { label: 'Back-order', color: 'var(--clay)', bg: 'var(--clay-bg)' },
}

export function MaterialPill({ status }: { status: MaterialStatus }) {
  const m = MATERIAL_META[status]
  return <span className="pill" style={{ color: m.color, background: m.bg }}>{m.label}</span>
}

/* ─────────────────────────── Layout helpers ─────────────────────────── */

/** Density is owned by theme tokens; callers supply content, not card padding. */
export function Panel({ as: Tag = 'div', className = '', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' }) {
  return <Tag className={`card ui-panel ${className}`} {...props} />
}

export function List({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-list ${className}`} {...props} />
}

export function ListItem({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={`ui-list-item ${className}`} {...props} />
}

export function SummaryRow({ leading, children, trailing }: { leading?: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return <div className="ui-summary-row">{leading && <div className="ui-row-leading">{leading}</div>}<div className="ui-row-content">{children}</div>{trailing && <div className="ui-row-trailing">{trailing}</div>}</div>
}

export function ChecklistRow({ checked, onChange, children, trailing }: { checked: boolean; onChange: ChangeEventHandler<HTMLInputElement>; children: ReactNode; trailing?: ReactNode }) {
  return <label className="ui-checklist-row"><input type="checkbox" checked={checked} onChange={onChange} /><div className="ui-row-content">{children}</div>{trailing && <div className="ui-checklist-trailing">{trailing}</div>}</label>
}

export function SectionTitle({ icon, color, children, action }: { icon?: string; color?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-section-title">
      <div>
        {icon && <Icon name={icon} weight="fill" size={17} color={color} />}
        {children}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="ui-empty">
      <Icon name={icon} size={20} color="var(--ink-soft)" />
      <div><strong>{title}</strong><p>{hint}</p></div>
    </div>
  )
}
