import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOB_SCREEN_SURFACES, parseBobScreen, type BobScreenPointer } from '../src/domain/bobScreen.ts'
import { createCurrentViewReader, hydrateCurrentView, contextChanged, type CurrentViewReader, type CurrentViewClient } from '../supabase/functions/_shared/current-view.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

function fixture(overrides: Partial<CurrentViewReader> = {}) {
  const calls: string[] = []
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, project_id: 'A', name: `Stored ${id}`, updated_at: '2026-09-30T10:00:00Z', ...extra })
  const reader: CurrentViewReader = {
    project: async id => { calls.push(`project:${id}`); return { id, name: 'Stored Project', updated_at: '2026-09-30T10:00:00Z' } },
    viewer: async p => { calls.push(`viewer:${p}`); return row('personA') },
    area: async (p, id) => { calls.push(`area:${p}:${id}`); return row(id, { archived_at: null }) },
    task: async (p, id) => { calls.push(`task:${p}:${id}`); return row(id, { area_id: 'areaA', primary_step_id: 'planA', status: 'doing', instructions: 'Stored task instructions' }) },
    assignees: async (p, id) => { calls.push(`assignees:${p}:${id}`); return { rows: [], truncated: false } },
    person: async (p, id) => { calls.push(`person:${p}:${id}`); return row(id) },
    planStep: async (p, id) => { calls.push(`planStep:${p}:${id}`); return row(id, { area_id: 'areaA', plan_revision: 3, state: 'active', goal: 'Stored goal', notes: 'Stored brief', responsible_kind: 'bob', responsible_person_id: null }) },
    instruction: async (p, taskId, id) => { calls.push(`instruction:${p}:${taskId}:${id}`); return row(id, { task_id: taskId, revision: 2, title: 'Stored instruction', instructions: 'Stored selected instruction', required: true, completed_at: null }) },
    solution: async (p, id, revision) => { calls.push(`solution:${p}:${id}:${revision}`); return row(id, { area_id: 'areaA', revision, archived: false }) },
    drawing: async (p, id, revision) => { calls.push(`drawing:${p}:${id}:${revision}`); return row(id, { area_id: 'areaA', revision, status: 'concept', archived: false, source_state: 'current', source_reasons: [] }) },
    event: async (p, id) => { calls.push(`event:${p}:${id}`); return row(id, { status: 'open', day: 'Saturday', time: '09:00', place: 'Stored place' }) },
    ...overrides,
  }
  return { reader, calls, row }
}
const hydrate = (screen: BobScreenPointer | null, reader = fixture().reader) => hydrateCurrentView({ projectId: 'A', screen, reader })

test('omitted/null screen is compatible and performs no reads', async () => {
  assert.equal(parseBobScreen(undefined), null)
  assert.equal(parseBobScreen(null), null)
  const { reader, calls } = fixture()
  assert.equal((await hydrate(null, reader)).status, 'unsupported')
  assert.deepEqual(calls, [])
})

test('parser permits all supported surfaces with exact compatible pointers', () => {
  for (const surface of BOB_SCREEN_SURFACES) {
    const ids = surface === 'area' ? { areaId: 'areaA' } : surface === 'task' ? { taskId: 'taskA' } : surface === 'event' ? { eventId: 'eventA' } : {}
    assert.deepEqual(parseBobScreen({ surface, ...ids }), { surface, ...ids })
  }
  assert.deepEqual(parseBobScreen({ surface: 'drawings', artifactId: 'a:1', artifactRevision: 2 }), { surface: 'drawings', artifactId: 'a:1', artifactRevision: 2 })
})

test('parser rejects browser fact text, incompatible fields, ambiguous steps and missing revisions', () => {
  for (const invalid of [[], 'task', {}, Object.create({ surface: 'project' }), Object.assign(Object.create({ areaId: 'x' }), { surface: 'area' }), { surface: 'food' }, { surface: 'area' }, { surface: 'task' }, { surface: 'event' },
    { surface: 'task', taskId: 'x', title: 'Browser fact' }, { surface: 'task', taskId: 'x', stepId: 'ambiguous' },
    { surface: 'people', areaId: 'x' }, { surface: 'project', taskId: 'x' }, { surface: 'facts', instructionId: 'x' },
    { surface: 'drawings', artifactId: 'x' }, { surface: 'solutions', solutionRevision: 2 },
    { surface: 'drawings', artifactId: 'x', artifactRevision: 0 }, { surface: 'solutions', solutionId: 'x', solutionRevision: 1.1 },
    { surface: 'drawings', artifactId: 'x', artifactRevision: 2147483648 }, { surface: 'project', planStepId: null }]) {
    assert.throws(() => parseBobScreen(invalid), /invalid_screen/)
  }
})

