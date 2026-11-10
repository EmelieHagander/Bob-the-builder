import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as db from '../data/database'
import type { ConstructionFasteners } from '../data/buildPreparation'
import { preliminaryConstructionList, type PreliminaryResult } from '../domain/constructionPreview'
import { stockGroups } from '../domain/stockCount'
import { stockSummary } from './StockCount'
import type { BuildGuideNotes, GuidePageLoader } from './CadBuildGuide'
import './StorageBoxDrawing.css'

type GuidePage = NonNullable<BuildGuideNotes['pages']>[number]
type Lists = { preview: PreliminaryResult | null; fasteners: ConstructionFasteners | null; stock: ReturnType<typeof stockSummary>[] } | 'unavailable' | 'none'
type Pack = { pages: { page: GuidePage; label: string; src: string | null }[]; lists: Lists }

const FASTENER_KINDS: Record<string, string> = { screw: 'Screw', nail: 'Nail', bolt: 'Bolt' }
const shortName = (id: string) => id.replace(/^d_/, '').replace(/[_-]+/g, ' ')
const diameter = (value: number) => Number.isInteger(value * 10) ? value.toFixed(1) : String(value)

/** Reads every page and the pinned construction's lists before printing. */
async function readPack(guide: BuildGuideNotes, files: Record<string, string>, label: (page: GuidePage) => string, loadPages?: GuidePageLoader, projectId?: string): Promise<Pack> {
  const pages = Array.isArray(guide.pages) ? guide.pages : []
  let stored: Record<string, string> = {}
  if (guide.store === 'pages') {
    if (!loadPages || !guide.guide_id) throw new Error('pages_unavailable')
    const keys = pages.map(page => page.key), guideId = guide.guide_id
    // At most 30 pages per read (the volunteer reader's bound), a few reads at a time.
    for (let i = 0; i < keys.length; i += 120) {
      const reads = await Promise.all(Array.from({ length: Math.ceil(Math.min(120, keys.length - i) / 30) },
        (_, j) => loadPages(guideId, keys.slice(i + j * 30, Math.min(i + j * 30 + 30, i + 120)))))
      stored = Object.assign(stored, ...reads)
    }
  }
  const list = pages.map(page => {
    const svg = stored[page.key], encoded = files[page.key]
    return { page, label: label(page), src: typeof svg === 'string' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      : guide.store !== 'pages' && typeof encoded === 'string' ? `data:image/svg+xml;base64,${encoded}` : null }
  })
  const pin = guide.construction
  if (!projectId || !pin?.artifact_id || !Number.isInteger(pin.revision)) return { pages: list, lists: 'none' }
  const [source, fasteners] = await Promise.allSettled([
    db.getBuildConstructionSource(projectId, pin.artifact_id, pin.revision),
    db.getBuildConstructionFasteners(projectId, pin.artifact_id, pin.revision),
  ])
  if (source.status === 'rejected') return { pages: list, lists: 'unavailable' }
  const preview = preliminaryConstructionList(source.value)
  const stock = preview.status === 'preliminary' ? [...stockGroups(preview.parts, source.value.catalog).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.materialRevision - b.materialRevision).map(stockSummary) : []
  return { pages: list, lists: { preview, fasteners: fasteners.status === 'fulfilled' ? fasteners.value : null, stock } }
}

