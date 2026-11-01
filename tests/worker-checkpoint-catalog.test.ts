import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('the contract pins worker checkpoints for new jobs and keeps the earlier flags', () => {
 const meta:any=catalogFixture().definition('agent-contract.ask-bob').metadata
 assert.equal(meta.worker_checkpoint_version,1)
 assert.equal(meta.publication,'bob-worker-checkpoint-v1')
 assert.equal(meta.specialist_continuation_tokens,150000)
 assert.equal(meta.turn_usd_stop,4)
 const source=readFileSync(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
 assert.match(source,/checkpoint && contract\.worker_checkpoint_version === 1 \? \{ workerCheckpointVersion: 1 as const \}/)
 assert.match(source,/execution\.workerCheckpointVersion === 1 \? \{ workerCheckpoint: true \}/)
})
