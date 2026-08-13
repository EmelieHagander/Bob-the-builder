/*
 * bob-context.ts — a compact snapshot of the build, for the AI to reason over.
 *
 * "He keeps the whole build in his head" is bob's promise, so an assistant
 * that knows nothing about the project would be a hollow version of him. This
 * module reads the live tables and renders them as a short briefing.
 *
 * Two rules shape it:
 *
 *   • It queries with the CALLER'S client (their JWT), never the service-role
 *     key. RLS decides what the snapshot can contain, so a user can never
 *     reach a project they aren't a member of by asking bob nicely.
 *   • It is bounded. Every list is capped and only the columns that matter
 *     are selected — the briefing rides along on every question, so it stays
 *     small on purpose rather than dumping the database into the prompt.
 *
 * On any read failure it degrades to whatever it did manage to load; a
 * partial briefing is better than no answer, and the caller is told when
 * there is no project at all.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Caps — keep the briefing small enough to ride on every question. */
const MAX_AREAS = 20
const MAX_TASKS = 40
const MAX_MATERIALS = 30
const MAX_EVENTS = 5
const MAX_PEOPLE = 40

export interface BuildContext {
  /** The rendered briefing, or null when the caller has no project at all. */
  briefing: string | null
  projectName?: string
}

/** Renders `label: value` lines, skipping empties, for a tidy prompt. */
function line(label: string, value: string): string | null {
  const v = value.trim()
  return v ? `${label}: ${v}` : null
}

export async function buildContext(supabase: SupabaseClient): Promise<BuildContext> {
  // The project is the anchor — without one there is nothing to brief on.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, location, type, start_label')
    .limit(1)

  const project = projects?.[0]
  if (!project) return { briefing: null }

  const projectId = project.id as string

  // Everything else in parallel — one round-trip's worth of latency, not six.
  const [areasRes, materialsRes, eventsRes, peopleRes] = await Promise.all([
    supabase
      .from('areas')
      .select('id, name, description, assigned_pct, materials_pct, done_pct, task_summary')
      .eq('project_id', projectId)
      .limit(MAX_AREAS),
    supabase
      .from('materials')
      .select('name, qty, area_label, supplier, status, cost, category')
      .eq('project_id', projectId)
      .limit(MAX_MATERIALS),
    supabase
      .from('events')
      .select('title, day, time, place, spots, status, food')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .limit(MAX_EVENTS),
    supabase
      .from('people')
      .select('name, role, diet')
      .eq('project_id', projectId)
      .limit(MAX_PEOPLE),
  ])

  const areas = areasRes.data ?? []

  // Tasks hang off areas, so they need the area ids first.
  let tasks: Record<string, unknown>[] = []
  if (areas.length > 0) {
    const { data } = await supabase
      .from('tasks')
      .select('name, skill, hours, status, materials, area_id')
      .in('area_id', areas.map((a) => a.id as string))
      .limit(MAX_TASKS)
    tasks = data ?? []
  }

  const areaName = new Map(areas.map((a) => [a.id as string, a.name as string]))
  const parts: string[] = []

  parts.push(
    [
      'PROJECT',
      line('Name', String(project.name ?? '')),
      line('What it is', String(project.description ?? '')),
      line('Location', String(project.location ?? '')),
      line('Type', String(project.type ?? '')),
      line('Starts', String(project.start_label ?? '')),
    ]
      .filter(Boolean)
      .join('\n'),
  )

  if (areas.length > 0) {
    parts.push(
      'AREAS (progress in %)\n' +
        areas
          .map((a) => {
            const bits = [
              `assigned ${a.assigned_pct ?? 0}%`,
              `materials ${a.materials_pct ?? 0}%`,
              `done ${a.done_pct ?? 0}%`,
            ]
            const summary = String(a.task_summary ?? '').trim()
            return `- ${a.name} — ${bits.join(', ')}${summary ? ` (${summary})` : ''}`
          })
          .join('\n'),
    )
  }

  if (tasks.length > 0) {
    // Blocked first: it is what someone asking "what's blocking us?" wants.
    const order = { blocked: 0, doing: 1, todo: 2, done: 3 } as Record<string, number>
    const sorted = [...tasks].sort(
      (a, b) => (order[String(a.status)] ?? 9) - (order[String(b.status)] ?? 9),
    )
    parts.push(
      'TASKS\n' +
        sorted
          .map((t) => {
            const where = areaName.get(String(t.area_id)) ?? 'unknown area'
            const hours = String(t.hours ?? '').trim()
            const mats = String(t.materials ?? '').trim()
            const extra = [hours && `~${hours}`, mats && `materials ${mats}`]
              .filter(Boolean)
              .join(', ')
            return `- [${t.status}] ${t.name} — ${where}, ${t.skill}${extra ? `, ${extra}` : ''}`
          })
          .join('\n'),
    )
  }

  const materials = materialsRes.data ?? []
  if (materials.length > 0) {
    parts.push(
      'MATERIALS\n' +
        materials
          .map((m) => {
            const bits = [
              String(m.qty ?? '').trim(),
              String(m.area_label ?? '').trim(),
              String(m.supplier ?? '').trim(),
              String(m.cost ?? '').trim(),
            ].filter(Boolean)
            return `- [${m.status}] ${m.name}${bits.length ? ` — ${bits.join(', ')}` : ''}`
          })
          .join('\n'),
    )
  }

  const events = eventsRes.data ?? []
  if (events.length > 0) {
    parts.push(
      'BUILD DAYS (soonest first)\n' +
        events
          .map((e) => {
            const bits = [
              String(e.day ?? '').trim(),
              String(e.time ?? '').trim(),
              String(e.place ?? '').trim(),
              `${e.spots} signed up`,
              String(e.food ?? '').trim() && `food: ${e.food}`,
            ].filter(Boolean)
            return `- ${e.title} [${e.status}] — ${bits.join(', ')}`
          })
          .join('\n'),
    )
  }

  const people = peopleRes.data ?? []
  if (people.length > 0) {
    const diets = people
      .map((p) => String(p.diet ?? '').trim())
      .filter((d) => d && d.toLowerCase() !== 'no restrictions')
    parts.push(
      `PEOPLE (${people.length})\n` +
        people.map((p) => `- ${p.name} — ${p.role}`).join('\n') +
        (diets.length > 0 ? `\nDietary needs to cater for: ${diets.join('; ')}` : ''),
    )
  }

  return { briefing: parts.join('\n\n'), projectName: String(project.name ?? '') }
}
