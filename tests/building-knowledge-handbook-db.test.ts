import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { committedCorpus } from '../scripts/build-knowledge-wood-handbook.ts'
import { indexKnowledgePassages } from '../supabase/functions/_shared/knowledge-index.ts'
import { createKnowledgeReader, type KnowledgeHandbook } from '../supabase/functions/_shared/building-knowledge.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'

let pg: PGlite
const corpus = committedCorpus()
const model = 'test-embedding-model'
const service = async (sql: string, params: unknown[] = []) => (await asProjectUser(pg, null, sql, params, 'service_role')).rows[0] as any
/** Deterministic stand-in: one axis per topic word, so "meaning" is testable without a provider. */
const TOPICS = ['deflection', 'adhesive', 'termite', 'moisture', 'nail']
const fakeEmbed = (text: string) => { const v = Array.from({ length: 256 }, (_, i) => i === 255 ? 0.01 : 0); TOPICS.forEach((t, i) => { if (text.toLowerCase().includes(t)) v[i] = 1 }); return v }
const search = async (query: string, embedding: number[] | null = null, useModel = '', jurisdiction = 'general') =>
  (await service('select bob.search_knowledge_passages($1,$2,$3,$4,4) d', [query, embedding && JSON.stringify(embedding), useModel, jurisdiction])).d

before(async () => {
  pg = await projectSchema()
  for (const sql of corpus.sql) await pg.exec(sql)
})
after(async () => { await pg?.close() })

test('the committed Wood Handbook corpus is reproducible, whole and clean', () => {
  assert.match(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-knowledge-wood-handbook.ts', '--check'], { encoding: 'utf8' }), /ok: \d+ passages/)
  const { passages } = corpus
  assert(passages.length > 1000)
  assert.deepEqual([...new Set(passages.map(p => p.chapter))], Array.from({ length: 19 }, (_, i) => i + 1), 'every chapter, in order')
  assert(passages.every((p, i) => p.ordinal === i + 1 && p.text.length <= 1800 && p.pdf_page >= 11))
  assert(passages.every(p => !/General Technical Report FPL[–-]GTR[–-]282/.test(p.text) && !/CHAPTER \d+ \|/.test(p.text)), 'running headers removed')
  assert.equal(passages.find(p => p.chapter === 9)!.chapter_title, 'Structural Analysis Equations')
  assert(passages.some(p => p.chapter === 9 && /Straight Beam Deflection/.test(p.text) && p.page_label === '9–1'))
})

test('text search finds the book passage with its chapter, page and original page', async () => {
  const result = await search('beam deflection modulus of elasticity')
  assert.equal(result.searchMode, 'lexical')
  assert(result.passages.length > 0 && result.passages.length <= 4)
  const hit = result.passages.find((p: any) => p.chapter === 9)
  assert(hit, 'chapter 9 structural analysis passage')
  assert.equal(hit.rights, 'us_federal_public_domain')
  assert.match(hit.document_url, /^https:\/\/research\.fs\.usda\.gov\//)
  assert(Number.isSafeInteger(hit.pdf_page))
  assert.deepEqual((await search('qqqqzzzz')).passages, [])
})

test('embeddings are indexed once by the operator path and make search hybrid; stale vectors never match', async () => {
  const store = {
    pending: async (limit: number, m: string) => (await service('select bob.knowledge_index_pending($1,$2) d', [limit, m])).d,
    save: async (items: unknown[], m: string) => (await service('select bob.knowledge_index_save($1,$2) d', [JSON.stringify(items), m])).d,
  }
  let calls = 0
  const first = await indexKnowledgePassages({ store, model, maxBatches: 2, batchSize: 64, embed: async texts => { calls++; return texts.map(fakeEmbed) } })
  assert.equal(first.status, 'partial'); assert.equal(first.indexed, 128); assert.equal(calls, 2)
  const rest = await indexKnowledgePassages({ store, model, maxBatches: 40, batchSize: 256, embed: async texts => texts.map(fakeEmbed) })
  assert.equal(rest.status, 'complete'); assert.equal(first.indexed + rest.indexed, corpus.passages.length)
  assert.equal((await store.pending(8, model)).passages.length, 0, 'nothing is embedded twice')

  // A query in another language still reaches the passage by meaning.
  const hybrid = await search('nedböjning av balk', fakeEmbed('deflection'), model)
  assert.equal(hybrid.searchMode, 'hybrid')
  assert(hybrid.passages.some((p: any) => /deflection/i.test(p.text)))

  const target = corpus.passages.find(p => /termite/i.test(p.text))!
  await pg.query('update bob_private.knowledge_passages set text=text||$2 where id=$1', [target.id, ' (edited)'])
  const stale = await search('zzzz', fakeEmbed('termite'), model)
  assert(!stale.passages.some((p: any) => p.id === target.id), 'a vector for older text is not used')
  await assert.rejects(store.save([{ id: target.id, fingerprint: 'a'.repeat(32), embedding: fakeEmbed('termite') }], model), /knowledge_source_changed/)
})

test('withdrawn sources disappear and only the service role can read or index', async () => {
  await pg.query("update bob_private.knowledge_sources set status='withdrawn'")
  assert.deepEqual((await search('beam deflection')).passages, [])
  await pg.query("update bob_private.knowledge_sources set status='active'")
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asProjectUser(pg, null, "select bob.search_knowledge_passages('beam',null,'','general',4)", [], role), /permission denied/)
    await assert.rejects(asProjectUser(pg, null, 'select count(*) from bob_private.knowledge_passages', [], role), /permission denied/)
  }
})

test('the reader returns book passages as cited references, survives an embedding outage and rechecks access', async () => {
  const searches: unknown[][] = []
  let allowed = true, embedFails = false
  const handbook: KnowledgeHandbook = {
    search: async (...args) => { searches.push(args); return search(String(args[0]), args[1] as number[] | null, String(args[2])) },
    embedder: { model, embed: async texts => { if (embedFails) throw new Error('provider down'); return texts.map(fakeEmbed) } },
  }
  const reader = createKnowledgeReader(async () => allowed, () => new Date('2026-11-16'), { handbook })
  const result: any = await reader.execute({ query: 'beam deflection', jurisdiction: 'SE' })
  assert.equal(result.status, 'ok')
  assert.equal(result.handbook.status, 'ok')
  const passage = result.handbook.passages[0]
  assert.match(passage.original_page_url, /62200\.pdf#page=\d+$/)
  assert(passage.text && passage.page && passage.limitations)
  assert(reader.references.some(r => r.url === passage.original_page_url && /Wood Handbook/.test(r.title)))
  assert(isBobAnswerEvidence({ kind: 'ai_assessment', partial: false, sources: [], references: reader.references }, 'A'))

  embedFails = true
  const lexical: any = await reader.execute({ query: 'adhesive bond', jurisdiction: 'general' })
  assert.equal(lexical.handbook.status, 'ok'); assert(lexical.handbook.passages.length > 0)
  assert.equal(searches.at(-1)![1], null, 'text search only when the embedding fails')

  allowed = false
  assert.equal((await reader.execute({ query: 'beam', jurisdiction: 'general' })).status, 'denied')
})

test('without a handbook the reader keeps the curated-notes result shape', async () => {
  const result: any = await createKnowledgeReader(async () => true, () => new Date('2026-09-25')).execute({ query: 'kaninhus', jurisdiction: 'SE' })
  assert.equal(result.status, 'ok'); assert.equal('handbook' in result, false)
})
