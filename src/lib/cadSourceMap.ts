import { cadParameterTargets, inheritCadParameters, type CadParameters, type ParameterSource } from '../../supabase/functions/_shared/cad-parameters.ts'
import { inheritCadLineage } from '../../supabase/functions/_shared/cad-lineage.ts'
import { parseCadAssemblyRequest } from '../../supabase/functions/_shared/cad-adapter.ts'

export type SourceCategory = 'Measured' | 'Provided specification' | 'Estimate' | 'Design choice' | 'Calculation' | 'Unknown'
export interface CadSourceRow {
  id: string
  category: SourceCategory
  value: number | null
  unit: string
  paths: string[]
  sources: ParameterSource[]
  reason: string
  operands: string[]
  operation?: string
  rounding?: string
}
export interface CadSourceMap {
  state: 'complete' | 'partial' | 'legacy_untracked' | 'invalid' | 'unavailable'
  rows: CadSourceRow[]
  frames: CadParameters['frames']
  coordinates: Record<string, string | null> | null
}

const category = (truth: string): SourceCategory => truth === 'measured' ? 'Measured' : truth === 'provided_spec' ? 'Provided specification' : truth === 'estimated' ? 'Estimate' : 'Unknown'
const empty = (state: CadSourceMap['state']): CadSourceMap => ({ state, rows: [], frames: [], coordinates: null })

/** Reuse the write/detail validators: readback must not turn tampered metadata
 * into evidence. Never reconstruct a measurement from a bare recipe number. */
export function readCadSourceMap(recipe: Record<string, unknown>, manifest: Record<string, unknown> | undefined, projectId?: string): CadSourceMap {
  if (!projectId) return empty('unavailable')
  try {
    const cadRecipe = parseCadAssemblyRequest(recipe)
    if (!cadRecipe) return empty('invalid')
    const hasLineage = !!manifest && Object.prototype.hasOwnProperty.call(manifest, 'bob_lineage')
    // Validate retained legacy metadata as well, even when a complete graph exists.
    if (hasLineage && manifest!.bob_lineage == null) return empty('invalid')
    const lineage = hasLineage ? inheritCadLineage(projectId, { manifest }, cadRecipe, '00000000-0000-4000-8000-000000000000', 1) : null
    if (lineage && lineage.bindings.length !== (manifest!.bob_lineage as { bindings: unknown[] }).bindings.length) return empty('invalid')
    if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'bob_parameters')) {
      const parameters = inheritCadParameters(projectId, cadRecipe, manifest.bob_parameters, structuredClone(cadRecipe))
      const rows = parameters.nodes.map((node): CadSourceRow => ({
        id: node.id,
        category: node.role === 'source' ? category(node.sources[0].truth) : node.role === 'decision' ? 'Design choice' : node.role === 'estimate' ? 'Estimate' : node.role === 'derived' ? 'Calculation' : 'Unknown',
        value: node.normalized.value,
        unit: node.normalized.unit,
        paths: parameters.bindings.filter(binding => binding.node === node.id).map(binding => binding.path),
        sources: node.sources,
        reason: 'reason' in node ? node.reason : '',
        operands: node.role === 'derived' ? node.operands : [],
        ...(node.role === 'derived' ? { operation: node.operation, rounding: node.rounding } : {}),
      }))
      return { state: 'complete', rows, frames: parameters.frames, coordinates: null }
    }
    const rows = [...cadParameterTargets(cadRecipe)].map(([path, target]): CadSourceRow => {
      const binding = lineage?.bindings.find(binding => path === `definitions/${binding.definition_id}/${binding.dimension}`)
      return { id: path, paths: [path], category: binding ? category(binding.source.truth) : 'Unknown', value: target.get(), unit: target.unit,
        sources: binding ? [binding.source] : [], operands: [], reason: binding ? '' : 'No parameter source or decision was recorded for this value.' }
    })
    return { state: hasLineage ? 'partial' : 'legacy_untracked', rows, frames: [], coordinates: lineage?.coordinates ?? null }
  } catch {
    return empty('invalid')
  }
}

export function cadSourceIdentity(source: ParameterSource): string {
  return source.kind === 'project_measurement'
    ? `Project measurement ${source.id} · revision ${source.revision}`
    : `Space measurement ${source.id} · Space ${source.space_id} revision ${source.space_revision} · Building ${source.building_id} · original measurement ${source.measurement_id} revision ${source.measurement_revision}`
}
