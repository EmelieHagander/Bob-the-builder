import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { runAuthenticatedK4CutPlan } from './run-live-construction-drawing.mjs'

const report = await runAuthenticatedK4CutPlan(process.env, {
 makeClient: createClient, progress: value => console.log(value),
 probe: async sessionEnv => {
  const saved = new Map(Object.keys(sessionEnv).map(key => [key, process.env[key]]))
  const email = process.env.BOB_USER_EMAIL, password = process.env.BOB_USER_PASSWORD
  delete process.env.BOB_USER_EMAIL; delete process.env.BOB_USER_PASSWORD
  try {
   Object.assign(process.env, sessionEnv)
   await import('./check-live-construction-cut-plan.ts')
   assert(!process.exitCode, 'The K4 probe did not pass')
  } finally {
   for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
   process.env.BOB_USER_EMAIL = email; process.env.BOB_USER_PASSWORD = password
  }
 },
})
await mkdir('test-results', { recursive: true })
await writeFile('test-results/k4-cut-plan-preflight.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
if (!report.passed) process.exitCode = 1
