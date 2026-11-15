import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Material } from '../data/types'
import { cadPartMarkers, cadParts } from '../data/cadParts'
import { preliminaryConstructionList } from '../domain/constructionPreview'
import { stockGroups, type StockGroup } from '../domain/stockCount'
import { STOCK_CATEGORY, stockRowFor, tickStock } from '../lib/shoppingTicks'
import { GuideViewer, type BuildGuideNotes, type GuidePageLoader } from './CadBuildGuide'
import { drawingUrl } from './ProjectDrawings'
import { StockCountRow } from './StockCount'
import { ChecklistRow, Icon, useAsync, useProjectVersion } from './ui'
import './StorageBoxDrawing.css'

/** Owner ask 2026-11-15: once the build starts, the project opens on three
 * stages in order: buy, cut, build. Each is ticked off by the crew and kept in
 * the project, so every phone shows the same progress. The first stage not
 * done opens; the others stay folded. State is the card colour, not text. */

/** The newest construction that has a build guide, and that guide. Read once per project version. */
export function useBuildGuide(projectId: string, enabled: boolean) {
  const version = useProjectVersion()
  return useAsync(async () => {
    if (!enabled || !projectId || !db.authEnabled()) return null
    const heads = await db.getBuildConstructions(projectId)
    for (const head of heads.slice(0, 4)) {
      const drawing = await db.getBuildGuideDrawing(projectId, head)
      if (drawing) return drawing
    }
    return null
  }, [projectId, enabled, version], { timeoutMs: 20000 })
}

type Stage = 'shop' | 'cut' | 'build'

function StageCard({ n, title, done, total, open, onToggle, children }: {
  n: number; title: string; done: number; total: number; open: boolean; onToggle: (open: boolean) => void; children: ReactNode
}) {
  const complete = total > 0 && done >= total
  return <details className="card build-stage" data-state={complete ? 'done' : done > 0 ? 'started' : 'todo'} open={open}
    onToggle={event => { if (event.currentTarget.open !== open) onToggle(event.currentTarget.open) }}>
    <summary>
      <span className="build-stage-n" aria-hidden="true">{complete ? <Icon name="check" size={16} /> : n}</span>
      <span className="build-stage-title">{title}</span>
      <span className="build-stage-count">{done} / {total}</span>
    </summary>
    <div className="build-stage-body">{children}</div>
  </details>
}

