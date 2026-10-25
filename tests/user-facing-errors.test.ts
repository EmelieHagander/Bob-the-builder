import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Screens never render raw database/runtime text: they use userErrorMessage()
// from src/lib/userErrors.ts. Behaviour is covered by tests/user-errors.test.ts.

const SRC = new URL('../src/', import.meta.url).pathname
// Owned by the parallel building-context change; remove each entry once that
// change converts the file (exit condition: these files pass this scan).
const PENDING = new Set<string>()

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(join(dir, entry.name))
    : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [])
}

const ERRORISH = /^(e|err|error|reason|cause|failure|ex|exception)$|Error$/

/** Lines of a .tsx file that would put raw error text on screen. */
export function rawErrorRenders(code: string): string[] {
  const caught = new Set<string>()
  for (const match of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) caught.add(match[1])
  for (const match of code.matchAll(/\.catch\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) caught.add(match[1])
  const errorish = (name: string) => caught.has(name) || ERRORISH.test(name)
  const found: string[] = []
  code.split('\n').forEach((line, index) => {
    const at = `${index + 1}: ${line.trim().slice(0, 120)}`
    for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\??\.message\b/g)) if (errorish(match[1])) found.push(at)
    for (const match of line.matchAll(/\bString\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) if (errorish(match[1])) found.push(at)
    if (/instanceof Error\s*\?\s*[\w$.?]+\.message/.test(line)) found.push(at)
  })
  return [...new Set(found)]
}

test('the scanner flags raw error rendering and allows ordinary message data', () => {
  assert.deepEqual(rawErrorRenders('} catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }').length, 1)
  assert.equal(rawErrorRenders('.catch(problem => setError(problem.message))').length, 1)
  assert.equal(rawErrorRenders('<p>{loadError?.message}</p>').length, 1)
  assert.equal(rawErrorRenders('<pre>{this.state.error.message}</pre>').length, 1)
  assert.equal(rawErrorRenders('setNotice(String(err))').length, 1)
  assert.equal(rawErrorRenders('{activeLoad.message}{message.evidence && <Evidence />}{history.messages.length}').length, 0)
  assert.equal(rawErrorRenders('setError(userErrorMessage(err, "Could not save."))').length, 0)
})

test('screens render people-facing error copy, never raw error text', () => {
  const offenders = sources(SRC).filter(file => file.endsWith('.tsx'))
    .filter(file => !PENDING.has(relative(SRC, file)))
    .flatMap(file => rawErrorRenders(readFileSync(file, 'utf8')).map(line => `${relative(SRC, file)}:${line}`))
  assert.deepEqual(offenders, [], 'Use userErrorMessage(error, fallback) from src/lib/userErrors.ts')
})

test('the data layer throws typed errors instead of "database:" text', () => {
  const offenders = sources(SRC).filter(file => readFileSync(file, 'utf8').includes('database: ${')).map(file => relative(SRC, file))
  assert.deepEqual(offenders, [], 'Throw toDataError(error) so the code and raw detail stay typed')
})

test('the parallel-owned allowance is still needed', () => {
  for (const file of PENDING) assert(rawErrorRenders(readFileSync(join(SRC, file), 'utf8')).length > 0,
    `${file} now passes; remove it from PENDING`)
})
