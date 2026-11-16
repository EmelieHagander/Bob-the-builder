// Build-day ticks (2026-11-15): members tick cut parts and guide pages on an
// exact saved version; the ticker is the caller; other projects see nothing.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

let pg: PGlite
const member = randomUUID(), outsider = randomUUID(), drawing = randomUUID()
before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [member, 'member@example.test', outsider, 'outsider@example.test'])
  // Fixture rows only: the revision table's own write rules are not under test here.
  await pg.exec(`set session_replication_role = replica;
    insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Project B');
    insert into bob.artifacts(id,project_id,current_revision) values('${drawing}','A',2);
    insert into bob.artifact_revisions(artifact_id,project_id,revision,kind,title,description,status,target_revision,solution_id,solution_revision,solution_title,change_note,recorded_by,actor_label)
      select '${drawing}','A',n,'detail','Bed','Fixture','concept',1,'${randomUUID()}',1,'Fixture','Fixture','${member}','Member' from generate_series(1,2) n;
    set session_replication_role = origin;`)
  await pg.query("insert into bob.people(id,project_id,name,initials,role,auth_user_id) values('pa','A','Member','ME','Organiser',$1),('pb','B','Other','OT','Organiser',$2)", [member, outsider])
})
after(() => pg.close())

const as = (uid: string, sql: string, args: unknown[] = []) => asProjectUser(pg, uid, sql, args)
const tick = (uid: string, item: string, project = 'A', revision = 2) =>
  as(uid, 'insert into bob.build_checks(project_id,artifact_id,revision,item) values($1,$2,$3,$4)', [project, drawing, revision, item])

test('a member ticks and unticks; the ticker is the caller', async () => {
  await tick(member, 'cut:post_70x45x1540')
  await tick(member, 'page:guide-3')
  const rows = (await as(member, 'select item,checked_by from bob.build_checks order by item')).rows as any[]
  assert.deepEqual(rows.map(r => r.item), ['cut:post_70x45x1540', 'page:guide-3'])
  assert.ok(rows.every(r => r.checked_by === member))
  await as(member, "delete from bob.build_checks where item='page:guide-3'")
  assert.equal((await as(member, 'select item from bob.build_checks')).rows.length, 1)
})

test('ticks stay with the version they were made on', async () => {
  await tick(member, 'cut:post_70x45x1540', 'A', 1)
  const v2 = (await as(member, 'select item from bob.build_checks where revision=2')).rows
  const v1 = (await as(member, 'select item from bob.build_checks where revision=1')).rows
  assert.equal(v2.length, 1); assert.equal(v1.length, 1)
  await assert.rejects(tick(member, 'cut:x', 'A', 3), 'a version that does not exist')
})

test('another project cannot read, tick or pose as someone else', async () => {
  assert.equal((await as(outsider, 'select item from bob.build_checks')).rows.length, 0)
  await assert.rejects(tick(outsider, 'cut:spoof'))
  await assert.rejects(tick(outsider, 'cut:spoof', 'B'), 'the drawing is not in project B')
  await assert.rejects(as(member, 'insert into bob.build_checks(project_id,artifact_id,revision,item,checked_by) values($1,$2,2,$3,$4)', ['A', drawing, 'cut:other', outsider]))
  await as(outsider, 'delete from bob.build_checks')
  assert.equal((await as(member, 'select item from bob.build_checks where revision=2')).rows.length, 1)
})

test('only cut and page ticks are stored', async () => {
  await assert.rejects(tick(member, 'bought:screws'))
  await assert.rejects(tick(member, 'cut:<script>'))
})