test('opaque ids are bounded and exclude whitespace, controls and filter punctuation', () => {
  for (const taskId of ['', 'x'.repeat(201), 'x y', 'x\n', 'x\t', 'x\0', 'x,y', 'x(y)', 'x/y', 'x%20', '💡', '.x', 'x\u202e']) {
    assert.throws(() => parseBobScreen({ surface: 'task', taskId }), /invalid_screen/)
  }
  assert.equal(parseBobScreen({ surface: 'task', taskId: 'x'.repeat(200) })?.taskId.length, 200)
})

test('task hydrates current project/viewer/area/primary Plan Step and distinct instruction', async () => {
  const { reader, calls } = fixture()
  const result = await hydrate({ surface: 'task', taskId: 'taskA', instructionId: 'instructionA' }, reader)
  assert.equal(result.status, 'ok')
  assert.equal(result.project?.name, 'Stored Project')
  assert.equal(result.viewer?.id, 'personA')
  assert.equal(result.focus.area?.id, 'areaA')
  assert.equal(result.focus.planStep?.id, 'planA')
  assert.equal(result.focus.planStep?.planRevision, 3)
  assert.equal(result.focus.instruction?.id, 'instructionA')
  assert.equal(result.focus.instruction?.instructions, 'Stored selected instruction')
  assert.deepEqual(calls, ['project:A', 'viewer:A', 'task:A:taskA', 'area:A:areaA', 'assignees:A:taskA', 'planStep:A:planA', 'instruction:A:taskA:instructionA', 'project:A'])
  assert.equal(result.sources.length, 6)
})

test('project selected Plan Step is scoped and hydrates its own Area', async () => {
  const result = await hydrate({ surface: 'project', planStepId: 'planA' })
  assert.equal(result.status, 'ok')
  assert.equal(result.focus.planStep?.id, 'planA')
  assert.equal(result.focus.area?.id, 'areaA')
})

test('bounded Task assignees and Plan Step responsibility expose identity labels without profiles', async () => {
  const f = fixture()
  f.reader.assignees = async () => ({ rows: [f.row('personA', { task_id: 'taskA', email: 'PRIVATE_EMAIL', diet: 'PRIVATE_DIET' })], truncated: false })
  f.reader.planStep = async () => f.row('planA', { area_id: 'areaA', plan_revision: 3, state: 'active', goal: 'Goal', notes: '', responsible_kind: 'person', responsible_person_id: 'personA' })
  f.reader.person = async () => f.row('personA', { name: 'Stored personA', email: 'PRIVATE_EMAIL', diet: 'PRIVATE_DIET' })
  const result = await hydrate({ surface: 'task', taskId: 'taskA' }, f.reader)
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.focus.task?.assignees, [{ id: 'personA', name: 'Stored personA' }])
  assert.deepEqual(result.focus.planStep?.responsible, { kind: 'person', person: { id: 'personA', name: 'Stored personA' } })
  assert.equal(result.sources.filter(s => s.dataset === 'crew' && s.recordId === 'personA').length, 1)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EMAIL|PRIVATE_DIET|email|diet/)
  const changed = JSON.parse(JSON.stringify(result)); changed.focus.task.assignees = []
  assert.equal(contextChanged(result, changed), true)
})

test('foreign assignment or revoked responsible person discards all Current View facts', async () => {
  const f = fixture()
  f.reader.assignees = async () => ({ rows: [{ id: 'personB', project_id: 'B', task_id: 'taskA', name: 'PRIVATE_B' }], truncated: false })
  const assigned = await hydrate({ surface: 'task', taskId: 'taskA' }, f.reader)
  assert.equal(assigned.status, 'not_found')
  assert.deepEqual(assigned.focus, {})
  assert.doesNotMatch(JSON.stringify(assigned), /PRIVATE_B/)
  const r = fixture()
  r.reader.planStep = async () => r.row('planA', { area_id: 'areaA', plan_revision: 3, state: 'active', goal: 'Goal', notes: '', responsible_kind: 'person', responsible_person_id: 'revokedPerson' })
  r.reader.person = async () => null
  const responsible = await hydrate({ surface: 'project', planStepId: 'planA' }, r.reader)
  assert.equal(responsible.status, 'not_found')
  assert.deepEqual(responsible.focus, {})
  assert.deepEqual(responsible.sources, [])
})

