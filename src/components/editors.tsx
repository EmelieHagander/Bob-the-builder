/*
 * Create/edit modals for project content — areas, tasks, materials, events,
 * assignees, reference images. Each one talks to the database layer and calls
 * onDone() so the opening screen can refetch. They share the Modal shell and
 * form primitives, exactly like the account-level modals.
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import * as db from '../data/database'
import type { Area, Person, SkillLevel, Task } from '../data/types'
import { Avatar, Icon } from './ui'
import { Modal } from './Modal'
import { Field, FormError, inputStyle } from './form'

/** Shared submit wrapper: busy flag + error banner + close on success. */
function useSubmit(action: () => Promise<unknown>, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    action()
      .then(onDone)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      })
  }
  return { busy, error, submit }
}

function Actions({ busy, onClose, label }: { busy: boolean; onClose: () => void; label: string }) {
  return (
    <div className="cluster" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="btn" onClick={onClose} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  )
}

function FormShell({ onSubmit, children }: { onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {children}
    </form>
  )
}

/* ─────────────────────────── New area ─────────────────────────── */

const AREA_ICONS = ['hammer', 'cooking-pot', 'house-line', 'fire', 'plant', 'stairs', 'park', 'wall', 'bathtub', 'garage', 'lightning', 'paint-roller']

