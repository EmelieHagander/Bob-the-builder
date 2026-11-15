import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerOperations } from '../supabase/functions/_shared/worker-operations.ts'
import { constructionStartPacket } from '../supabase/functions/_shared/project-answer.ts'

// Owner decision 2026-11-09: 11 of Konrad's 22 steps in the entrance job only
// re-read the construction he was handed. Code now reads it once, up front.
const entry = (id: string, revision: number) => ({ kind: 'construction' as const, id, revision, label: id, ref: 'op_' + id })
const ops = (entries: ReturnType<typeof entry>[], source: { artifact_id: string; revision: number } | null = null) =>
  createWorkerOperations({ projectId: 'p', hasAccess: async () => true, load: async () => ({ status: 'ready', source, entries }),
    prepareDrawing: async () => ({ status: 'ready' }), drawingArguments: () => null, drawingWork: () => undefined } as any)

test('the start packet names the construction a structure job can only mean', async () => {
  const one = ops([entry('a', 3)]); await one.prepare('structure', [])
  assert.equal(one.startRef('structure'), (one.describe('structure').selections as any[])[0].ref)
  const two = ops([entry('a', 3), entry('b', 1)]); await two.prepare('structure', [])
  assert.equal(two.startRef('structure'), null)
  const bound = ops([entry('a', 3), entry('b', 1)], { artifact_id: 'b', revision: 1 }); await bound.prepare('structure', [])
  assert.equal(bound.startRef('structure'), bound.describe('structure').source!.ref)
})

test('the start packet reads overview, parts work and checks once, and leaves large parts to Konrad', async () => {
  const reads: any[] = []
  const packet = await constructionStartPacket(async args => {
    reads.push(args)
    return args.view === 'work' ? { status: 'ok', items: ['x'.repeat(40000)] } : { status: 'ok', view: args.view }
  }, 'op_a')
  assert.deepEqual(reads.map(r => [r.source_ref, r.view, r.work_kind]), [['op_a', 'overview', null], ['op_a', 'work', 'parts'], ['op_a', 'results', null]])
  assert.deepEqual(packet.overview, { status: 'ok', view: 'overview' })
  assert.deepEqual(packet.work, { status: 'too_large', note: 'Read it with your own tools.' })
  assert.deepEqual(packet.checks, { status: 'ok', view: 'results' })
})
