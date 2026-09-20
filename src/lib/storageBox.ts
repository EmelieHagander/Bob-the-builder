/** Versioned 2D recipe. Changing this assembly requires a NEW generator version.
 * Dimensions are design specifications, not observations of the building.
 * Work in integer micrometres; displayed precision is not a cutting tolerance.
 */
export interface StorageBoxRecipe {
  generator: 'storage_box_v1'
  version: 1
  width_mm: number
  height_mm: number
  depth_mm: number
  thickness_mm: number
}
export type BoxView = 'front' | 'plan' | 'section'
export interface BoxPart {
  id: 'B1' | 'S1' | 'F1'
  label: string
  count: number
  lengthMm: number
  widthMm: number
  thicknessMm: number
}
export interface BoxGeometry {
  recipe: StorageBoxRecipe
  innerWidthMm: number
  innerDepthMm: number
  innerHeightMm: number
  parts: BoxPart[]
}
export const BOX_LIMITS = 'Open-top rectangular sheet-material box only. Bottom under all four walls; front and back between the sides. No lid, runners, rebates, hardware, load rating or fit allowance is included. Check material thickness, fixing method and site fit before cutting.'
export const BOX_RECIPE_KEYS = ['generator', 'version', 'width_mm', 'height_mm', 'depth_mm', 'thickness_mm'] as const

function micrometres(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max
    || !/^\d+(?:\.\d{1,3})?$/.test(String(value))) {
    throw new Error(`Dimensions must be positive millimetres, at most ${max}, with no more than 3 decimals.`)
  }
  const integer = Math.round(value * 1000)
  if (!Number.isSafeInteger(integer)) throw new Error('Dimension outside the supported range.')
  return integer
}

export function storageBoxGeometry(value: unknown): BoxGeometry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Drawing recipe is missing.')
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== BOX_RECIPE_KEYS.length || BOX_RECIPE_KEYS.some(key => !Object.prototype.hasOwnProperty.call(v, key))
    || v.generator !== 'storage_box_v1' || v.version !== 1) throw new Error('Unsupported drawing recipe or version.')
  const w = micrometres(v.width_mm, 10000)
  const h = micrometres(v.height_mm, 10000)
  const d = micrometres(v.depth_mm, 10000)
  const t = micrometres(v.thickness_mm, 100)
  if (w <= 2 * t || d <= 2 * t || h <= t) throw new Error('Material thickness leaves no usable interior. Increase the outer dimensions or reduce the thickness.')
  const recipe: StorageBoxRecipe = { generator: 'storage_box_v1', version: 1,
    width_mm: w / 1000, height_mm: h / 1000, depth_mm: d / 1000, thickness_mm: t / 1000 }
  return { recipe, innerWidthMm: (w - 2 * t) / 1000, innerDepthMm: (d - 2 * t) / 1000, innerHeightMm: (h - t) / 1000,
    parts: [
      { id: 'B1', label: 'Bottom', count: 1, lengthMm: w / 1000, widthMm: d / 1000, thicknessMm: t / 1000 },
      { id: 'S1', label: 'Side', count: 2, lengthMm: d / 1000, widthMm: (h - t) / 1000, thicknessMm: t / 1000 },
      { id: 'F1', label: 'Front / back', count: 2, lengthMm: (w - 2 * t) / 1000, widthMm: (h - t) / 1000, thicknessMm: t / 1000 },
    ] }
}

export const formatDrawingMm = (n: number): string => n.toFixed(3).replace(/\.?0+$/, '') || '0'
const xml = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
export const BOX_VIEW_LABELS: Record<BoxView, string> = { front: 'Front elevation', plan: 'Plan · open top', section: 'Section A–A · through centre' }
export interface DrawingStamp { title: string; revision?: number; artifactId?: string; source?: string; status?: string }

