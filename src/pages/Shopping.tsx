import { useBobSurface } from '../lib/bobSurface'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { ChecklistRow, EmptyState, Icon, LoadFailed, Loading, MaterialPill, useAsync } from '../components/ui'
import { MaterialModal } from '../components/editors'
import type { Material } from '../data/types'
import { categoryLabel } from '../lib/labels'
import { preliminaryConstructionList } from '../domain/constructionPreview'
import { stockGroups, type StockGroup } from '../domain/stockCount'
import { StockCountRow } from '../components/StockCount'

/** Boards and sheets for every current construction, counted per exact material version.
 * A construction that cannot be read or is not ready is counted as skipped, never guessed. */
const STOCK_CATEGORY = 'Boards and sheets'

async function constructionStock(projectId: string) {
  const heads = await db.getBuildConstructions(projectId)
  const groups = new Map<string, StockGroup>()
  let skipped = 0
  for (let i = 0; i < heads.length; i += 4) {
    const batch = await Promise.all(heads.slice(i, i + 4).map(head => db.getBuildConstructionSource(projectId, head.id, head.revision)
      .then(source => ({ head, source }), () => ({ head, source: null }))))
    for (const { head, source } of batch) {
      const preview = source ? preliminaryConstructionList(source) : null
      if (!source || preview?.status !== 'preliminary') { skipped++; continue }
      stockGroups(preview.parts, source.catalog, heads.length > 1 ? head : null, groups)
    }
  }
  return { groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.materialRevision - b.materialRevision), skipped }
}

