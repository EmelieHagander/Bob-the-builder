import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAiCatalogSession, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { projectSchema } from './support/project-schema.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

const migrationName = '20261009222402_cad_server_owned_values.sql'
const changed = new Set(['tools.render_cad_candidate', 'tools.render_saved_cad_candidate', 'tools.finish_cad_research'])

test('server contracts publish atomically, preserve pinned history and agree with runtime fixtures', async t => {
  let previous!: AiCatalogManifest
  let published: AiCatalogManifest|undefined
  const pg = await projectSchema(async (db, name) => {
    if (name === migrationName) previous = (await db.query<{ result: AiCatalogManifest }>(
      "select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
    if(name>migrationName&&!published)published=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  })
  t.after(() => pg.close())
  const resolve = async (manifestId: string | null = null) => (await pg.query<{ result: AiCatalogManifest }>(
    "select shared.resolve_ai_catalog('bob',$1) result", [manifestId])).rows[0].result
  const latest = await resolve()
  const current = published??latest
  assert.notEqual(current.manifest_id, previous.manifest_id)
  assert.deepEqual(current.models, previous.models)
  assert.deepEqual(await resolve(previous.manifest_id), previous, 'running jobs retain their immutable contracts')
  for (const original of previous.definitions) {
    const next = current.definitions.find(row => row.prompt_key === original.prompt_key)!
    if (changed.has(original.prompt_key)) {
      assert.equal(next.version, original.version + 1)
      assert.equal(next.content, original.content)
      assert.equal(next.metadata.server_owned_values, true)
    } else assert.deepEqual(next, original, 'unrelated active edits must survive publication')
  }
  const catalog = createAiCatalogSession({ rpc: async () => { throw new Error('pinned only') } }, { app: 'bob', manifest: current })
  const oldCatalog = createAiCatalogSession({ rpc: async () => { throw new Error('pinned only') } }, { app: 'bob', manifest: previous })
  const fixture = catalogFixture()
  for (const key of changed) {
    const parameters = { evidence_refs: ['measurement:a', 'choice:b'], check_ids: ['width', 'height'] }
    assert.deepEqual(catalog.tool(key, parameters).function.parameters, fixture.tool(key, parameters).function.parameters)
  }
  for (const key of ['tools.render_cad_candidate', 'tools.render_saved_cad_candidate']) {
    const schema = catalog.tool(key).function.parameters as any
    const old = oldCatalog.tool(key).function.parameters as any
    assert.equal(Object.hasOwn(old.properties, 'target_revision'), true)
    assert.equal(Object.hasOwn(schema.properties, 'target_revision'), false)
    assert.equal(schema.required.includes('target_revision'), false)
  }
  const intake = catalog.tool('tools.finish_cad_research', { check_ids: ['width', 'height'] }).function.parameters as any
  assert.deepEqual(intake.properties.checks.items.properties.id.enum, ['width', 'height'])
  assert.equal(Object.hasOwn(intake.properties.additional_needs.items.properties, 'id'), false)
  assert.equal(intake.properties.additional_needs.items.required.includes('id'), false)

  const snapshot = async () => (await pg.query(`select p.prompt_key,p.active_version_id,
    (select count(*) from shared.ai_prompt_versions v where v.prompt_id=p.id) versions
    from shared.ai_prompts p where p.app='bob' order by p.prompt_key`)).rows
  const beforeFailure = await snapshot()
  const migration = await readFile(new URL('../supabase/migrations/' + migrationName, import.meta.url), 'utf8')
  await assert.rejects(pg.transaction(async tx => {
    // Fault-inject an absent third contract while the first two are valid.
    // The transaction wrapper supplies the migration's BEGIN/COMMIT boundary.
    await tx.exec(migration.replace('"tools.finish_cad_research"', '"tools.missing_cad_contract"')
      .replace(/^begin;$/m, '').replace(/^commit;$/m, ''))
  }), /cad_server_contract_missing/)
  assert.deepEqual(await snapshot(), beforeFailure, 'a missing third contract rolls back both earlier versions and all pointers')
  assert.deepEqual(await resolve(), latest)
})
