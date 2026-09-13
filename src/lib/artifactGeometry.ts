import type { MeasurementTruth } from '../data/projectFacts'

export const STUD_WALL_ROLES = [
  'wall_width',
  'wall_height',
  'opening_left',
  'opening_sill_height',
  'opening_width',
  'opening_height',
] as const

export type StudWallRole = typeof STUD_WALL_ROLES[number]

export interface GeometryMeasurement {
  id: string
  revision: number
  subject: string
  value: string | null
  unit: string
  truth: MeasurementTruth
  source: string
  latestRevision?: number
  archived?: boolean
}

export type StudWallInputs = Record<StudWallRole, GeometryMeasurement>

export interface StudWallGeometry {
  generator: 'stud_wall_opening_v1'
  generatorVersion: 1
  wallWidthMm: number
  wallHeightMm: number
  openingLeftMm: number
  openingBottomMm: number
  openingWidthMm: number
  openingHeightMm: number
  openingRightMm: number
  openingTopMm: number
  studSpacingMm: number
  regularStudXsMm: number[]
  openingEdgeStudXsMm: [number, number]
  headerYMm: number
  sillYMm: number
  certainty: 'verified_inputs' | 'contains_estimate'
  warnings: string[]
}

const unitFactorToMm = (unit: string): number => {
  if (unit === 'mm') return 1
  if (unit === 'cm') return 10
  if (unit === 'm') return 1000
  throw new Error(`Unsupported length unit: ${unit}`)
}

/** Exact to 0.001 mm for the measurement precision accepted by ProjectFacts. */
export function lengthToThousandthsOfMm(value: string, unit: string): number {
  const text = value.trim()
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) throw new Error(`Invalid stored length: ${value}`)
  const [whole, fraction = ''] = text.split('.')
  const thousandthsOfUnit = Number(whole) * 1000 + Number((fraction + '000').slice(0, 3))
  const result = thousandthsOfUnit * unitFactorToMm(unit)
  if (!Number.isSafeInteger(result)) throw new Error('Length is too large to render safely.')
  return result
}

export function lengthToMm(value: string, unit: string): number {
  return lengthToThousandthsOfMm(value, unit) / 1000
}

function required(input: GeometryMeasurement, role: StudWallRole): number {
  if (input.truth === 'unknown' || input.value === null) {
    throw new Error(`${role.replace(/_/g, ' ')} is unknown. Measure or estimate it explicitly before generating geometry.`)
  }
  return lengthToThousandthsOfMm(input.value, input.unit)
}

export function generateStudWallGeometry(inputs: StudWallInputs, studSpacingMm: number): StudWallGeometry {
  if (!Number.isInteger(studSpacingMm) || studSpacingMm < 200 || studSpacingMm > 1200) {
    throw new Error('Stud spacing must be a whole number from 200 to 1200 mm.')
  }

  const wallWidth = required(inputs.wall_width, 'wall_width')
  const wallHeight = required(inputs.wall_height, 'wall_height')
  const openingLeft = required(inputs.opening_left, 'opening_left')
  const openingBottom = required(inputs.opening_sill_height, 'opening_sill_height')
  const openingWidth = required(inputs.opening_width, 'opening_width')
  const openingHeight = required(inputs.opening_height, 'opening_height')

  if (wallWidth <= 0 || wallHeight <= 0) throw new Error('Wall width and height must be greater than zero.')
  if (openingWidth <= 0 || openingHeight <= 0) throw new Error('Opening width and height must be greater than zero.')

  const openingRight = openingLeft + openingWidth
  const openingTop = openingBottom + openingHeight
  if (openingLeft < 0 || openingBottom < 0 || openingRight > wallWidth || openingTop > wallHeight) {
    throw new Error('The opening must fit completely inside the wall dimensions.')
  }

  const spacing = studSpacingMm * 1000
  const regularStuds: number[] = []
  for (let x = spacing; x < wallWidth; x += spacing) {
    if (x <= openingLeft || x >= openingRight) regularStuds.push(x / 1000)
  }

  const containsEstimate = STUD_WALL_ROLES.some(role => inputs[role].truth === 'estimated')
  return {
    generator: 'stud_wall_opening_v1',
    generatorVersion: 1,
    wallWidthMm: wallWidth / 1000,
    wallHeightMm: wallHeight / 1000,
    openingLeftMm: openingLeft / 1000,
    openingBottomMm: openingBottom / 1000,
    openingWidthMm: openingWidth / 1000,
    openingHeightMm: openingHeight / 1000,
    openingRightMm: openingRight / 1000,
    openingTopMm: openingTop / 1000,
    studSpacingMm,
    regularStudXsMm: regularStuds,
    openingEdgeStudXsMm: [openingLeft / 1000, openingRight / 1000],
    headerYMm: openingTop / 1000,
    sillYMm: openingBottom / 1000,
    certainty: containsEstimate ? 'contains_estimate' : 'verified_inputs',
    warnings: [
      'Opening-edge framing is conceptual. Member widths, header capacity and load paths are not structurally sized by this generator.',
    ],
  }
}