function ListsPage({ lists }: { lists: Lists }) {
  if (lists === 'none') return null
  if (lists === 'unavailable') return <p>The shopping and cut lists could not be read, so they are not in this print.</p>
  const { preview, fasteners, stock } = lists
  const parts = preview?.status === 'preliminary' ? preview : null
  return <>
    <h2>Shopping list</h2>
    {stock.length ? <div className="box-parts"><table>
      <thead><tr><th>Material</th><th>Buy</th><th>Raw size</th><th>Parts</th></tr></thead>
      <tbody>{stock.map(row => <tr key={row.name + row.size}><td>{row.name}</td><td>{row.count ? (row.estimate ? '≈ ' : '') + row.count : '?'}</td><td>{row.size}</td><td>{row.parts}</td></tr>)}</tbody>
    </table></div> : <p>{preview && preview.status !== 'preliminary' ? preview.message : 'No boards or sheets to buy.'}</p>}
    {fasteners && <>
      {fasteners.totals.length > 0 && <div className="box-parts"><table>
        <thead><tr><th>Fastener</th><th>Size</th><th>Qty</th></tr></thead>
        <tbody>{fasteners.totals.map(row => <tr key={row.kind + row.diameterMm + 'x' + row.lengthMm}><td>{FASTENER_KINDS[row.kind]}</td><td>Ø {diameter(row.diameterMm)} × {row.lengthMm} mm</td><td>{row.count}</td></tr>)}</tbody>
      </table></div>}
      {fasteners.gluePackages > 0 && <p>Glue: {fasteners.gluePackages} {fasteners.gluePackages === 1 ? 'package' : 'packages'}.</p>}
      {!fasteners.complete && <p>{fasteners.unsizedJoints} {fasteners.unsizedJoints === 1 ? 'joint is' : 'joints are'} not counted yet.</p>}
    </>}
    <p>Counts are rule-of-thumb proposals with no waste added, not a strength check. ≈ means a standard length; enter the real size in the shopping list for an exact count.</p>
    {parts && <>
      <h2>Cut list</h2>
      <div className="box-parts"><table>
        <thead><tr><th>Part</th><th>Material</th><th>Qty</th><th>Blank size (mm)</th><th>Labels</th></tr></thead>
        <tbody>{parts.parts.map(part => <tr key={part.definitionId}><td>{shortName(part.definitionId)}</td><td>{part.materialName}</td><td>{part.quantity}</td>
          <td>{[part.dimensions.x, part.dimensions.y, part.dimensions.z].join(' × ')}</td><td style={{ whiteSpace: 'normal' }}>{part.partLabels.join(', ')}</td></tr>)}</tbody>
      </table></div>
      <p>Uncut blank sizes, not saw cuts. Check before cutting.</p>
    </>}
  </>
}

/** Owner ask 2026-11-09: print the whole guide, with the shopping and cut lists first.
 * Everything is read before the print dialog opens; a missing page is said, never skipped. */
export function CadGuidePrint({ guide, files, title, pageLabel, loadPages, projectId }: {
  guide: BuildGuideNotes; files: Record<string, string>; title: string; pageLabel: (page: GuidePage) => string; loadPages?: GuidePageLoader; projectId?: string
}) {
  const [state, setState] = useState<'idle' | 'reading' | 'failed'>('idle')
  const [pack, setPack] = useState<Pack | null>(null)
  const root = useRef<HTMLDivElement>(null)
  async function start() {
    setState('reading')
    try { setPack(await readPack(guide, files, pageLabel, loadPages, projectId)) } catch { setState('failed') }
  }
  useEffect(() => {
    if (!pack) return
    let live = true
    const finish = () => { if (live) { setPack(null); setState('idle') } }
    window.addEventListener('afterprint', finish)
    const images = [...(root.current?.querySelectorAll('img') ?? [])]
    Promise.all(images.map(image => image.decode().catch(() => undefined))).then(() => {
      if (!live) return
      document.body.classList.add('printing-box-drawing')
      setState('idle')
      try { window.print() } catch { finish() }
    })
    return () => { live = false; window.removeEventListener('afterprint', finish); document.body.classList.remove('printing-box-drawing') }
  }, [pack])
  return <>
    <div className="foundation-actions">
      <button type="button" className="btn" disabled={state === 'reading' || !!pack} onClick={() => void start()}>Print / PDF</button>
    </div>
    {state === 'reading' && <p role="status" className="foundation-hint">Preparing the print…</p>}
    {state === 'failed' && <p role="alert" className="solution-attention">The guide pages could not be read for printing. Try again.</p>}
    {pack && createPortal(<div className="box-print-pack" ref={root}>
      {pack.lists !== 'none' && <article className="box-print-page">
        <h1>{title} · build guide</h1>
        <ListsPage lists={pack.lists} />
      </article>}
      {pack.pages.map(({ page, label, src }, index) => <article className="box-print-page" key={page.key}>
        {index === 0 && pack.lists === 'none' && <h1>{title} · build guide</h1>}
        <h2>{page.section ? `${page.section} · ` : ''}{label}</h2>
        {src ? <img src={src} alt={`${title} — build guide, ${label}`} style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '235mm', margin: '0 auto' }} />
          : <p>This page is missing from the saved version.</p>}
      </article>)}
    </div>, document.body)}
  </>
}
