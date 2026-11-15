import type { AiCatalogSession } from './ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { ToolDefinition } from './project-tools/session.ts'

type ModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<unknown>>

/** A public shop address, never a fetch target on Bob's server. Native search
 * is constrained to this host and its subdomains by the provider and again on return. */
export function shopAddress(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname)
      || /\.(?:localhost|local|internal|invalid|test)$/.test(u.hostname)) return null
    return u
  } catch { return null }
}
const productAddress = (raw: unknown, shop: URL): string | null => {
  const u = shopAddress(raw)
  const host = shop.hostname.replace(/^www\./, '')
  if (!u || u.hostname !== host && !u.hostname.endsWith('.' + host)) return null
  u.hash = ''
  return u.href
}

export function storeResearchTool(opts: {
  catalog: AiCatalogSession; callModel: ModelCall; hasAccess: () => Promise<boolean>; userId: string; timeoutMs: number
}): ToolDefinition {
  return { spec: opts.catalog.tool('ask_store_worker'), version: 1, group: 'Materials, stock and Shopping',
    gate: () => 'available', execute: async raw => {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      const args = raw as { store_url?: unknown; request?: unknown; branch?: unknown } | null
      const shop = shopAddress(args?.store_url)
      if (!shop || typeof args?.request !== 'string' || !args.request.trim() || args.request.length > 3000
        || !(args.branch === null || typeof args.branch === 'string' && args.branch.length <= 200))
        return { status: 'invalid', reason: 'store_research_arguments' }
      // Only the purchase brief leaves the project. No transcript, project
      // identifiers, private source links, images or user identity in the prompt.
      const response = await opts.callModel({ app: 'bob', coworkerId: 'bob', module: 'global',
        functionName: 'store-worker', aiFunction: 'store-worker', catalogRoleKey: 'store-worker',
        catalogSchemaKey: 'bob_store_research', userId: opts.userId, timeoutMs: opts.timeoutMs,
        webSearch: { allowedDomains: [shop.hostname.replace(/^www\./, '')] },
        messages: [{ role: 'user', content: JSON.stringify({ store_url: shop.origin, branch: args.branch,
          request: args.request }) }] })
      if (!await opts.hasAccess()) throw new Error('project_denied')
      if (!response.success) return { status: 'unavailable', reason: 'store_search_unavailable', saved: false }
      if (!response.webSearch?.completedCalls) return { status: 'needs_data', reason: 'store_search_not_performed', saved: false }
      let report: any = response.data
      try { if (typeof report === 'string') report = JSON.parse(report) } catch { report = null }
      if (!Array.isArray(report?.products) || !Array.isArray(report?.missing))
        return { status: 'unavailable', reason: 'store_search_invalid_report', saved: false }
      const sources = new Set(response.webSearch.sources.flatMap(s => {
        const u = productAddress(s.url, shop); return u ? [u] : []
      }))
      // A model-written URL alone is not evidence. Keep only exact URLs the
      // provider actually consulted, on the selected shop's domain.
      const products = report.products.flatMap((p: any) => {
        const url = productAddress(p?.url, shop)
        if (!url || !sources.has(url) || new URL(url).pathname === '/') return []
        const fields = ['name', 'article_number', 'variant', 'dimensions', 'pack', 'price', 'availability', 'match', 'uncertainties']
        if (!fields.every(k => p[k] === null || typeof p[k] === 'string' && p[k].length <= 1500) || !p.name) return []
        return [{ ...Object.fromEntries(fields.map(k => [k, p[k]])), url,
          source_consulted: true, suitability_verified: false, branch_stock_verified: false }]
      }).slice(0, 6)
      return { status: products.length ? 'ok' : 'needs_data', ...(products.length ? {} : { reason: 'no_sourced_store_product' }),
        store_url: shop.origin, branch: args.branch, observed_at: new Date().toISOString(), products,
        missing: report.missing.filter((s: unknown) => typeof s === 'string').map((s: string) => s.slice(0, 1000)).slice(0, 12),
        discarded_products: report.products.length - products.length, saved: false, purchased: false,
        cost_basis: 'native_search_total_unknown',
        note: 'Product candidates from consulted shop pages. Prices, pack sizes and stock are observations, not a reservation or construction approval. Mattias owns saved material and Shopping changes.' }
    } }
}