test('all root surfaces hydrate only caller project identity and no arbitrary entities', async () => {
  for (const surface of ['project', 'areas', 'facts', 'solutions', 'drawings', 'people', 'events', 'shopping', 'today', 'announcements', 'building', 'material-plan'] as const) {
    const { reader, calls } = fixture()
    const result = await hydrate({ surface }, reader)
    assert.equal(result.status, 'ok', surface)
    assert.deepEqual(result.focus, {})
    assert.deepEqual(calls, ['project:A', 'viewer:A', 'project:A'])
  }
})

test('foreign/stale requested or derived entities discard all hydrated facts', async () => {
  const variants: [BobScreenPointer, Partial<CurrentViewReader>][] = [
    [{ surface: 'task', taskId: 'taskB' }, { task: async () => ({ id: 'taskB', project_id: 'B', name: 'FOREIGN SECRET' }) }],
    [{ surface: 'area', areaId: 'missing' }, { area: async () => null }],
    [{ surface: 'task', taskId: 'taskA', areaId: 'wrongArea' }, {}],
    [{ surface: 'task', taskId: 'taskA', planStepId: 'wrongStep' }, {}],
    [{ surface: 'task', taskId: 'taskA', instructionId: 'bad' }, { instruction: async () => ({ id: 'bad', project_id: 'A', task_id: 'taskB', title: 'OTHER TASK SECRET' }) }],
    [{ surface: 'task', taskId: 'taskA' }, { planStep: async () => null }],
    [{ surface: 'task', taskId: 'taskA' }, { area: async () => null }],
    [{ surface: 'event', eventId: 'eventB' }, { event: async () => ({ id: 'eventB', project_id: 'B', title: 'FOREIGN SECRET' }) }],
  ]
  for (const [screen, overrides] of variants) {
    const result = await hydrate(screen, fixture(overrides).reader)
    assert.equal(result.status, 'not_found')
    assert.deepEqual(result.focus, {})
    assert.deepEqual(result.sources, [])
    assert.equal(result.project, undefined)
    assert.equal(result.viewer, undefined)
    assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  }
})

test('selected drawing preserves exact historical revision and source-state warnings', async () => {
  const f = fixture()
  f.reader.drawing = async (_p, id, revision) => f.row(id, { revision, area_id: 'areaA', status: 'build_ready', archived: false,
    source_state: 'changed', source_reasons: ['target_changed', 'physical_source_changed'], recipe: { secret: 'do not dump' }, preview_svg: 'do not dump' })
  const result = await hydrate({ surface: 'drawings', artifactId: 'drawingA', artifactRevision: 1 }, f.reader)
  assert.equal(result.focus.drawing?.revision, 1)
  assert.equal(result.focus.drawing?.sourceState, 'changed')
  assert.deepEqual(result.warnings, ['target_changed', 'physical_source_changed'])
  assert.doesNotMatch(JSON.stringify(result), /recipe|preview_svg|do not dump/)
})

test('selected solution preserves exact historical revision; wrong backend revision fails closed', async () => {
  assert.equal((await hydrate({ surface: 'solutions', solutionId: 'solutionA', solutionRevision: 1 })).focus.solution?.revision, 1)
  const f = fixture()
  f.reader.solution = async () => f.row('solutionA', { revision: 2 })
  assert.equal((await hydrate({ surface: 'solutions', solutionId: 'solutionA', solutionRevision: 1 }, f.reader)).status, 'not_found')
})

test('unavailable drawing lineage remains explicit and never claims source current', async () => {
  const f = fixture()
  f.reader.drawing = async (_p, id, revision) => f.row(id, { revision, area_id: null, status: 'measured', archived: false, source_state: 'unavailable', source_reasons: ['source_unavailable'] })
  const result = await hydrate({ surface: 'drawings', artifactId: 'drawingA', artifactRevision: 1 }, f.reader)
  assert.equal(result.focus.drawing?.sourceState, 'unavailable')
  assert.deepEqual(result.warnings, ['source_unavailable'])
})

test('selected entity must match optional Area scope; no fallback to unrelated selection', async () => {
  for (const screen of [{ surface: 'solutions', areaId: 'wrong', solutionId: 'solutionA', solutionRevision: 1 },
    { surface: 'drawings', areaId: 'wrong', artifactId: 'drawingA', artifactRevision: 1 }] as BobScreenPointer[]) {
    assert.equal((await hydrate(screen)).status, 'not_found')
  }
})

