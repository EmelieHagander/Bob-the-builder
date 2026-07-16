/*
 * Create/edit modals for project content — areas, tasks, materials, events,
 * meals, food items, people, assignees, reference images. Each one talks to
 * the database layer and calls onDone() so the opening screen can refetch.
 * Passing an existing entity switches a modal to edit mode, which also offers
 * delete (with an inline "really?" confirm).
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import * as db from '../data/database'
import type { Area, BuildEvent, Material, Meal, Person, Skill, SkillLevel, Task } from '../data/types'
import { Avatar, Icon } from './ui'
import { Modal } from './Modal'
import { Field, FormError, inputStyle } from './form'

/** Shared submit wrapper: busy flag + error banner + close on success. */
function useSubmit(action: () => Promise<unknown>, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    task()
      .then(onDone)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    run(action)
  }
  return { busy, error, submit, run }
}

/** Left-aligned danger button that asks once before deleting. */
function DeleteButton({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm: () => void }) {
  const [arming, setArming] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={() => (arming ? onConfirm() : setArming(true))}
      style={{ marginRight: 'auto', color: 'var(--clay)', fontWeight: arming ? 800 : 600 }}
    >
      <Icon name="trash" size={14} /> {arming ? 'Really delete?' : label}
    </button>
  )
}

