import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CadDrawing } from '../data/artifacts'
import { cadParts, cadPartMarkers } from '../data/cadParts'
import './StorageBoxDrawing.css'

/** Owner ask 2026-11-15: print the whole real drawing, every saved view on its
 * own page and the parts with their sizes last. Same print path as the guide. */
export function CadDrawingPrint({ views, files, recipe, manifest, title }: {
  views: [string, string][]; files: Record<string, string>; recipe: CadDrawing['recipe']; manifest?: CadDrawing['manifest']; title: string
}) {
  const [printing, setPrinting] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!printing) return
    let live = true
    const finish = () => { if (live) setPrinting(false) }
    window.addEventListener('afterprint', finish)
    const images = [...(root.current?.querySelectorAll('img') ?? [])]
    Promise.all(images.map(image => image.decode().catch(() => undefined))).then(() => {
      if (!live) return
      document.body.classList.add('printing-box-drawing')
      try { window.print() } catch { finish() }
    })
    return () => { live = false; window.removeEventListener('afterprint', finish); document.body.classList.remove('printing-box-drawing') }
  }, [printing])
  const markers = cadPartMarkers(manifest)
  return <>
    <button type="button" className="btn" disabled={printing} onClick={() => setPrinting(true)}>Print drawing / PDF</button>
    {printing && createPortal(<div className="box-print-pack" ref={root}>
      {views.map(([key, label], index) => <article className="box-print-page" key={key}>
        {index === 0 && <h1>{title} · drawing</h1>}
        <h2>{label}</h2>
        <img src={`data:image/svg+xml;base64,${files[key]}`} alt={`${title} — ${label}`} style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '235mm', margin: '0 auto' }} />
      </article>)}
      <article className="box-print-page">
        <h2>Parts and sizes</h2>
        <div className="box-parts"><table><thead><tr>{markers.size > 0 && <th>On drawing</th>}<th>Part</th><th>Quantity</th><th>Size</th><th>Notches or holes</th></tr></thead><tbody>
          {cadParts(recipe).map(d => <tr key={d.id}>{markers.size > 0 && <td>{markers.get(d.id) ?? '—'}</td>}<td>{d.name}</td><td>{d.quantity}</td><td>{d.size}</td><td>{d.cuts || 'None'}</td></tr>)}
        </tbody></table></div>
        <p>Concept · dimensions in mm. Sizes are before notches and holes, with nothing added for saw cuts. Check before cutting.</p>
      </article>
    </div>, document.body)}
  </>
}
