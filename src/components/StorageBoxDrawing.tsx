import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BOX_LIMITS, BOX_VIEW_LABELS, formatDrawingMm, storageBoxCutCsv, storageBoxGeometry, storageBoxSvg,
  type BoxGeometry, type BoxView, type DrawingStamp } from '../lib/storageBox'
import './StorageBoxDrawing.css'

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
function Parts({ geometry }: { geometry: BoxGeometry }) {
  return <div className="box-parts" tabIndex={0} aria-label="Finished part dimensions, scroll horizontally if needed">
    <table><caption>Finished parts · all dimensions in mm</caption><thead><tr>
      <th scope="col">Part</th><th scope="col">Quantity</th><th scope="col">Length</th><th scope="col">Width</th><th scope="col">Thickness</th>
    </tr></thead><tbody>{geometry.parts.map(part => <tr key={part.id}>
      <th scope="row">{part.id} · {part.label}</th><td>{part.count}</td><td>{formatDrawingMm(part.lengthMm)}</td>
      <td>{formatDrawingMm(part.widthMm)}</td><td>{formatDrawingMm(part.thicknessMm)}</td>
    </tr>)}</tbody></table>
  </div>
}

export function StorageBoxDrawing({ recipe, stamp, preview = false }: { recipe: unknown; stamp: DrawingStamp; preview?: boolean }) {
  const [view, setView] = useState<BoxView>('front')
  const [zoom, setZoom] = useState(1)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const finish = () => setPrinting(false)
    let nextFrame = 0
    window.addEventListener('afterprint', finish)
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        document.body.classList.add('printing-box-drawing')
        try { window.print() } catch { finish() }
      })
    })
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame)
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-box-drawing')
    }
  }, [printing])
  const result = useMemo(() => {
    try { return { geometry: storageBoxGeometry(recipe), error: '' } }
    catch (error) { return { geometry: null, error: error instanceof Error ? error.message : 'Unsupported drawing recipe.' } }
  }, [recipe])
  const geometry = result.geometry
  if (!geometry) return <p role="alert" className="solution-attention">This version cannot be drawn: {result.error} Its saved evidence has not been changed.</p>
  const shownStamp = preview ? { ...stamp, revision: undefined } : stamp
  const svg = storageBoxSvg(recipe, view, shownStamp)
  const file = `bob-${stamp.artifactId ?? 'storage-box'}-r${stamp.revision ?? 'preview'}`
  return <section className="box-drawing" aria-label="Parametric storage box drawing">
    <p className="foundation-hint">{preview ? 'Unsaved working preview. ' : ''}Design dimensions, not measurements of the room. All dimensions in mm; read the numbers, not the screen scale.</p>
    <div className="foundation-actions" aria-label="Drawing views">
      {(Object.keys(BOX_VIEW_LABELS) as BoxView[]).map(key => <button type="button" className={`btn${view === key ? ' btn-primary' : ''}`}
        key={key} aria-pressed={view === key} onClick={() => { setView(key); setZoom(1) }}>{BOX_VIEW_LABELS[key]}</button>)}
    </div>
    <div className="foundation-actions box-drawing-controls">
      <button type="button" className="btn" onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom drawing out">−</button>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn" onClick={() => setZoom(z => Math.min(3, z + 0.5))} disabled={zoom >= 3} aria-label="Zoom drawing in">+</button>
      <button type="button" className="btn" onClick={() => setZoom(1)}>Reset zoom</button>
      {!preview && <><button type="button" className="btn" onClick={() => download(`${file}-${view}.svg`, svg, 'image/svg+xml')}>Save SVG</button>
        <button type="button" className="btn" onClick={() => download(`${file}-parts.csv`, storageBoxCutCsv(recipe), 'text/csv;charset=utf-8')}>Save parts CSV</button>
        <button type="button" className="btn" disabled={printing} onClick={() => setPrinting(true)}>Print / PDF</button></>}
    </div>
    <div className="box-drawing-viewport" tabIndex={0} aria-label={`${BOX_VIEW_LABELS[view]}. Scroll to read the full drawing.`}>
      <div className="box-drawing-sheet" style={{ width: `${zoom * 100}%`, minWidth: 720 * zoom }}
        dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
    <p className="foundation-hint">Scroll inside the drawing on a phone. The dimensions below remain readable without zooming.</p>
    <dl className="box-dimensions">
      <div><dt>Outside · W × H × D</dt><dd>{[geometry.recipe.width_mm, geometry.recipe.height_mm, geometry.recipe.depth_mm].map(formatDrawingMm).join(' × ')} mm</dd></div>
      <div><dt>Inside · W × H × D</dt><dd>{[geometry.innerWidthMm, geometry.innerHeightMm, geometry.innerDepthMm].map(formatDrawingMm).join(' × ')} mm</dd></div>
    </dl>
    <Parts geometry={geometry} />
    <p className="foundation-hint">B1 is the full bottom. Both S1 sides stand on it. F1 front and back fit between the sides, also on the bottom. These are finished dimensions, not an optimised cutting layout; add saw kerf when laying out stock.</p>
    <p className="solution-attention">{BOX_LIMITS}</p>
    {printing && createPortal(<div className="box-print-pack">
      {(Object.keys(BOX_VIEW_LABELS) as BoxView[]).map(key => <article className="box-print-page" key={key}>
        <div dangerouslySetInnerHTML={{ __html: storageBoxSvg(recipe, key, stamp) }} />
        <p>{stamp.source}</p><p>{BOX_LIMITS}</p>
      </article>)}
      <article className="box-print-page"><h1>{stamp.title} · Revision {stamp.revision}</h1>
        <p>{stamp.source}</p><Parts geometry={geometry} /><p>{BOX_LIMITS}</p>
        <p>Finished dimensions in mm. No stock cutting layout, saw kerf, hardware or purchasing change is included.</p>
        <p>{stamp.artifactId} · storage_box_v1 / 1</p>
      </article>
    </div>, document.body)}
  </section>
}
