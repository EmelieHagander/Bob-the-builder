import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { type ArtClaim, guideItemArt, resolveItemArt } from '../supabase/functions/_shared/guide-item-art.ts'

test('six distinct bunk-bed illustrations, ordinary screws and the same pins on repeat', async () => {
  const guide = JSON.parse(
    readFileSync(new URL('../cad-worker/fixtures/bunk_bed_guide.json', import.meta.url), 'utf8'),
  )
  const resolve = async (_pin: string, builtin?: string) => builtin
  const art = await guideItemArt(guide, resolve)
  assert.deepEqual(Object.values(art).sort(), [
    'bed-bolt',
    'fluted-dowel',
    'hook-pair',
    'reinforced-angle',
    'splice-plate',
    'u-channel',
  ])
  assert.deepEqual(await guideItemArt(guide, resolve), art)
  const pin = Object.keys(art).find((key) => art[key] === 'u-channel')!
  const row = guide.fasteners.joints.find((r: any) => pin === r.material_id + '@' + r.material_revision)
  const next = row.material_id + '@2'
  guide.fasteners.joints.push({ ...row, material_revision: 2 })
  guide.item_names[next] = guide.item_names[pin]
  assert.equal((await guideItemArt(guide, resolve))[next], 'unavailable')
})

test('only visibly accepted art is saved; cache hits and busy claims make no image calls', async () => {
  let value: ArtClaim = {
    status: 'claimed',
    token: 'mine',
    name: 'Pair of plates',
    notes: 'one slotted',
    reference: 'photo',
  }
  let draws = 0, reviews = 0, pass = false
  const saved: (string | null)[] = []
  const store = {
    claim: async () => value,
    finish: async (_pin: string, token: string, png: string | null) => {
      assert.equal(token, 'mine')
      saved.push(png)
      if (png) value = { status: 'ready', png }
      return true
    },
  }
  const run = () =>
    resolveItemArt('a@1', undefined, store, async (item) => {
      assert.equal(item.reference, 'photo')
      draws++
      return 'thumb'
    }, async (png, item) => {
      assert.equal(item.notes, 'one slotted')
      assert.equal(png, 'thumb')
      reviews++
      return pass
    })
  assert.equal(await run(), null)
  pass = true
  assert.equal(await run(), 'thumb')
  assert.equal(await run(), 'thumb')
  value = { status: 'unavailable' }
  assert.equal(await run(), null)
  assert.deepEqual([draws, reviews, saved], [2, 2, [null, 'thumb']])
})