test('access revoked during hydration erases the entire view', async () => {
  const f = fixture(); let projectCalls = 0
  f.reader.project = async () => ++projectCalls === 1 ? { id: 'A', name: 'Prior name' } : null
  const result = await hydrate({ surface: 'task', taskId: 'taskA' }, f.reader)
  assert.equal(result.status, 'not_found')
  assert.deepEqual(result.focus, {})
  assert.deepEqual(result.sources, [])
})

test('read errors produce unavailable without raw database error or partial facts', async () => {
  const f = fixture({ instruction: async () => { throw new Error('sql SELECT SECRET email FROM private') } })
  const result = await hydrate({ surface: 'task', taskId: 'taskA', instructionId: 'instructionA' }, f.reader)
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(result.sources, [])
  assert.deepEqual(result.focus, {})
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private|Prior|Stored/)
})

test('compact long instructions have an explicit truncation warning and bounded text', async () => {
  const f = fixture()
  f.reader.task = async () => f.row('taskA', { area_id: null, primary_step_id: null, status: 'todo', instructions: 'x'.repeat(12000) })
  const result = await hydrate({ surface: 'task', taskId: 'taskA' }, f.reader)
  assert.equal(result.focus.task?.instructions.length, 1200)
  assert.deepEqual(result.warnings, ['task_instructions_truncated'])
})

test('freshness comparison ignores read timestamps but detects current content/revision/scope/source changes', async () => {
  const original = await hydrate({ surface: 'task', taskId: 'taskA' })
  const reread = JSON.parse(JSON.stringify(original))
  reread.retrievedAt = 'tomorrow'; reread.sources.forEach((s: any) => { s.retrievedAt = 'tomorrow' })
  assert.equal(contextChanged(original, reread), false)
  for (const change of [(r: any) => r.focus.task.name = 'Changed', (r: any) => r.focus.planStep.planRevision++,
    (r: any) => r.focus.area.id = 'other', (r: any) => r.sources[0].updatedAt = 'new', (r: any) => r.status = 'not_found']) {
    const changed = JSON.parse(JSON.stringify(original)); change(changed)
    assert.equal(contextChanged(original, changed), true)
  }
})

test('journal canonical JSONB roundtrip is equal to fresh hydration before provider and settlement', async () => {
  const entries: JournalEntry[] = []
  const store = { entries, save: async (entry: JournalEntry) => { entries.push(JSON.parse(JSON.stringify(entry))) } }
  const screen = { surface: 'task', taskId: 'taskA' } as const
  const first = createBobJournal(store, Date.now() + 60000)
  const checkpoint = await first.run('current-view', screen, () => hydrate(screen))
  assert.equal(contextChanged(checkpoint, await hydrate(screen)), false)
  const resumed = createBobJournal(store, Date.now() + 60000)
  const replay = await resumed.run('current-view', screen, async () => { throw new Error('must replay') })
  assert.equal(contextChanged(replay, await hydrate(screen)), false)
})