/** Controlled vector output only. No user SVG, markup, URLs or executable code. */
export function storageBoxSvg(value: unknown, view: BoxView, stamp: DrawingStamp): string {
  const g = storageBoxGeometry(value)
  if (!Object.prototype.hasOwnProperty.call(BOX_VIEW_LABELS, view)) throw new Error('Unsupported drawing view.')
  const { width_mm: w, height_mm: h, depth_mm: d, thickness_mm: t } = g.recipe
  const horizontal = view === 'section' ? d : w
  const vertical = view === 'plan' ? d : h
  const scale = Math.min(570 / horizontal, 400 / vertical)
  const left = (960 - horizontal * scale) / 2
  const top = 160 + (400 - vertical * scale) / 2
  const right = left + horizontal * scale
  const bottom = top + vertical * scale
  const n = (x: number) => String(Number(x.toFixed(6)))
  const x = (mm: number) => left + mm * scale
  const y = (mm: number) => bottom - mm * scale
  const line = (x1: number, y1: number, x2: number, y2: number, extra = '') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${extra}/>`
  const text = (px: number, py: number, content: unknown, extra = '') => `<text x="${n(px)}" y="${n(py)}" ${extra}>${xml(content)}</text>`
  const rect = (px: number, py: number, width: number, height: number, fill = '#eee') => `<rect x="${n(x(px))}" y="${n(y(py + height))}" width="${n(width * scale)}" height="${n(height * scale)}" fill="${fill}" stroke="#111" stroke-width="1.4"/>`
  const tick = (px: number, py: number) => line(px - 4, py + 4, px + 4, py - 4)
  function horizontalDimension(a: number, b: number, base: number, level: number, label: string): string {
    return line(a, base, a, level + 6) + line(b, base, b, level + 6)
      + line(a, level, b, level) + tick(a, level) + tick(b, level)
      + text((a + b) / 2, level - 9, label, 'text-anchor="middle"')
  }
  function verticalDimension(a: number, b: number, base: number, level: number, label: string): string {
    return line(base, a, level + 6, a) + line(base, b, level + 6, b)
      + line(level, a, level, b) + tick(level, a) + tick(level, b)
      + text(level - 9, (a + b) / 2, label, `text-anchor="middle" transform="rotate(-90 ${n(level - 9)} ${n((a + b) / 2)})"`)
  }
  let panels = ''
  let annotations = ''
  if (view === 'plan') {
    panels = rect(0, 0, t, d) + rect(w - t, 0, t, d) + rect(t, 0, g.innerWidthMm, t) + rect(t, d - t, g.innerWidthMm, t)
    annotations = line(x(w / 2), top - 18, x(w / 2), bottom + 18, 'stroke-dasharray="12 4 2 4"')
      + text(x(w / 2) + 12, top - 14, 'A') + text(x(w / 2) + 12, bottom + 24, 'A')
      + text((left + right) / 2, (top + bottom) / 2, 'B1 below', 'text-anchor="middle"')
      + horizontalDimension(x(t), x(w - t), bottom, bottom + 52, `Inside ${formatDrawingMm(g.innerWidthMm)}`)
      + verticalDimension(y(d - t), y(t), right, right + 75, `Inside ${formatDrawingMm(g.innerDepthMm)}`)
  } else {
    panels = rect(0, 0, horizontal, t)
    if (view === 'front') {
      panels += rect(0, t, t, g.innerHeightMm) + rect(w - t, t, t, g.innerHeightMm) + rect(t, t, g.innerWidthMm, g.innerHeightMm, '#fff')
      annotations = text((left + right) / 2, (top + bottom) / 2, 'F1 · front between S1 sides', 'text-anchor="middle"')
        + horizontalDimension(x(t), x(w - t), bottom, bottom + 52, `F1 width ${formatDrawingMm(g.innerWidthMm)}`)
    } else {
      panels += rect(0, t, t, g.innerHeightMm) + rect(d - t, t, t, g.innerHeightMm)
      annotations = text((left + right) / 2, (top + bottom) / 2, 'Open interior', 'text-anchor="middle"')
        + horizontalDimension(x(t), x(d - t), bottom, bottom + 52, `Inside ${formatDrawingMm(g.innerDepthMm)}`)
    }
    annotations += verticalDimension(top, y(t), right, right + 75, `Inside height ${formatDrawingMm(g.innerHeightMm)}`)
  }
  const dimensions = horizontalDimension(left, right, top, top - 42, formatDrawingMm(horizontal))
    + verticalDimension(top, bottom, left, left - 45, formatDrawingMm(vertical))
  // Long titles cannot push dimensions off the page. Full metadata remains in the accompanying text/table.
  const title = stamp.title.length > 80 ? stamp.title.slice(0, 77) + '…' : stamp.title
  const version = stamp.revision === undefined ? 'UNSAVED PREVIEW' : `Revision ${stamp.revision} · ${stamp.status ?? 'Concept'}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="760" viewBox="0 0 960 760" role="img" aria-label="${xml(`${title} · ${BOX_VIEW_LABELS[view]}`)}">
<title>${xml(title)} · ${xml(BOX_VIEW_LABELS[view])}</title><desc>All dimensions in millimetres. Read written dimensions; do not measure the screen or print. ${xml(BOX_LIMITS)}</desc>
<rect width="960" height="760" fill="white"/>
<g fill="#111" font-family="Arial, sans-serif" font-size="17">${text(30, 33, title, 'font-size="23" font-weight="bold"')}${text(30, 60, BOX_VIEW_LABELS[view])}${text(930, 60, version, 'text-anchor="end" font-size="14"')}
${panels}
<g fill="none" stroke="#111" stroke-width="1">${dimensions.replace(/<text /g, '<text fill="#111" stroke="none" ')}${annotations.replace(/<text /g, '<text fill="#111" stroke="none" ')}</g>
${text(30, 676, `All parts ${formatDrawingMm(t)} mm thick · B1 bottom under walls · F1 front/back between S1 sides`, 'font-size="15"')}
${text(30, 702, 'All dimensions in mm · NOT TO SCALE · Written dimensions govern · Design specification, not site measurement', 'font-size="14"')}
${text(30, 727, stamp.artifactId ? `${stamp.artifactId} · storage_box_v1 / 1` : 'storage_box_v1 / 1 · Working preview', 'font-size="12"')}
</g></svg>`
}

export function storageBoxCutCsv(value: unknown): string {
  const g = storageBoxGeometry(value)
  return ['Part,Description,Quantity,Length_mm,Width_mm,Thickness_mm',
    ...g.parts.map(p => [p.id, p.label, p.count, formatDrawingMm(p.lengthMm), formatDrawingMm(p.widthMm), formatDrawingMm(p.thicknessMm)].join(',')),
    'NOTE,Finished part dimensions only; saw kerf and stock optimisation not included,,,,',
  ].join('\r\n') + '\r\n'
}
