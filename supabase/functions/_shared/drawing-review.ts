import type { createProjectLookup, LookupInput, LookupResult } from './project-lookup.ts'

/** Shared by Bob's image inspection and the independent CAD reviewer. Dynamic
 * project/Step identities and source records belong in data, never this prompt. */
export const DRAWING_REVIEW_INSTRUCTION = `You have received a drawing or design image for the project and Step identified in the accompanying context. Review it carefully against that project's current facts and the Step's intended result. The designer can make drawing errors, and previous deliveries have had quality problems. Treat the returned design as a candidate requiring scrutiny; its title, polish and the designer's confidence are not evidence of correctness.

Establish the source of each important constraint: current project/building records, measured values, the owner's corrections, selected solution, reference images or an explicit working assumption. Inspect the linked Step and relevant room records. Do not let an older image or the candidate itself overwrite known facts. Missing evidence means unverified, not permission to invent a layout.

Check the whole drawing, including its surroundings: room shape and dimensions; compass directions and viewpoint; each window and door's wall, offset from a named corner, width and known opening direction; radiators and fixed obstacles; and the object's placement and clearances. Compare plan, elevations and details as views of the SAME construction. Check counts, sides, access and movement directions, sums of dimension chains, overall dimensions and usable clear heights after material and mattress thicknesses. Distinguish a stated dimension from an apparently scaled distance in pixels.

For every discrepancy, identify the view or part, the conflicting project source, and the precise correction. Preserve confirmed facts when requesting a repair. Recheck the repaired candidate and affected views; a designer's promise is not verification. Separate confirmed errors, unsupported assumptions and physical checks still needed. An indispensable layout or dimension without evidence cannot be called checked. An AI-generated illustration is not CAD geometry and cannot fulfill a dimensioned drawing request, even after visual inspection. Report an unsuccessful CAD delivery explicitly; an illustration may only be described as an illustration.`

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
    notice: 'Caller-scoped current evidence, independent of the designer. Empty or incomplete pages do not establish that site facts are unknown. Do not approve indispensable layout claims lacking source evidence.' }
}