/** Parse "1 920 kr" → 1920 for a rough running total. */
function parseCost(cost: string): number {
  const digits = cost.replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function Shopping() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'shopping' }, 'Shopping')
  const [version, setVersion] = useState(0)
  const projectId = db.getActiveProjectId() ?? ''
  const { data: groups, error: groupsError } = useAsync(() => db.getMaterialsGrouped(), [version])
  const { data: materials, error: materialsError } = useAsync(() => db.getMaterials(), [version])
  const { data: areas } = useAsync(() => db.getAreas(), [version])
  const listError = groupsError ?? materialsError
  const { data: planSources, error: planSourceError } = useAsync(() => db.getMaterialShoppingSources(projectId), [projectId, version])
  const { data: cutPlanSources, error: cutPlanSourceError } = useAsync(() => db.getCutPlanShoppingSources(projectId), [projectId, version])
  const { data: stock, error: stockError } = useAsync(() => constructionStock(projectId), [projectId, version])
  const [adding, setAdding] = useState(false)
  const [stockSaveFailed, setStockSaveFailed] = useState(false)
  const [bought, setBought] = useState<Record<string, boolean>>({})

  // Treat already-delivered materials as ticked off.
  useEffect(() => {
    if (!materials) return
    const seed: Record<string, boolean> = {}
    materials.forEach((m) => (seed[m.id] = m.status === 'delivered'))
    setBought(seed)
  }, [materials])

  // Ticking persists: got it = delivered, unticked goes back to needed.
  // Optimistic — the checkbox flips immediately and reverts if the write fails.
  const toggle = (m: Material) => {
    const next = !bought[m.id]
    setBought((b) => ({ ...b, [m.id]: next }))
    db.setMaterialStatus(m.id, next ? 'delivered' : 'needed').catch(() => {
      setBought((b) => ({ ...b, [m.id]: !next }))
    })
  }

  // Categories may be people's own words or saved codes; group under one human label.
  // Ticked boards and sheets show on their own card, not twice.
  const stockNames = new Set((stock?.groups ?? []).map(group => group.name))
  const shownGroups = (groups ?? []).map(group => ({ ...group, items: group.items.filter(m => !(m.category === STOCK_CATEGORY && stockNames.has(m.name))) }))
    .filter(group => group.items.length).reduce<{ label: string; icon: string; items: Material[] }[]>((list, group) => {
    const label = categoryLabel(group.category)
    const existing = list.find(item => item.label === label)
    if (existing) existing.items.push(...group.items)
    else list.push({ label, icon: group.icon, items: [...group.items] })
    return list
  }, [])
  const total = materials?.length ?? 0
  const picked = Object.values(bought).filter(Boolean).length
  const estTotal = (materials ?? []).reduce((sum, m) => sum + parseCost(m.cost), 0)
  const sourceByMaterial = new Map((planSources ?? []).filter(item => item.materialId).map(item => [item.materialId!, item]))

  const cutSourceByMaterial = new Map((cutPlanSources ?? []).filter(item => item.source).map(item => [item.materialId, item.source!]))
  const packByMaterial = new Map((cutPlanSources ?? []).filter(item => item.pack).map(item => [item.materialId, item.pack!]))
  const amount = (v: string | number | null) => v === null ? '?' : String(Number(v))

  const row = (m: Material) => {
    const on = bought[m.id]
    const source = sourceByMaterial.get(m.id)
    const cutSource = cutSourceByMaterial.get(m.id)
    const pack = packByMaterial.get(m.id)
    const changed = !!(source?.sourceOutdated || source?.sourceStale || source?.shoppingEdited || pack?.source_state === 'changed' || pack?.shopping_edited || cutSource?.shopping_edited)
    const state = on ? 'bought' : changed ? 'problem' : 'exact'
    const origin = pack ? 'Pack purchase' : cutSource ? 'Cut plans' : source ? 'Material plan' : null
    return (
      <div key={m.id} className="shop-state" data-state={state}><ChecklistRow checked={!!on} onChange={() => toggle(m)} trailing={m.cost}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: on ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>{m.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{m.qty} · {m.area} · {m.supplier}</div>
        </div>
        {!on && m.status === 'ordered' && <div className="ui-row-meta no-print"><MaterialPill status="ordered" /></div>}
      </ChecklistRow>
        {origin && <details className="ui-row-details">
          <summary>{origin}{changed ? ' · changed' : ''}</summary>
          {pack ? <>
            <p>{pack.published ? '' : 'Withdrawn. '}{pack.source_state === 'changed' ? 'Source changed. ' : ''}{pack.shopping_edited ? 'Shopping row edited. ' : ''}{pack.purchase_count ?? '?'} {pack.purchase_unit} × {amount(pack.content_per_purchase_unit)} {pack.content_unit} for {amount(pack.total_quantity)} {pack.content_unit} needed after stock · {amount(pack.surplus_quantity)} {pack.content_unit} surplus.</p>
            <p>{[pack.article.manufacturer || pack.article.supplier, pack.article.article_number, pack.article.variant].filter(Boolean).join(' · ')} · source {pack.article.source_url ? <a href={pack.article.source_url} target="_blank" rel="noreferrer">link</a> : pack.article.source_document}. Declared product data, not checked for suitability.</p>
            <ul>{pack.needs.map(n => <li key={n.requirement_id}>{amount(n.quantity)} {pack.content_unit} · {n.name ?? 'Need unavailable'} · revision {n.requirement_revision}{n.requirement_changed ? ' · changed since publish' : ''}</li>)}</ul>
          </> : cutSource ? <>
            <p>Whole sheets, not finished blanks.{cutSource.shopping_edited ? ' Shopping row edited.' : ''} Check the plan sources, product and pack size before ordering.</p>
            <ul>{cutSource.contributions.map(c => <li key={c.plan_id}>{c.quantity} sheet{c.quantity === 1 ? '' : 's'} · plan revision {c.plan_revision} · <Link to={`/artifacts?drawing=${encodeURIComponent(c.artifact_id)}&revision=${c.artifact_revision}`}>Construction revision {c.artifact_revision}</Link></li>)}</ul>
            {cutSource.truncated && <p>Showing {cutSource.contributions.length} of {cutSource.contribution_count} contributions. Ask Bob to read the remaining plans.</p>}
            {!cutSource.contribution_count && <p>All plan contributions withdrawn. This row is retained for reference.</p>}
          </> : source ? <p>{[source.sourceOutdated && 'Plan updated', source.sourceStale && 'Source changed', source.shoppingEdited && 'Shopping row edited'].filter(Boolean).join(' · ') || 'Up to date with the material plan.'}</p> : null}
        </details>}
      </div>
    )
  }

  // A ticked board or sheet is a real shopping row (one shared truth), found again by its material name.
  const stockRowFor = (group: StockGroup) => (materials ?? []).find(m => m.category === STOCK_CATEGORY && m.name === group.name)
  const toggleStock = async (group: StockGroup, qty: string) => {
    const linked = stockRowFor(group)
    try {
      if (linked) {
        const next = !bought[linked.id]
        setBought(b => ({ ...b, [linked.id]: next }))
        if (next && linked.qty !== qty) await db.updateMaterial(linked.id, { name: linked.name, qty, area: linked.area, supplier: linked.supplier, cost: linked.cost, category: linked.category })
        await db.setMaterialStatus(linked.id, next ? 'delivered' : 'needed')
      } else {
        await db.createMaterial({ name: group.name, qty, area: '', supplier: '', cost: '', category: STOCK_CATEGORY, status: 'delivered' })
      }
    } catch { setStockSaveFailed(true) }
    setVersion(v => v + 1)
  }
  const stockCard = stock && (stock.groups.length > 0 || stock.skipped > 0) && <div className="card" style={{ padding: 'var(--panel-padding)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', marginBottom: 8 }}>
      <Icon name="ruler" weight="fill" size={18} color="var(--accent-2)" />
      <span style={{ fontSize: 14.5, fontWeight: 700 }}>Boards and sheets</span>
      <Link to="/build-lists" style={{ fontSize: 12, marginLeft: 'auto' }}>{stock.skipped ? `${stock.skipped} not counted` : 'Parts'}</Link>
    </div>
    {stockSaveFailed && <p role="alert" className="stock-row-alert">Could not save. Try again.</p>}
    {stock.groups.map(group => { const linked = stockRowFor(group)
      return <StockCountRow key={group.key} group={group} bought={{ checked: !!(linked && bought[linked.id]), onToggle: qty => { setStockSaveFailed(false); void toggleStock(group, qty) } }} /> })}
  </div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Shopping list</h1>
          <p className="page-sub">Every material across the build, grouped by category.</p>
        </div>
        <div className="cluster no-print foundation-actions">
          <Link className="btn" to="/material-plan"><Icon name="calculator" size={15} /> Material plan</Link>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" weight="bold" size={15} /> Add material
          </button>
        </div>
      </div>

      {listError ? <LoadFailed what="The shopping list" onRetry={() => setVersion(v => v + 1)} /> : <>
      {materials && <div style={{ marginTop: 'var(--section-gap)', display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', flexWrap: 'wrap', fontSize: 13.5, color: 'var(--ink-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)' }}>
          <div style={{ width: 200, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: total ? `${(picked / total) * 100}%` : '0%', height: '100%', background: 'var(--leaf)', borderRadius: 999, transition: 'width .3s ease' }} />
          </div>
          <span style={{ fontWeight: 600 }}>{picked} / {total} sorted</span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="receipt" size={15} color="var(--accent-2)" /> Est. total <strong style={{ color: 'var(--ink)' }}>{estTotal.toLocaleString('sv-SE')} kr</strong>
        </span>
      </div>}

      {(planSourceError || cutPlanSourceError) && <div role="alert" className="card" style={{ padding: 'var(--panel-padding)', marginTop: 'var(--section-gap)' }}>
        Shopping sources could not be checked. <button className="btn" onClick={() => setVersion(v => v + 1)}>Retry sources</button>
      </div>}
      {stockError && <p role="alert" className="foundation-hint" style={{ marginTop: 'var(--section-gap)' }}>Boards and sheets from the constructions could not be read.</p>}
      {!groups ? (
        <Loading />
      ) : groups.length === 0 && !stockCard ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="package" title="Nothing on the list yet" hint="Add the first material — it lands here grouped by category." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', marginTop: 'var(--section-gap)', alignItems: 'start' }}>
          {stockCard}
          {shownGroups.map((g) => (
            <div key={g.label} className="card" style={{ padding: 'var(--panel-padding)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', marginBottom: 8 }}>
                <Icon name={g.icon} weight="fill" size={18} color="var(--accent-2)" />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{g.label}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{g.items.length} items</span>
              </div>
              {g.items.map(row)}
            </div>
          ))}
        </div>
      )}
      </>}

      {adding && (
        <MaterialModal
          areas={areas ?? []}
          categories={[...new Set((materials ?? []).map((m) => m.category))]}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
