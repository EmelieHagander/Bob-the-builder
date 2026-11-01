import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('the contract pins a later refresh for specialists only on new jobs', () => {
 const meta:any=catalogFixture().definition('agent-contract.ask-bob').metadata
 assert.equal(meta.specialist_continuation_tokens,150000)
 assert.equal(meta.publication,'bob-specialist-continuation-v1')
 assert.equal(meta.turn_usd_stop,4)
 assert.equal(meta.continuation_input_tokens,64000)
 assert(meta.specialist_continuation_tokens<200000,'stays below the specialist input ceiling')
 const source=readFileSync(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
 assert.match(source,/specialistContinuationTokens: contract\.specialist_continuation_tokens/)
 assert.match(source,/specialistContinuationTokens: execution\.specialistContinuationTokens/)
})