test('caller adapter uses fixed project-scoped narrow queries and exact revision freshness', async () => {
  const reads: { table: string; columns: string; filters: Record<string, unknown>; signal?: AbortSignal }[] = []
  const client: CurrentViewClient = { from(table) { return { select(columns) {
    const read = { table, columns, filters: {} as Record<string, unknown>, signal: undefined as AbortSignal | undefined }; reads.push(read)
    const query = {
      eq(key: string, value: unknown) { read.filters[key] = value; return query },
      abortSignal(signal: AbortSignal) { read.signal = signal; return query }, maybeSingle() { return query },
      order() { return query }, limit() { return query },
      async then(resolve: any, reject: any) {
        let data: Record<string, unknown> = { id: 'drawingA', project_id: 'A', area_id: null, current_revision: 4 }
        if (table === 'artifact_revision_details') data = { artifact_id: 'drawingA', project_id: 'A', revision: 1, title: 'Historical', status: 'concept', archived: false }
        if (table === 'artifact_source_status') data = { project_id: 'A', artifact_id: 'drawingA', revision: 1, source_state: 'changed', source_reasons: ['measurement_changed'] }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return query
  } } } }
  const reader = createCurrentViewReader(client, 'verified-user')
  const drawing = await reader.drawing('A', 'drawingA', 1)
  assert.equal(drawing?.revision, 1)
  assert.deepEqual(reads.map(r => r.table), ['artifacts', 'artifact_revision_details', 'artifact_source_status'])
  for (const read of reads) {
    assert.equal(read.filters.project_id, 'A')
    assert.ok(read.signal)
    assert.doesNotMatch(read.columns, /\*|email|diet|recipe|svg/)
  }
  assert.equal(reads[1].filters.revision, 1)
  assert.equal(reads[2].filters.revision, 1)
})

test('full-schema caller SQL reads hydrate real columns, immutable versions and enforce RLS revocation', async () => {
  const pg = new PGlite()
  const userA = '00000000-0000-4000-8000-000000000001', userB = '00000000-0000-4000-8000-000000000002'
  const planId = '00000000-0000-4000-8000-000000000010', instructionId = '00000000-0000-4000-8000-000000000011'
  const solutionId = '00000000-0000-4000-8000-000000000012', artifactId = '00000000-0000-4000-8000-000000000013'
  try {
    await pg.exec(`
      create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
      grant usage on schema auth to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;
    `)
    await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [userA, 'a@example.test', userB, 'b@example.test'])
    const legacy = new URL('../db/migrations/', import.meta.url)
    for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
    await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Private B')")
    await pg.query("insert into bob.people(id,project_id,name,initials,role,auth_user_id) values('personA','A','Owner A','AA','Organiser',$1),('personB','B','Private person','BB','Organiser',$2)", [userA, userB])
    await setupSharedSocial(pg)
    const migrations = new URL('../supabase/migrations/', import.meta.url)
    for (const f of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, migrations), 'utf8'))
    await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','area','Real area A'),('areaB','B','area','FOREIGN SECRET')")
    await pg.transaction(async tx => {
      await tx.exec("insert into bob.project_plans(project_id) values('A')")
      await tx.query("insert into bob.project_plan_revisions(project_id,revision,status,summary,reason,proposed_by,approved_by,decided_at) values('A',1,'approved','First plan','Fixture',$1,$1,now())", [userA])
      await tx.query("insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind) values('A',1,$1,1,'Real Step','Real goal','active','areaA','bob')", [planId])
      await tx.exec("update bob.project_plans set current_revision=1,next_revision=2 where project_id='A'")
      await tx.query("insert into bob.tasks(id,project_id,area_id,primary_step_id,name,instructions) values('taskA','A','areaA',$1,'Real task','Real instructions')", [planId])
      await tx.query("insert into bob.task_steps(id,project_id,task_id,title,instructions,position,created_by) values($1,'A','taskA','Real instruction','Real instruction content',1,$2)", [instructionId, userA])
      await tx.exec("insert into bob.task_assignees(task_id,person_id) values('taskA','personA')")
      await tx.query("insert into bob.solutions(id,project_id,area_id,current_revision) values($1,'A','areaA',2)", [solutionId])
      await tx.query("insert into bob.solution_revisions(solution_id,project_id,revision,title,description,change_note,recorded_by,actor_label) values($1,'A',1,'Historical solution','Stored description','Fixture',$2,'Owner'),($1,'A',2,'Current solution','Stored description','Fixture',$2,'Owner')", [solutionId, userA])
      await tx.query("insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label) values('A',1,$1,1,'Fixture',$2,'Owner')", [solutionId, userA])
      await tx.exec("insert into bob.project_targets(project_id,current_revision) values('A',1)")
      await tx.query("insert into bob.artifacts(id,project_id,area_id,current_revision) values($1,'A','areaA',2)", [artifactId])
      await tx.query("insert into bob.artifact_revisions(artifact_id,project_id,revision,kind,title,description,status,target_revision,solution_id,solution_revision,solution_title,change_note,recorded_by,actor_label) values($1,'A',1,'plan','Historical drawing','Stored description','concept',1,$2,1,'Historical solution','Fixture',$3,'Owner'),($1,'A',2,'plan','Current drawing','Stored description','concept',1,$2,1,'Historical solution','Fixture',$3,'Owner')", [artifactId, solutionId, userA])
    })
    const clientFor = (userId: string): CurrentViewClient => ({ from(table: string) { return { select(columns: string) {
      assert.match(table, /^[a-z_]+$/)
      if (table !== 'task_assignees') assert.match(columns, /^[a-z_,]+$/)
      const filters: Record<string, unknown> = {}
      let maxRows = 100
      const query: any = {
        eq(column: string, value: unknown) { assert.match(column, /^[a-z_.]+$/); filters[column] = value; return query },
        abortSignal() { return query }, maybeSingle() { return query },
        order() { return query }, limit(count: number) { maxRows = count; return query },
        then(resolve: any, reject: any) {
          return pg.transaction(async tx => {
            await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId })])
            await tx.exec('set local role authenticated')
            if (table === 'task_assignees') {
              const result = await tx.query(`select ta.task_id,ta.person_id,json_build_object('project_id',t.project_id) tasks,
                json_build_object('id',p.id,'project_id',p.project_id,'name',p.name,'updated_at',p.updated_at) people
                from bob.task_assignees ta join bob.tasks t on t.id=ta.task_id join bob.people p on p.id=ta.person_id
                where ta.task_id=$1 and t.project_id=$2 and p.project_id=$3 order by ta.person_id limit $4`,
                [filters.task_id, filters['tasks.project_id'], filters['people.project_id'], maxRows])
              return { data: JSON.parse(JSON.stringify(result.rows)), error: null }
            }
            const where = Object.keys(filters).map((column, i) => `"${column}"=$${i + 1}`).join(' and ')
            try {
              const result = await tx.query(`select ${columns} from bob.${table} where ${where}`, Object.values(filters))
              if (result.rows.length > 1) return { data: null, error: { code: 'PGRST116' } }
              return { data: result.rows.length ? JSON.parse(JSON.stringify(result.rows[0])) : null, error: null }
            } catch (error) { return { data: null, error } }
          }).then(resolve, reject)
        },
      }
      return query
    } } } })
    const readerA = createCurrentViewReader(clientFor(userA), userA)
    const task = await hydrate({ surface: 'task', taskId: 'taskA', instructionId }, readerA)
    assert.equal(task.status, 'ok', JSON.stringify(task))
    assert.equal(task.viewer?.name, 'Owner A')
    assert.equal(task.focus.area?.name, 'Real area A')
    assert.equal(task.focus.planStep?.id, planId)
    assert.equal(task.focus.instruction?.name, 'Real instruction')
    assert.deepEqual(task.focus.task?.assignees, [{ id: 'personA', name: 'Owner A' }])
    assert.deepEqual(task.focus.planStep?.responsible, { kind: 'bob' })
    await pg.exec("update bob.project_plan_steps set responsible_kind='person',responsible_person_id='personA' where project_id='A'")
    const responsible = await hydrate({ surface: 'task', taskId: 'taskA' }, readerA)
    assert.deepEqual(responsible.focus.planStep?.responsible, { kind: 'person', person: { id: 'personA', name: 'Owner A' } })
    assert.equal(responsible.sources.filter(s => s.dataset === 'crew' && s.recordId === 'personA').length, 1)
    // Nine current assignees become a deterministic bounded list, never profiles
    // or a falsely complete census. The hidden ninth is not claimed absent.
    await pg.exec("insert into bob.people(id,project_id,name,initials) select 'extra'||i,'A','Crew '||i,'EX' from generate_series(1,8) i")
    await pg.exec("insert into bob.task_assignees(task_id,person_id) select 'taskA',id from bob.people where project_id='A' and id like 'extra%'")
    const bounded = await hydrate({ surface: 'task', taskId: 'taskA' }, readerA)
    assert.equal(bounded.focus.task?.assignees?.length, 8)
    assert.deepEqual(bounded.warnings, ['task_assignees_truncated'])
    const solution = await hydrate({ surface: 'solutions', solutionId, solutionRevision: 1 }, readerA)
    assert.equal(solution.status, 'ok', JSON.stringify(solution))
    assert.equal(solution.focus.solution?.name, 'Historical solution')
    const drawing = await hydrate({ surface: 'drawings', artifactId, artifactRevision: 1 }, readerA)
    assert.equal(drawing.status, 'ok', JSON.stringify(drawing))
    assert.equal(drawing.focus.drawing?.name, 'Historical drawing')
    assert.equal(drawing.focus.drawing?.revision, 1)
    assert.equal((await hydrate({ surface: 'area', areaId: 'areaB' }, readerA)).status, 'not_found')
    assert.equal((await hydrate({ surface: 'task', taskId: 'taskA' }, createCurrentViewReader(clientFor(userB), userB))).status, 'not_found')
    // Remove the direct access source as owner SQL; all later caller reads must
    // fail despite the reader object and selected pointer remaining unchanged.
    await pg.query("update bob.people set auth_user_id=null where id='personA'")
    const revoked = await hydrate({ surface: 'task', taskId: 'taskA' }, readerA)
    assert.equal(revoked.status, 'not_found')
    assert.deepEqual(revoked.sources, [])
    assert.deepEqual(revoked.focus, {})
  } finally { await pg.close() }
})
