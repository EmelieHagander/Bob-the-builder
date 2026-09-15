// Display/input helpers only. Persisted quantities are calculated by the guarded SQL command.
export const SHEET_LAYER_METHOD = 'stud_wall_sheet_layer'
export const SHEET_LAYER_VERSION = '1'
export type SheetCoverageKind = 'sheet_dimensions' | 'pack_coverage'
export type SheetCoverageTruth = 'provided_spec' | 'measured' | 'estimated'

export interface SheetLayerSnapshot {
  layer_count: number
  coverage_kind: SheetCoverageKind
  coverage_truth: SheetCoverageTruth
  coverage_source: string
  sheet_width_mm: string | null
  sheet_height_mm: string | null
  pack_coverage_m2: string | null
  unit_coverage_m2: string
  net_wall_area_m2: string
}

export interface SheetLayerForm {
  layerCount: string
  coverageKind: SheetCoverageKind
  coverageTruth: SheetCoverageTruth | ''
  coverageSource: string
  widthMm: string
  heightMm: string
  packCoverage: string
}

export function sheetLayerForm(value?: SheetLayerSnapshot | null): SheetLayerForm {
  return {
    layerCount: String(value?.layer_count ?? 1),
    coverageKind: value?.coverage_kind ?? 'sheet_dimensions',
    coverageTruth: value?.coverage_truth ?? '',
    coverageSource: value?.coverage_source ?? '',
    widthMm: value?.sheet_width_mm ?? '',
    heightMm: value?.sheet_height_mm ?? '',
    packCoverage: value?.pack_coverage_m2 ?? '',
  }
}

export function sheetLayerInput(value: SheetLayerForm) {
  return {
    layer_count: value.layerCount.trim(),
    coverage_kind: value.coverageKind,
    coverage_truth: value.coverageTruth,
    coverage_source: value.coverageSource.trim(),
    ...(value.coverageKind === 'sheet_dimensions'
      ? { sheet_width_mm: value.widthMm.trim(), sheet_height_mm: value.heightMm.trim() }
      : { pack_coverage_m2: value.packCoverage.trim().replace(',', '.') }),
  }
}

// Four-decimal canonical areas must divide exactly into the saved purchase increment.
// Do not use floating point division + ceil here: it can invent an extra sheet.
function areaUnits(value: string): bigint {
  if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(value)) throw new Error('Saved sheet-layer area is invalid. Reload the material plan.')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, '0'))
}

export function sheetPurchaseCount(quantity: string, increment: string): string {
  const area = areaUnits(quantity), coverage = areaUnits(increment)
  if (coverage <= BigInt(0) || area % coverage !== BigInt(0)) {
    throw new Error('Saved sheet-layer purchase units are inconsistent. Reload the material plan.')
  }
  return String(area / coverage)
}

export function readSheetLayer(value: unknown, method: string): SheetLayerSnapshot | null {
  if (method !== SHEET_LAYER_METHOD) {
    if (value !== null && value !== undefined) throw new Error('Unexpected sheet-layer recipe. Reload the material plan.')
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sheet-layer recipe unavailable. Reload the material plan.')
  const row = value as Record<string, unknown>
  if (!Number.isInteger(row.layer_count) || Number(row.layer_count) < 1 || Number(row.layer_count) > 20
    || !['sheet_dimensions', 'pack_coverage'].includes(String(row.coverage_kind))
    || !['provided_spec', 'measured', 'estimated'].includes(String(row.coverage_truth))
    || typeof row.coverage_source !== 'string' || !row.coverage_source.trim()
    || typeof row.unit_coverage_m2 !== 'string' || areaUnits(row.unit_coverage_m2) <= BigInt(0)
    || typeof row.net_wall_area_m2 !== 'string' || !Number.isFinite(Number(row.net_wall_area_m2)) || Number(row.net_wall_area_m2) <= 0) {
    throw new Error('Sheet-layer recipe is incomplete. Reload the material plan.')
  }
  const sheet = row.coverage_kind === 'sheet_dimensions'
  if (sheet ? (typeof row.sheet_width_mm !== 'string' || typeof row.sheet_height_mm !== 'string' || row.pack_coverage_m2 !== null)
    : (typeof row.pack_coverage_m2 !== 'string' || row.sheet_width_mm !== null || row.sheet_height_mm !== null)) {
    throw new Error('Sheet-layer coverage basis is incomplete. Reload the material plan.')
  }
  return row as unknown as SheetLayerSnapshot
}

export const COVERAGE_TRUTH_LABELS: Record<SheetCoverageTruth, string> = {
  provided_spec: 'Provided product specification', measured: 'Measured product dimensions / coverage', estimated: 'Estimated product dimensions / coverage',
}
