import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawingErrorCode} from '../supabase/functions/_shared/drawing-errors.ts'

test('drawing faults survive RPC and worker wrapping without exposing arbitrary diagnostics',()=>{
 for(const code of ['drawing_continuation_mismatch','drawing_budget_period_closed','drawing_scope_changed','drawing_request_legacy_unsupported']) {
  assert.equal(drawingErrorCode({code:'PT409',message:code}),code)
  assert.equal(drawingErrorCode(new Error(code)),code)
 }
 for(const error of [null,'drawing_continuation_mismatch',{message:42},new Error('provider failure with private text'),
  {message:'private payload contains drawing_continuation_mismatch'}])assert.equal(drawingErrorCode(error),undefined)
})
