import type { createProjectLookup, LookupInput, LookupResult } from './project-lookup.ts'

/** Independent caller-scoped reads, not just the designer's selected evidence.
 * Bounded pages remain explicitly incomplete; no service-role domain access. */
export async function collectDrawingReviewEvidence(lookup: ReturnType<typeof createProjectLookup>, hasStep: boolean, hasPhysicalSources = false) {
  const datasets: LookupInput['dataset'][] = ['project', ...(hasPhysicalSources ? ['physical_buildings' as const] : []), ...(hasStep ? ['plan' as const] : []),
    'measurements', 'physical_spaces', 'physical_elements', 'physical_space_measurements', 'physical_relationships']
  const pages: LookupResult[] = []
  const incomplete: LookupInput['dataset'][] = []
  let bytes = 0
  for (const dataset of datasets) {
    let after_id: string | null = null
    const cursors = new Set<string>()
    for (let page = 0; page < 4; page++) {
      const result = await lookup.search({ dataset, query: null, status: null, area_id: null, record_id: null, after_id })
      if (result.status === 'denied') throw new Error('project_denied')
      const size = new TextEncoder().encode(JSON.stringify(result)).length
      if (bytes + size > 120000) { incomplete.push(dataset); break }
      bytes += size; pages.push(result)
      if (!['ok', 'empty'].includes(result.status)) { incomplete.push(dataset); break }
      if (!result.truncated && !result.next_cursor) break
      if (!result.next_cursor || cursors.has(result.next_cursor) || page === 3) { incomplete.push(dataset); break }
      after_id = result.next_cursor; cursors.add(after_id)
    }
  }
  return { pages, incomplete_datasets: incomplete,
    independent_of_designer:true,source_facts_unknown_from_empty_reads:false }
}
