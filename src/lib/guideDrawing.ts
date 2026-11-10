import { savedSvgPage } from '../../supabase/functions/_shared/saved-drawing-raster'

const imageUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

function firstSheet(encoded: string) {
  const source = new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))
  return savedSvgPage(source, 'front')
}

/** Only the CAD worker's explicit geometry layer can be separated from its labels. */
async function geometryUrl(sheet: ReturnType<typeof savedSvgPage>): Promise<string | null> {
  const root = new DOMParser().parseFromString(sheet.svg, 'image/svg+xml').documentElement
  const geometry = root.querySelector('g[id="DrawingPage1"] > g[id="Geometry"]')
  const definitions = root.querySelector('defs')
  if (!geometry || !definitions?.querySelector('[id="ModelGeometry"]')) return null

  // Keep the SVG inert. Measure its painted extent in a small offscreen image;
  // the returned view uses the original vector paths and their exact transform.
  const model = root.cloneNode(false) as Element
  model.append(definitions.cloneNode(true), geometry.cloneNode(true))
  const serialize = () => imageUrl(new XMLSerializer().serializeToString(model))
  const img = new Image()
  img.src = serialize()
  await img.decode()
  const canvas = document.createElement('canvas')
  const scale = Math.min(480 / sheet.width, 480 / sheet.height)
  canvas.width = Math.max(1, Math.ceil(sheet.width * scale))
  canvas.height = Math.max(1, Math.ceil(sheet.height * scale))
  const ctx = canvas.getContext('2d', {willReadFrequently:true})
  if (!ctx) return null
  ctx.drawImage(img,0,0,canvas.width,canvas.height)
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data
  let left=canvas.width, top=canvas.height, right=-1, bottom=-1
  for (let y=0; y<canvas.height; y++) {
    for (let x=0; x<canvas.width; x++) {
      if (!pixels[(y*canvas.width+x)*4+3]) continue
      left=Math.min(left,x); right=Math.max(right,x)
      top=Math.min(top,y); bottom=Math.max(bottom,y)
    }
  }
  if (right < left) return null
  const sx=sheet.width/canvas.width, sy=sheet.height/canvas.height
  const box = (model.getAttribute('viewBox') ?? '').trim().split(/[,\s]+/).map(Number)
  const width=(right-left+5)*sx, height=(bottom-top+5)*sy
  model.setAttribute('viewBox', `${box[0]+(left-2)*sx} ${box[1]+(top-2)*sy} ${width} ${height}`)
  model.setAttribute('width',String(width))
  model.setAttribute('height',String(height))
  return serialize()
}

export function drawingGeometryUrl(encoded: string) {
  return geometryUrl(firstSheet(encoded))
}

export async function guideDrawingUrl(encoded: string): Promise<string> {
  const sheet = firstSheet(encoded)
  return await geometryUrl(sheet) ?? imageUrl(sheet.svg)
}