export function NewAreaModal({ people, onClose, onDone }: { people: Person[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('hammer')
  const [leadId, setLeadId] = useState('')
  const { busy, error, submit } = useSubmit(
    () => db.createArea({ name: name.trim(), description: description.trim(), icon, leadId: leadId || null }),
    onDone,
  )

  return (
    <Modal title="Add area" onClose={onClose}>
      <FormShell onSubmit={submit}>
        <Field label="Area name *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Köket" autoFocus required />
        </Field>
        <Field label="What happens here?">
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A one-sentence description" />
        </Field>
        <Field label="Icon">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AREA_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                className="btn"
                onClick={() => setIcon(i)}
                aria-label={i}
                style={{ padding: 9, border: icon === i ? '2px solid var(--accent)' : '1px solid var(--line)' }}
              >
                <Icon name={i} size={18} color="var(--brand)" />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Lead">
          <select style={{ ...inputStyle, appearance: 'auto' }} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Add area" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── New task ─────────────────────────── */

const SKILLS: { level: SkillLevel; label: string }[] = [
  { level: 'novice', label: 'Anyone' },
  { level: 'intermediate', label: 'Some skill' },
  { level: 'expert', label: 'Skilled' },
]

export function NewTaskModal({
  areas,
  areaId: fixedAreaId,
  onClose,
  onDone,
}: {
  areas: Area[]
  /** lock the task to this area (area detail); omit to let the user pick */
  areaId?: string
  onClose: () => void
  onDone: () => void
}) {
  const [areaId, setAreaId] = useState(fixedAreaId ?? areas[0]?.id ?? '')
  const [name, setName] = useState('')
  const [skill, setSkill] = useState<SkillLevel>('novice')
  const [hours, setHours] = useState('')
  const { busy, error, submit } = useSubmit(
    () => db.createTask({ areaId, name: name.trim(), skill, hours: hours.trim() || '1h' }),
    onDone,
  )

  return (
    <Modal title="Add task" onClose={onClose}>
      <FormShell onSubmit={submit}>
        {!fixedAreaId && (
          <Field label="Area *">
            <select style={{ ...inputStyle, appearance: 'auto' }} value={areaId} onChange={(e) => setAreaId(e.target.value)} required>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Task *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Paint walls — 2 coats" autoFocus required />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Skill needed">
            <select style={{ ...inputStyle, appearance: 'auto' }} value={skill} onChange={(e) => setSkill(e.target.value as SkillLevel)}>
              {SKILLS.map((s) => (
                <option key={s.level} value={s.level}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estimated time">
            <input style={inputStyle} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="3h" />
          </Field>
        </div>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Add task" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── New material ─────────────────────────── */

export function NewMaterialModal({
  areas,
  categories,
  defaultArea,
  onClose,
  onDone,
}: {
  areas: Area[]
  /** existing category names, offered as datalist suggestions */
  categories: string[]
  defaultArea?: string
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [area, setArea] = useState(defaultArea ?? 'Several')
  const [supplier, setSupplier] = useState('')
  const [cost, setCost] = useState('')
  const [category, setCategory] = useState(categories[0] ?? '')
  const { busy, error, submit } = useSubmit(
    () =>
      db.createMaterial({
        name: name.trim(),
        qty: qty.trim(),
        area,
        supplier: supplier.trim(),
        cost: cost.trim(),
        category: category.trim(),
      }),
    onDone,
  )

  return (
    <Modal title="Add material" onClose={onClose}>
      <FormShell onSubmit={submit}>
        <Field label="Material *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pine board 22×95mm" autoFocus required />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Quantity">
            <input style={inputStyle} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="48 st" />
          </Field>
          <Field label="Est. cost">
            <input style={inputStyle} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="1 920 kr" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Area">
            <select style={{ ...inputStyle, appearance: 'auto' }} value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="Several">Several</option>
              {areas.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier">
            <input style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Beijer" />
          </Field>
        </div>
        <Field label="Category">
          <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Timber" list="material-categories" />
          <datalist id="material-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Add to shopping list" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── New event ─────────────────────────── */

export function NewEventModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [place, setPlace] = useState('')
  const [capacity, setCapacity] = useState('10')
  const [food, setFood] = useState('')
  const { busy, error, submit } = useSubmit(
    () =>
      db.createEvent({
        title: title.trim(),
        day: day.trim(),
        time: time.trim(),
        place: place.trim(),
        capacity: Math.max(1, parseInt(capacity, 10) || 10),
        food: food.trim(),
      }),
    onDone,
  )

  return (
    <Modal title="New build event" onClose={onClose}>
      <FormShell onSubmit={submit}>
        <Field label="Title *">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Råbygge — walls & roof" autoFocus required />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Day *">
            <input style={inputStyle} value={day} onChange={(e) => setDay(e.target.value)} placeholder="Sat 5 Jul" required />
          </Field>
          <Field label="Time">
            <input style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} placeholder="09:00–16:00" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Place">
            <input style={inputStyle} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Skogsstuga, Dalarna" />
          </Field>
          <Field label="Spots">
            <input style={inputStyle} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <Field label="Food plan">
          <input style={inputStyle} value={food} onChange={(e) => setFood(e.target.value)} placeholder="Lunch 12:30 — soup & bread" />
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Create event" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Assign people to a task ─────────────────────────── */

export function AssignModal({ task, people, onClose, onDone }: { task: Task; people: Person[]; onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(task.assigneeIds))
  const { busy, error, submit } = useSubmit(() => db.setTaskAssignees(task.id, [...selected]), onDone)

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Modal title={`Who's on "${task.name}"?`} onClose={onClose}>
      <FormShell onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {people.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>Nobody on the crew yet — invite people first.</div>}
          {people.map((p) => {
            const on = selected.has(p.id)
            return (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 6px', borderRadius: 10, cursor: 'pointer', background: on ? 'var(--surface-2)' : 'transparent' }}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ display: 'none' }} />
                <Icon name={on ? 'check-square' : 'square'} weight={on ? 'fill' : 'regular'} size={20} color={on ? 'var(--leaf)' : 'var(--ink-faint)'} />
                <Avatar person={p} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{p.role}</div>
                </div>
              </label>
            )
          })}
        </div>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Save crew" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Reference image label ─────────────────────────── */

export function AddImageModal({ areaId, onClose, onDone }: { areaId: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState('')
  const { busy, error, submit } = useSubmit(() => db.addReferenceImage(areaId, label.trim()), onDone)

  return (
    <Modal title="Add reference image" onClose={onClose}>
      <FormShell onSubmit={submit}>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45, margin: 0 }}>
          v1 keeps a labelled placeholder — real uploads come later. Name the finish or detail it should show.
        </p>
        <Field label="Label *">
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="oak flooring" autoFocus required />
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Add" />
      </FormShell>
    </Modal>
  )
}
