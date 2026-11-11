import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { shopAddress, storeResearchTool } from '../supabase/functions/_shared/store-research.ts'

const usage = { input_tokens: 10, output_tokens: 10, total_tokens: 20 }
const product = (url: string) => ({ name: 'Plywood 15 mm', url, article_number: '123', variant: null,
  dimensions: '15 × 1220 × 2440 mm', pack: '1 skiva', price: null, availability: null,
  match: 'Behöver kapkontroll mot båda delarna.', uncertainties: 'Lokalt lager och pris saknas.' })

test('Ines searches only the selected shop; fabricated and external product links are discarded', async () => {
  const calls: any[] = [], url = 'https://byggmax.se/plywood-123'
  const tool = storeResearchTool({ catalog: catalogFixture(), userId: 'owner', timeoutMs: 45000, hasAccess: async () => true,
    callModel: async o => { calls.push(o); return { success: true, usage, model: 'fixture',
      data: { products: [product(url), product('https://byggmax.se/invented'), product('https://other-shop.se/p')], missing: ['Pris och lokalt lager'] },
      webSearch: { completedCalls: 1, tokenCostUsd: .01, sources: [{ url, title: 'Plywood' }, { url: 'https://other-shop.se/p', title: 'Other' }] } } } })
  const result: any = await tool.execute({ store_url: 'https://www.byggmax.se', branch: 'Vetlanda', request: 'Plywood 15 mm, två bitar minst 1540 mm långa.' })
  assert.deepEqual(calls[0].webSearch, { allowedDomains: ['byggmax.se'] })
  assert.equal(calls[0].catalogRoleKey, 'store-worker')
  assert.equal(calls[0].tools, undefined)
  assert.equal(calls[0].previousResponseId, undefined)
  assert.equal(calls[0].messages.length, 1, 'the private conversation is not forwarded')
  assert.deepEqual(result.products.map((p: any) => p.url), [url])
  assert.equal(result.products[0].availability, null)
  assert.equal(result.products[0].suitability_verified, false)
  assert.equal(result.products[0].branch_stock_verified, false)
  assert.equal(result.discarded_products, 2)
  assert.equal(result.saved, false)
  assert.equal(result.purchased, false)
})

test('a model answer without an actual search is not sourced evidence; lost access hides results', async () => {
  let access = true
  const tool = storeResearchTool({ catalog: catalogFixture(), userId: 'owner', timeoutMs: 45000, hasAccess: async () => access,
    callModel: async () => ({ success: true, usage, model: 'fixture', data: { products: [product('https://byggmax.se/p')], missing: [] } }) })
  assert.equal((await tool.execute({ store_url: 'https://byggmax.se', branch: null, request: 'Plywood' }) as any).reason, 'store_search_not_performed')
  access = false
  await assert.rejects(tool.execute({ store_url: 'https://byggmax.se', branch: null, request: 'Plywood' }), /project_denied/)
  for (const s of ['http://byggmax.se', 'https://127.0.0.1', 'https://localhost', 'https://x.internal', 'https://u:p@byggmax.se', 'https://byggmax.se:8443'])
    assert.equal(shopAddress(s), null)
})