function Actions({
  busy,
  onClose,
  label,
  deleteLabel,
  onDelete,
}: {
  busy: boolean
  onClose: () => void
  label: string
  deleteLabel?: string
  onDelete?: () => void
}) {
  return (
    <div className="cluster" style={{ justifyContent: 'flex-end' }}>
      {onDelete && deleteLabel && <DeleteButton label={deleteLabel} busy={busy} onConfirm={onDelete} />}
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

/** Icon-swatch picker used by areas and meals. */
function IconPicker({ icons, value, onPick }: { icons: string[]; value: string; onPick: (icon: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {icons.map((i) => (
        <button
          key={i}
          type="button"
          className="btn"
          onClick={() => onPick(i)}
          aria-label={i}
          style={{ padding: 9, border: value === i ? '2px solid var(--accent)' : '1px solid var(--line)' }}
        >
          <Icon name={i} size={18} color="var(--brand)" />
        </button>
      ))}
    </div>
  )
}

/* ─────────────────────────── Area ─────────────────────────── */

const AREA_ICONS = ['hammer', 'cooking-pot', 'house-line', 'fire', 'plant', 'stairs', 'park', 'wall', 'bathtub', 'garage', 'lightning', 'paint-roller']

export function AreaModal({ people, area, onClose, onDone }: { people: Person[]; area?: Area; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(area?.name ?? '')
  const [description, setDescription] = useState(area?.description ?? '')
  const [icon, setIcon] = useState(area?.icon ?? 'hammer')
  const [leadId, setLeadId] = useState(area?.leadId ?? '')
  const { busy, error, submit, run } = useSubmit(
    () =>
      area
        ? db.updateArea(area.id, { name: name.trim(), description: description.trim(), icon, leadId: leadId || null })
        : db.createArea({ name: name.trim(), description: description.trim(), icon, leadId: leadId || null }),
    onDone,
  )

  return (
    <Modal title={area ? `Edit ${area.name}` : 'Add area'} onClose={onClose}>
      <FormShell onSubmit={submit}>
        <Field label="Area name *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Köket" autoFocus required />
        </Field>
        <Field label="What happens here?">
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A one-sentence description" />
        </Field>
        <Field label="Icon">
          <IconPicker icons={AREA_ICONS} value={icon} onPick={setIcon} />
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
        {area && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: 0 }}>
            Deleting an area removes its tasks and materials too.
          </p>
        )}
        {error && <FormError>{error}</FormError>}
        <Actions
          busy={busy}
          onClose={onClose}
          label={area ? 'Save area' : 'Add area'}
          deleteLabel={area ? 'Delete area' : undefined}
          onDelete={area ? () => run(() => db.deleteArea(area.id)) : undefined}
        />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Task ─────────────────────────── */

const SKILLS: { level: SkillLevel; label: string }[] = [
  { level: 'novice', label: 'Anyone' },
  { level: 'intermediate', label: 'Some skill' },
  { level: 'expert', label: 'Skilled' },
]

export function TaskModal({
  areas,
  areaId: fixedAreaId,
  task,
  onClose,
  onDone,
}: {
  areas: Area[]
  /** lock the task to this area (area detail); omit to let the user pick */
  areaId?: string
  task?: Task
  onClose: () => void
  onDone: () => void
}) {
  const [areaId, setAreaId] = useState(task?.areaId ?? fixedAreaId ?? areas[0]?.id ?? '')
  const [name, setName] = useState(task?.name ?? '')
  const [skill, setSkill] = useState<SkillLevel>(task?.skill ?? 'novice')
  const [hours, setHours] = useState(task?.hours ?? '')
  const { busy, error, submit, run } = useSubmit(
    () =>
      task
        ? db.updateTask(task.id, { name: name.trim(), skill, hours: hours.trim() || '1h' })
        : db.createTask({ areaId, name: name.trim(), skill, hours: hours.trim() || '1h' }),
    onDone,
  )

  return (
    <Modal title={task ? 'Edit task' : 'Add task'} onClose={onClose}>
      <FormShell onSubmit={submit}>
        {!fixedAreaId && !task && (
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
        <Actions
          busy={busy}
          onClose={onClose}
          label={task ? 'Save task' : 'Add task'}
          deleteLabel={task ? 'Delete task' : undefined}
          onDelete={task ? () => run(() => db.deleteTask(task.id)) : undefined}
        />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Material ─────────────────────────── */

export function MaterialModal({
  areas,
  categories,
  defaultArea,
  material,
  onClose,
  onDone,
}: {
  areas: Area[]
  /** existing category names, offered as datalist suggestions */
  categories: string[]
  defaultArea?: string
  material?: Material
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState(material?.name ?? '')
  const [qty, setQty] = useState(material?.qty ?? '')
  const [area, setArea] = useState(material?.area ?? defaultArea ?? 'Several')
  const [supplier, setSupplier] = useState(material?.supplier ?? '')
  const [cost, setCost] = useState(material?.cost ?? '')
  const [category, setCategory] = useState(material?.category ?? categories[0] ?? '')
  const fields = () => ({
    name: name.trim(),
    qty: qty.trim(),
    area,
    supplier: supplier.trim(),
    cost: cost.trim(),
    category: category.trim(),
  })
  const { busy, error, submit, run } = useSubmit(
    () => (material ? db.updateMaterial(material.id, fields()) : db.createMaterial(fields())),
    onDone,
  )

  return (
    <Modal title={material ? 'Edit material' : 'Add material'} onClose={onClose}>
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
              {/* keep an edited material's label selectable even if its area is gone */}
              {material && material.area !== 'Several' && !areas.some((a) => a.name === material.area) && (
                <option value={material.area}>{material.area}</option>
              )}
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
        <Actions
          busy={busy}
          onClose={onClose}
          label={material ? 'Save material' : 'Add to shopping list'}
          deleteLabel={material ? 'Delete' : undefined}
          onDelete={material ? () => run(() => db.deleteMaterial(material.id)) : undefined}
        />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Event ─────────────────────────── */

export function EventModal({ event, onClose, onDone }: { event?: BuildEvent; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(event?.title ?? '')
  const [day, setDay] = useState(event?.day ?? '')
  const [time, setTime] = useState(event?.time ?? '')
  const [place, setPlace] = useState(event?.place ?? '')
  const [capacity, setCapacity] = useState(event ? event.spots.split('/')[1]?.trim() || '10' : '10')
  const [food, setFood] = useState(event?.food ?? '')
  const fields = () => ({
    title: title.trim(),
    day: day.trim(),
    time: time.trim(),
    place: place.trim(),
    capacity: Math.max(1, parseInt(capacity, 10) || 10),
    food: food.trim(),
  })
  const { busy, error, submit, run } = useSubmit(
    () => (event ? db.updateEvent(event.id, fields()) : db.createEvent(fields())),
    onDone,
  )

  return (
    <Modal title={event ? 'Edit event' : 'New build event'} onClose={onClose}>
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
        <Actions
          busy={busy}
          onClose={onClose}
          label={event ? 'Save event' : 'Create event'}
          deleteLabel={event ? 'Delete event' : undefined}
          onDelete={event ? () => run(() => db.deleteEvent(event.id)) : undefined}
        />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Meal ─────────────────────────── */

const MEAL_ICONS = ['coffee', 'cooking-pot', 'cookie', 'fire', 'bowl-food', 'pizza', 'hamburger', 'orange-slice']

export function MealModal({ meal, onClose, onDone }: { meal?: Meal; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(meal?.meal ?? '')
  const [time, setTime] = useState(meal?.time ?? '')
  const [icon, setIcon] = useState(meal?.icon ?? 'cooking-pot')
  const [dish, setDish] = useState(meal?.dish ?? '')
  const [notes, setNotes] = useState(meal?.notes ?? '')
  const fields = () => ({ meal: name.trim(), time: time.trim(), icon, dish: dish.trim(), notes: notes.trim() })
  const { busy, error, submit, run } = useSubmit(
    () => (meal ? db.updateMeal(meal.id, fields()) : db.createMeal(fields())),
    onDone,
  )

  return (
    <Modal title={meal ? `Edit ${meal.meal}` : 'Add meal'} onClose={onClose}>
      <FormShell onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Meal *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lunch" autoFocus required />
          </Field>
          <Field label="Time">
            <input style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} placeholder="12:30" />
          </Field>
        </div>
        <Field label="Dish *">
          <input style={inputStyle} value={dish} onChange={(e) => setDish(e.target.value)} placeholder="Köttbullar & potatis" required />
        </Field>
        <Field label="Notes (allergies, alternatives)">
          <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Veg: halloumi · GF gravy set aside" />
        </Field>
        <Field label="Icon">
          <IconPicker icons={MEAL_ICONS} value={icon} onPick={setIcon} />
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions
          busy={busy}
          onClose={onClose}
          label={meal ? 'Save meal' : 'Add meal'}
          deleteLabel={meal ? 'Delete meal' : undefined}
          onDelete={meal ? () => run(() => db.deleteMeal(meal.id)) : undefined}
        />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Food shopping item ─────────────────────────── */

export function FoodItemModal({ categories, onClose, onDone }: { categories: string[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState(categories[0] ?? '')
  const { busy, error, submit } = useSubmit(
    () => db.createFoodItem({ category: category.trim(), name: name.trim(), qty: qty.trim(), note: note.trim() }),
    onDone,
  )

  return (
    <Modal title="Add to food shopping" onClose={onClose}>
      <FormShell onSubmit={submit}>
        <Field label="Item *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Potatis" autoFocus required />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Quantity">
            <input style={inputStyle} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="4 kg" />
          </Field>
          <Field label="Category">
            <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Fresh & veg" list="food-categories" />
            <datalist id="food-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Note (allergy flags etc.)">
          <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="3 GF set aside" />
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions busy={busy} onClose={onClose} label="Add item" />
      </FormShell>
    </Modal>
  )
}

/* ─────────────────────────── Person ─────────────────────────── */

export function PersonModal({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState(person.role)
  const [diet, setDiet] = useState(person.diet)
  const [skills, setSkills] = useState<Skill[]>(person.skills.map((s) => ({ ...s })))
  const [newSkill, setNewSkill] = useState('')
  const [newLevel, setNewLevel] = useState<SkillLevel>('novice')
  const { busy, error, submit, run } = useSubmit(
    () => db.updatePerson(person.id, { role: role.trim() || 'Volunteer', diet: diet.trim() || 'No restrictions', skills }),
    onDone,
  )

  const addSkill = () => {
    const name = newSkill.trim()
    if (!name || skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return
    setSkills((list) => [...list, { name, level: newLevel }])
    setNewSkill('')
  }

  return (
    <Modal title={person.name} onClose={onClose}>
      <FormShell onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Role">
            <input style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Volunteer" />
          </Field>
          <Field label="Diet">
            <input style={inputStyle} value={diet} onChange={(e) => setDiet(e.target.value)} placeholder="No restrictions" />
          </Field>
        </div>
        <Field label="Skills">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {skills.length === 0 && <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>None listed yet.</span>}
            {skills.map((s) => (
              <span key={s.name} className="pill" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {s.name} · {s.level}
                <button
                  type="button"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => setSkills((list) => list.filter((x) => x.name !== s.name))}
                  style={{ background: 'none', border: 'none', padding: 0, display: 'flex', color: 'var(--clay)' }}
                >
                  <Icon name="x" weight="bold" size={11} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              placeholder="Carpentry"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSkill()
                }
              }}
            />
            <select style={{ ...inputStyle, width: 130, appearance: 'auto' }} value={newLevel} onChange={(e) => setNewLevel(e.target.value as SkillLevel)}>
              <option value="novice">novice</option>
              <option value="intermediate">intermediate</option>
              <option value="expert">expert</option>
            </select>
            <button type="button" className="btn" onClick={addSkill}>
              Add
            </button>
          </div>
        </Field>
        {error && <FormError>{error}</FormError>}
        <Actions
          busy={busy}
          onClose={onClose}
          label="Save"
          deleteLabel="Remove from crew"
          onDelete={() => run(() => db.deletePerson(person.id))}
        />
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
