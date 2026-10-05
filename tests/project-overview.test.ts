import { test } from 'node:test'
import assert from 'node:assert/strict'
import { savedTaskEstimate } from '../src/lib/workEstimate'
import { readProjectOverview } from '../src/data/projectOverview'

test('task duration respects authored ranges and omits absent, partial or unrecognised estimates', () => {
  assert.equal(savedTaskEstimate(['2h','1–2 h','0,5 hours']), '3.5–4.5 h')
  for (const values of [[],[''],['2h',''],['0'],['-2h'],['2 days'],['2–1 h'],['about 2h']]) assert.equal(savedTaskEstimate(values), null)
})
function fixture(rows: Record<string, unknown[]>, failure = '', counts: Record<string,number> = {}) {
  const client = { from(table: string) {
    const query = { select() { return query }, in() { return query }, eq() { return query }, order() { return query },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows[table] ?? [], count:counts[table] ?? (rows[table]?.length ?? 0), error: failure ? {message:failure} : null }).then(resolve) } }
    return query
  } }
  return client as any
}
test('account overview keeps project identities separate and omits unsaved fields', async () => {
  let checked = 0
  const results = await readProjectOverview(fixture({
    people:[{project_id:'A',id:'a',name:'Ada',initials:'AD',color:'#123'}],
    events:[{project_id:'A',title:'Build',day:'Saturday',time:'09:00'}],
    tasks:[{project_id:'A',hours:'2h'},{project_id:'A',hours:'1h'}],
    project_thumbnails:[{project_id:'A',media_id:'image-a'}],
  }), ['A','B','A'], () => checked++)
  assert.equal(checked, 1)
  assert.equal(results[0].taskEstimate, '3 h')
  assert.equal(results[0].event?.time, '09:00')
  assert.equal(results[0].thumbnailId, 'image-a')
  assert.deepEqual(results[1], {projectId:'B',participants:[],event:null,taskEstimate:null,thumbnailId:null})
  await assert.rejects(readProjectOverview(fixture({people:[{project_id:'C'}]}), ['A'], () => {}), /context changed/)
  await assert.rejects(readProjectOverview(fixture({}), ['A'], () => {throw new Error('Session changed')}), /Session changed/)
  await assert.rejects(readProjectOverview(fixture({}, 'denied'), ['A'], () => {}), /denied/)
})

test('a capped task page never becomes a misleading project duration', async () => {
  const result = await readProjectOverview(fixture({tasks:[{project_id:'A',hours:'3h'}]}, '', {tasks:2}), ['A'], () => {})
  assert.equal(result[0].taskEstimate, null)
})
