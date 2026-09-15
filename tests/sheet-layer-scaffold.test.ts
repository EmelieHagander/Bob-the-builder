// Temporary development scaffolding; removed once the generated migration is committed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('scaffold sheet-layer material migration in an isolated local directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bob-sheet-layer-'))
  const cli = resolve('node_modules/.bin/supabase')
  try {
    execFileSync(cli, ['migration', 'new', '--help'], { cwd: directory, stdio: 'pipe' })
    execFileSync(cli, ['migration', 'new', 'sheet_layer_material_quantities'], { cwd: directory, stdio: 'pipe' })
    const names = await readdir(join(directory, 'supabase', 'migrations'))
    assert.equal(names.length, 1)
    assert.match(names[0], /^\d{14}_sheet_layer_material_quantities\.sql$/)
    console.log('BOB_SHEET_LAYER_MIGRATION=' + names[0])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
