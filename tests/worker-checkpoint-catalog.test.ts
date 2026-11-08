import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('the contract pins worker checkpoints while new jobs have no turn-spend stop', () => {
 const meta:any=catalogFixture().definition('agent-contract.ask-bob').metadata
 assert.equal(meta.worker_checkpoint_version,1)
 assert.equal(meta.work_allowance_version,1)
 assert.equal(meta.publication,'bob-turn-usd-stop-removed-v1')
 assert.equal(meta.specialist_continuation_tokens,150000)
 assert(!('turn_usd_stop' in meta))
 const source=readFileSync(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
 assert.match(source,/checkpoint && contract\.worker_checkpoint_version === 1 \? \{ workerCheckpointVersion: 1 as const \}/)
 assert.match(source,/execution\.workerCheckpointVersion === 1 \? \{ workerCheckpoint: true \}/)
})