export function BuildFlow({ guide, children }: { guide: db.BuildGuideDrawing; children?: ReactNode }) {
  const projectVersion = useProjectVersion()
  const [local, setLocal] = useState(0)
  const projectId = guide.projectId
  const { data, error } = useAsync(async () => {
    const [source, materials, checks] = await Promise.all([
      db.getBuildConstructionSource(projectId, guide.construction.id, guide.construction.revision).catch(() => null),
      db.getMaterials(), db.getBuildChecks(projectId, guide.id, guide.revision),
    ])
    const preview = source ? preliminaryConstructionList(source) : null
    const stock = source && preview?.status === 'preliminary' ? [...stockGroups(preview.parts, source.catalog).values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.materialRevision - b.materialRevision) : null
    const stockNote = !source ? 'Boards and sheets could not be counted: the construction could not be read.'
      : preview && preview.status !== 'preliminary' ? preview.message : null
    return { key: guide.id + ':' + guide.revision, stock, stockNote, materials, checks }
  }, [projectId, guide.id, guide.revision, guide.construction.id, guide.construction.revision, projectVersion, local], { keepDataOnError: true })
  const [ticks, setTicks] = useState<{ key: string; on: Set<string>; off: Set<string> }>({ key: '', on: new Set(), off: new Set() })
  const [bought, setBought] = useState<Record<string, boolean>>({})
  // A board or sheet without a shopping row yet: its row is created on the first tick.
  const [newStock, setNewStock] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState(false)
  const [opened, setOpened] = useState<Partial<Record<Stage, boolean>>>({})
  const loadPages = useCallback<GuidePageLoader>((guideId, keys) => db.getCadGuidePages(projectId, guideId, keys), [projectId])

  if (!data) return error ? <section className="card build-flow-note" role="alert">
    <p>The build lists could not be read.</p><button type="button" className="btn" onClick={() => setLocal(n => n + 1)}>Try again</button>
  </section> : <p role="status" className="foundation-hint">Loading the build…</p>

  // Ticks show at once; a failed save puts the box back and says so.
  const pending = ticks.key === data.key ? ticks : { key: data.key, on: new Set<string>(), off: new Set<string>() }
  const isChecked = (item: string) => !pending.off.has(item) && (pending.on.has(item) || data.checks.has(item))
  const check = (item: string, on: boolean) => {
    setFailed(false)
    setTicks(current => {
      const base = current.key === data.key ? current : { key: data.key, on: new Set<string>(), off: new Set<string>() }
      const next = { key: data.key, on: new Set(base.on), off: new Set(base.off) }
      if (on) { next.on.add(item); next.off.delete(item) } else { next.off.add(item); next.on.delete(item) }
      return next
    })
    db.setBuildCheck(projectId, guide.id, guide.revision, item, on).catch(() => {
      setFailed(true)
      setTicks(current => { const next = { ...current, on: new Set(current.on), off: new Set(current.off) }; next.on.delete(item); next.off.delete(item); return next })
    })
  }

  // 1. Shopping: boards and sheets from this construction, then every other shopping row.
  const stock = data.stock ?? []
  const stockNames = new Set(stock.map(group => group.name))
  const rows = data.materials.filter(m => !(m.category === STOCK_CATEGORY && stockNames.has(m.name)))
  const isBought = (m: Material) => bought[m.id] ?? m.status === 'delivered'
  const toggleRow = (m: Material) => {
    const next = !isBought(m)
    setBought(b => ({ ...b, [m.id]: next })); setFailed(false)
    db.setMaterialStatus(m.id, next ? 'delivered' : 'needed').catch(() => { setBought(b => ({ ...b, [m.id]: !next })); setFailed(true) })
  }
  const toggleStock = (group: StockGroup, qty: string) => {
    const linked = stockRowFor(data.materials, group)
    const next = linked ? !isBought(linked) : true
    if (linked) setBought(b => ({ ...b, [linked.id]: next }))
    else setNewStock(s => ({ ...s, [group.key]: true }))
    setFailed(false)
    tickStock(data.materials, group, qty, next).then(() => { if (!linked) setLocal(n => n + 1) }, () => {
      if (linked) setBought(b => ({ ...b, [linked.id]: !next })); else setNewStock(s => ({ ...s, [group.key]: false }))
      setFailed(true)
    })
  }
  const stockBought = (group: StockGroup) => { const linked = stockRowFor(data.materials, group); return linked ? isBought(linked) : !!newStock[group.key] }
  const shopTotal = stock.length + rows.length
  const shopDone = stock.filter(stockBought).length + rows.filter(isBought).length

  // 2. Cutting: one row per part kind, with the P numbers the guide and drawing use.
  const markers = cadPartMarkers(guide.manifest)
  const parts = cadParts(guide.recipe)
  const cutDone = parts.filter(part => isChecked('cut:' + part.id)).length

  // 3. Building: the guide pages, in order.
  const notes = guide.manifest.build_guide as BuildGuideNotes
  const pages = Array.isArray(notes?.pages) ? notes.pages : []
  const pageDone = pages.filter(page => isChecked('page:' + page.key)).length
  const done = new Set(pages.filter(page => isChecked('page:' + page.key)).map(page => page.key))

  const first: Stage = shopDone < shopTotal ? 'shop' : cutDone < parts.length ? 'cut' : 'build'
  const isOpen = (stage: Stage) => opened[stage] ?? stage === first
  const setOpen = (stage: Stage) => (open: boolean) => setOpened(all => ({ ...all, [stage]: open }))

  return <div className="build-flow">
    {failed && <p role="alert" className="stock-row-alert">Could not save. Try again.</p>}
    <StageCard n={1} title="Shopping list" done={shopDone} total={shopTotal} open={isOpen('shop')} onToggle={setOpen('shop')}>
      {data.stockNote && <p className="foundation-hint">{data.stockNote}</p>}
      {stock.map(group => <StockCountRow key={group.key} group={group} bought={{ checked: stockBought(group), onToggle: qty => toggleStock(group, qty) }} />)}
      {rows.map(m => { const on = isBought(m)
        return <div key={m.id} className="shop-state" data-state={on ? 'bought' : 'exact'}><ChecklistRow checked={on} onChange={() => toggleRow(m)}>
          <div className="build-row-text"><span className="build-row-name" data-done={on || undefined}>{m.name}</span><span className="build-row-sub">{m.qty}</span></div>
        </ChecklistRow></div> })}
      {!shopTotal && <p className="foundation-hint">Nothing on the shopping list.</p>}
      <Link className="build-stage-link" to="/shopping">Whole shopping list <Icon name="arrow-right" size={14} /></Link>
    </StageCard>

    <StageCard n={2} title="Cut list" done={cutDone} total={parts.length} open={isOpen('cut')} onToggle={setOpen('cut')}>
      {parts.map(part => { const on = isChecked('cut:' + part.id)
        return <div key={part.id} className="shop-state" data-state={on ? 'bought' : 'exact'}><ChecklistRow checked={on} onChange={() => check('cut:' + part.id, !on)} trailing={`${part.quantity}×`}>
          <div className="build-row-text"><span className="build-row-name" data-done={on || undefined}>{markers.get(part.id) ? markers.get(part.id) + ' · ' : ''}{part.name}</span>
            <span className="build-row-sub">{part.size}</span></div>
        </ChecklistRow></div> })}
      {!parts.length && <p className="foundation-hint">No parts to cut.</p>}
      <Link className="build-stage-link" to={drawingUrl({ id: guide.id, revision: guide.revision })}>Drawing <Icon name="arrow-right" size={14} /></Link>
    </StageCard>

    <StageCard n={3} title="Build guide" done={pageDone} total={pages.length} open={isOpen('build')} onToggle={setOpen('build')}>
      {isOpen('build') && pages.length > 0 && <GuideViewer pages={pages} guide={notes} files={guide.files} title={guide.title} loadPages={loadPages}
        progress={{ done, onToggle: (key, on) => check('page:' + key, on) }} />}
    </StageCard>
    {children}
  </div>
}
