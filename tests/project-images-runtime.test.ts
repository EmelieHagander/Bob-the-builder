import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { runClaimedProjectTurn } from './support/bob-model-routing.ts'
import { createProjectContext } from '../supabase/functions/_shared/project-context/dispatcher.ts'
import { createMediaAdapter, type MediaRow } from '../supabase/functions/_shared/project-context/media.ts'
import { hasImageContent, responseMessageContent } from '../supabase/functions/_shared/openai-content.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'
const time = '2026-09-20T12:00:00Z', id = '10000000-0000-4000-8000-000000000001'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const success = (data: string) => ({ success: true, data, model: 'fixture', responseId: 'resp_final', usage })
const tool = (name: string, args: unknown, n: number) => ({ success: true, data: null, model: 'fixture', responseId: `resp_${n}`, usage,
  toolCalls: [{ id: `call_${n}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] })
function fixture() {
  let downloads = 0, allowed = true
  const row: MediaRow = { id, project_id: 'A', title: 'Project reference', purpose: 'reference', content_type: 'image/png', byte_size: 8, width: 2, height: 2, state: 'ready', created_at: time, updated_at: time, bucket_id: 'bob-project-media', object_path: `A/${id}` }
  const lookup = createProjectLookup('A', async () => ({ data: { records: [{ id: 'A', name: 'Project A' }], related: [], truncated: false }, error: null }), 1000, 12)
  const projectContext = createProjectContext({ hasAccess: async () => allowed, sources: lookup.sources, adapters: [createMediaAdapter('A', {
    count: async () => 1, list: async () => [row], read: async key => key === id && allowed ? row : null,
    download: async () => { downloads++; return Uint8Array.from([137,80,78,71,13,10,26,10]) },
  })] })
  // Exercise the actual writer settlement path too: it must not overwrite image evidence.
  const writer = createProjectWriter('A', 'Inspect the reference', async () => { throw new Error('No write authorised by this test') },
    async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
  return { opts: { projectId: 'A', userId: 'userA', message: 'Inspect the reference', generation: 1,
    lookup, projectContext, writer, hasAccess: async () => allowed, fail: async () => {} },
    row, get downloads() { return downloads }, revoke() { allowed = false } }
}

test('actual claimed tool loop lists metadata, delivers selected pixels, preserves source disclosure through settlement', async () => {
  const f = fixture(); let calls = 0, committed: any
  const answer = await runClaimedProjectTurn({ ...f.opts, commit: async r => { committed = r }, callModel: async options => {
    calls++
    assert(options.tools?.some(t => t.function.name === 'open_project_item'))
    if (calls === 1) { assert(!hasImageContent(options.messages)); return tool('list_project_category', { category: 'images', query: null, area_id: null, after_id: null }, 1) }
    if (calls === 2) { assert(!hasImageContent(options.messages)); assert.match(String(options.messages?.[0].content), new RegExp(id)); return tool('open_project_item', { refs: [`image:${id}`] }, 2) }
    const carrier = options.messages!.find(m => Array.isArray(m.content))!
    assert(carrier); assert.equal(options.previousResponseId, 'resp_2')
    assert(responseMessageContent('user', carrier.content).some(p => p.type === 'input_image'))
    assert.equal(options.messages![0].role, 'tool', 'tool result pairing survives the separate image carrier')
    return success('Reference inspected.')
  } })
  assert(answer.ok); assert.equal(calls, 3); assert.equal(f.downloads, 1)
  assert(answer.evidence.sources.some(s => s.dataset === 'image_pixels' && s.recordId === id))
  assert(isBobAnswerEvidence(answer.evidence, 'A')); assert(!isBobAnswerEvidence(answer.evidence, 'B'))
  assert.deepEqual(committed.evidence, answer.evidence)
  assert.doesNotMatch(JSON.stringify(committed), /data:image|base64|bucket_id|object_path/)
})

test('Bob can answer without opening images even when the catalog contains one', async () => {
  const f = fixture()
  const answer = await runClaimedProjectTurn({ ...f.opts, callModel: async o => {
    assert(!hasImageContent(o.messages)); assert.match(String(o.messages![0].content), /Project Catalog/)
    return success('No image needed for this answer.')
  } })
  assert(answer.ok); assert.equal(f.downloads, 0)
  assert.equal(answer.evidence.sources.filter(s => s.dataset === 'image_pixels').length, 0)
})

test('a failed visual model call never becomes a viewed-image source or a completed response', async () => {
  const f = fixture(); let calls=0
  const answer = await runClaimedProjectTurn({ ...f.opts, callModel: async () => ++calls === 1
    ? tool('open_project_item', { refs: [`image:${id}`] }, 1)
    : { success: false, data: null, model: 'fixture', usage } })
  assert(!answer.ok); assert.equal(f.opts.lookup.sources.filter(s => s.dataset === 'image_pixels').length, 0)
})

test('revocation while the model runs suppresses its visual answer and any further provider call', async () => {
  const f = fixture(); let calls=0
  const answer = await runClaimedProjectTurn({ ...f.opts, callModel: async () => {
    if (++calls === 1) return tool('open_project_item', { refs: [`image:${id}`] }, 1)
    f.revoke(); return success('This must not be returned.')
  } })
  assert(!answer.ok); assert.equal(calls, 2)
})

test('image invalidation at settlement keeps committed write receipts but removes visual prose and provider continuation', async () => {
  const f=fixture();let calls=0, imageValid=true, committed:any
  const receipt={projectId:'A',dataset:'tasks',recordId:'taskA',label:'Saved task',operation:'updated',savedAt:time,record:{id:'taskA'}}
  const writer=createProjectWriter('A','Update the task',async()=>{throw new Error('Not called')},
    async()=>({data:[],error:null}),async()=>{imageValid=false;return {data:{generation:2,receipts:[receipt]},error:null}})
  const originalValidate=f.opts.projectContext.validate
  f.opts.projectContext.validate=async()=>imageValid&&await originalValidate()
  const answer=await runClaimedProjectTurn({...f.opts,writer,commit:async r=>{committed=r},callModel:async()=>++calls===1
    ?tool('open_project_item',{refs:[`image:${id}`]},1):success('Visual detail must not survive invalidation.')})
  assert(answer.ok);assert.equal(answer.providerResponseId,undefined)
  assert.equal(answer.evidence.writes?.[0].recordId,'taskA');assert.deepEqual(answer.evidence.sources,[])
  assert.doesNotMatch(answer.answer,/Visual detail/);assert.equal(committed.providerResponseId,undefined)
})
