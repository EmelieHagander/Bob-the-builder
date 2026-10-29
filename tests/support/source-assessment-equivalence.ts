// Database load relief (20261029190000): the slim source assessments must
// return exactly what the full originals return. Call this at a fixture's
// interesting states; it compares every artifact revision as a project member.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { PGlite } from './pglite.ts'
import { asProjectUser } from './project-schema.ts'

export const PRE_RELIEF_DRAWINGS = 'artifact_source_assessment_before_construction_drawings_pre_relief'

/** The construction-drawings assessment as 20261021133800 installed it, under a test name. */
export async function preReliefConstructionDrawingsSql(name = PRE_RELIEF_DRAWINGS) {
  const text = await readFile(new URL('../../supabase/migrations/20261021133800_bounded_construction_source_assessment.sql', import.meta.url), 'utf8')
  const head = 'create or replace function bob_private.artifact_source_assessment_before_construction_drawings('
  const start = text.indexOf(head), end = text.indexOf('end $$;', start)
  assert.ok(start >= 0 && end > start, 'pre-relief definition found')
  return text.slice(start, end + 'end $$;'.length).replace(head, `create or replace function bob_private.${name}(`)
}

const result = (fn: string) => `(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from bob_private.${fn}($1,$2::uuid,$3) x)`

export interface Equivalence { revisions: number; slim: number; states: string[] }

export async function assertSourceAssessmentEquivalent(pg: PGlite, label = 'fixture'): Promise<Equivalence> {
  await pg.exec(await preReliefConstructionDrawingsSql())
  // The same condition the dispatching before_physical uses for its slim form.
  const targets = (await pg.query<{ project_id: string; artifact_id: string; revision: number; uid: string | null; slim: boolean }>(`
   select r.project_id,r.artifact_id::text,r.revision,
    (select u.id::text from auth.users u where bob_private.project_access_for_user(r.project_id,u.id) order by u.id limit 1) uid,
    (h.has_multifloor_plan is false and h.has_stair_study is false
     and not exists(select 1 from bob.artifact_generations x where x.artifact_id=r.artifact_id and x.artifact_revision=r.revision)
     and not exists(select 1 from bob.artifact_room_layouts x where x.artifact_id=r.artifact_id and x.artifact_revision=r.revision)
     and not exists(select 1 from bob.artifact_multifloor_plans x where x.artifact_id=r.artifact_id and x.artifact_revision=r.revision)
     and not exists(select 1 from bob.artifact_stair_studies x where x.artifact_id=r.artifact_id and x.artifact_revision=r.revision)) slim
   from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
   order by 1,2,3`)).rows
  const sql = `select ${result('artifact_source_assessment_before_physical')} physical,
   ${result('artifact_source_assessment_before_physical_full')} physical_full,
   ${result('artifact_source_assessment_before_parameters')} parameters,
   ${result('artifact_source_assessment_before_parameters_full')} parameters_full,
   ${result('artifact_source_assessment_before_construction_drawings')} drawings,
   ${result(PRE_RELIEF_DRAWINGS)} drawings_pre_relief`
  const states = new Set<string>()
  for (const t of targets) {
    const args = [t.project_id, t.artifact_id, t.revision]
    // Members see what the runtime sees; a revision without one runs as owner.
    const row = (t.uid ? await asProjectUser(pg, t.uid, sql, args) : await pg.query<any>(sql, args)).rows[0] as Record<string, any[]>
    const at = `${label}: ${t.artifact_id} r${t.revision}${t.slim ? ' (slim)' : ''}`
    assert.equal(JSON.stringify(row.physical), JSON.stringify(row.physical_full), at + ' before_physical')
    assert.equal(JSON.stringify(row.parameters), JSON.stringify(row.parameters_full), at + ' before_parameters')
    assert.equal(JSON.stringify(row.drawings), JSON.stringify(row.drawings_pre_relief), at + ' before_construction_drawings')
    for (const r of [...row.physical, ...row.drawings]) states.add(r.source_state + ':' + r.source_reasons.join(','))
  }
  return { revisions: targets.length, slim: targets.filter(t => t.slim).length, states: [...states].sort() }
}
