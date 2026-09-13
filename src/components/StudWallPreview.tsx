import type { ArtifactGeneration } from '../data/types'
import {
  generateStudWallGeometry,
  STUD_WALL_ROLES,
  type StudWallGeometry,
  type StudWallInputs,
} from '../lib/artifactGeometry'

export const STUD_WALL_ROLE_LABELS = {
  wall_width: 'Wall width',
  wall_height: 'Wall height',
  opening_left: 'Opening distance from left edge',
  opening_sill_height: 'Opening sill / bottom height',
  opening_width: 'Opening width',
  opening_height: 'Opening height',
} as const

const formatMm = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

export function generationInputs(generation: ArtifactGeneration): StudWallInputs | null {
  const byRole = new Map(generation.inputs.map(input => [input.role, input]))
  if (STUD_WALL_ROLES.some(role => !byRole.has(role))) return null
  return Object.fromEntries(STUD_WALL_ROLES.map(role => [role, byRole.get(role)!])) as StudWallInputs
}

export function generationGeometry(generation: ArtifactGeneration): StudWallGeometry | null {
  const inputs = generationInputs(generation)
  if (!inputs) return null
  try { return generateStudWallGeometry(inputs, generation.studSpacingMm) }
  catch { return null }
}

export function StudWallPreview({ geometry, compact = false }: { geometry: StudWallGeometry; compact?: boolean }) {
  const canvasWidth = 680
  const maxWallHeight = compact ? 250 : 360
  const horizontalRoom = canvasWidth - 92
  const scale = Math.min(horizontalRoom / geometry.wallWidthMm, maxWallHeight / geometry.wallHeightMm)
  const wallWidth = geometry.wallWidthMm * scale
  const wallHeight = geometry.wallHeightMm * scale
  const wallX = (canvasWidth - wallWidth) / 2
  const wallY = 38
  const canvasHeight = wallHeight + 92
  const x = (mm: number) => wallX + mm * scale
  const y = (mm: number) => wallY + (geometry.wallHeightMm - mm) * scale
  const openingTop = y(geometry.openingTopMm)
  const openingBottom = y(geometry.openingBottomMm)
  const openingLeft = x(geometry.openingLeftMm)
  const openingRight = x(geometry.openingRightMm)

  return <figure style={{ margin: 0, minWidth: 0 }} aria-label="Generated stud wall elevation">
    <div style={{ width: '100%', overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--surface-2)' }}>
      <svg role="img" aria-label="Deterministic elevation of wall and opening" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        style={{ display: 'block', width: '100%', height: 'auto', color: 'var(--ink)' }}>
        <rect x={wallX} y={wallY} width={wallWidth} height={wallHeight} fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
        {geometry.regularStudXsMm.map(studX => <line key={studX} x1={x(studX)} x2={x(studX)} y1={wallY} y2={wallY + wallHeight}
          stroke="currentColor" strokeWidth="1.5" opacity="0.55" />)}

        <line x1={openingLeft} x2={openingLeft} y1={wallY} y2={wallY + wallHeight} stroke="currentColor" strokeWidth="3" />
        <line x1={openingRight} x2={openingRight} y1={wallY} y2={wallY + wallHeight} stroke="currentColor" strokeWidth="3" />
        <line x1={openingLeft} x2={openingRight} y1={openingTop} y2={openingTop} stroke="currentColor" strokeWidth="4" />
        <line x1={openingLeft} x2={openingRight} y1={openingBottom} y2={openingBottom} stroke="currentColor" strokeWidth="3" />
        <rect x={openingLeft + 2} y={openingTop + 3} width={Math.max(0, openingRight - openingLeft - 4)}
          height={Math.max(0, openingBottom - openingTop - 5)} fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.5" strokeDasharray="7 5" />

        <text x={canvasWidth / 2} y={22} textAnchor="middle" fontSize="13" fill="currentColor">
          Wall {formatMm(geometry.wallWidthMm)} × {formatMm(geometry.wallHeightMm)} mm
        </text>
        <text x={(openingLeft + openingRight) / 2} y={(openingTop + openingBottom) / 2} textAnchor="middle" dominantBaseline="middle"
          fontSize="12" fill="currentColor">Opening {formatMm(geometry.openingWidthMm)} × {formatMm(geometry.openingHeightMm)} mm</text>
        <text x={canvasWidth / 2} y={canvasHeight - 17} textAnchor="middle" fontSize="12" fill="currentColor">
          Regular stud spacing {geometry.studSpacingMm} mm · opening framing conceptual
        </text>
      </svg>
    </div>
    <figcaption className="foundation-hint" style={{ marginTop: 8 }}>
      Deterministic geometry from pinned inputs. Opening-edge framing is conceptual; member widths, header capacity and load paths are not structurally sized here.
    </figcaption>
  </figure>
}
