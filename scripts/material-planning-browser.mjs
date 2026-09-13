import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const key = (id, revision) => `${id}:${revision}`
const number = value => Number(String(value ?? 0))
const round4Up = value => Math.ceil(value * 10000) / 10000

export function createMaterialPlanningFixture(timestamp, facts, solutions, artifacts) {
  const stocks = new Map()
  const stockHistory = new Map()
  const requirements = new Map()
  const requirementHistory = new Map()
  const allocations = new Map()
  const shoppingLinks = new Map()
  const materials = new Map()

  const currentTarget = projectId => {
    const decision = [...solutions.decisions].reverse().find(item => item.project_id === projectId)
    if (!decision?.solution_id) return null
    const solution = solutions.histories.get(decision.solution_id)?.find(item => item.revision === decision.solution_revision)
    return solution ? { decision, solution } : null
  }

  const currentArtifact = (projectId, id) => {
    const row = artifacts.records.get(id)
    return row?.project_id === projectId && !row.archived ? row : null
  }

  const currentComponent = (projectId, id) => {
    const row = facts.records.component.get(id)
    return row?.project_id === projectId && !row.archived ? row : null
  }

  const stale = row => {
    const target = currentTarget(row.project_id)
    const artifact = row.artifact_id ? currentArtifact(row.project_id, row.artifact_id) : null
    const saved = allocations.get(key(row.id, row.revision)) ?? { stock: [], components: [] }
    return {
      targetChanged: !target || target.decision.revision !== row.target_revision,
      artifactChanged: Boolean(row.artifact_id && (!artifact || artifact.revision !== row.artifact_revision)),
      stockChanged: saved.stock.some(item => stocks.get(item.id)?.revision !== item.revision),
      componentChanged: saved.components.some(item => currentComponent(row.project_id, item.id)?.revision !== item.revision),
    }
  }

  const materialRow = (row, state = {}) => ({
    ...row,
    target_changed: state.targetChanged ?? false,
    artifact_changed: state.artifactChanged ?? false,
    stock_changed: state.stockChanged ?? false,
    component_changed: state.componentChanged ?? false,
  })

  const saveStock = row => {
    stocks.set(row.id, row)
    stockHistory.set(row.id, [...(stockHistory.get(row.id) ?? []), structuredClone(row)])
  }

  const saveRequirement = (row, savedAllocations) => {
    requirements.set(row.id, row)
    requirementHistory.set(row.id, [...(requirementHistory.get(row.id) ?? []), structuredClone(row)])
    allocations.set(key(row.id, row.revision), structuredClone(savedAllocations))
  }

  const fixture = {
    stocks, stockHistory, requirements, requirementHistory, allocations, shoppingLinks, materials,
    async handle(request, url, respond) {
      const table = url.pathname.split('/').at(-1)
      const handled = new Set([
        'current_stock_items', 'stock_revisions', 'current_material_requirements', 'material_requirement_revisions',
        'material_requirement_stock_details', 'material_requirement_component_details', 'material_requirement_shopping_state',
        'stock_command', 'material_requirement_command', 'materials',
      ])
      if (!handled.has(table)) return false
      const eq = field => url.searchParams.get(field)?.replace(/^eq\./, '')
      const reply = async options => { await respond(options); return true }
      const fail = message => reply({ status: 409, json: { message } })
      const projectId = eq('project_id') ?? request.postDataJSON?.()?.p_project

      if (table === 'materials') {
        if (request.method() === 'PATCH') {
          const row = materials.get(eq('id'))
          if (!row) return fail('Shopping item unavailable')
          Object.assign(row, request.postDataJSON())
          return reply({ json: null })
        }
        let rows = [...materials.values()].filter(row => row.project_id === eq('project_id'))
        rows.sort((a, b) => a.sort_order - b.sort_order)
        return reply({ json: rows })
      }

      if (table === 'stock_command') {
        const { p_project, p_action: action, p_stock: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = stocks.get(id)
        if (action !== 'create' && old?.revision !== expected) return fail('Stock changed. Reload before saving again.')
        let row
        if (action === 'archive' || action === 'restore') {
          row = { ...old, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored' }
        } else {
          row = {
            ...old, id, stock_id: id, project_id: p_project, revision: (old?.revision ?? 0) + 1,
            name: data.name, specification: data.specification ?? '', quantity: String(data.quantity), unit: data.unit,
            status: data.status, area_id: data.area_id ?? null, area_title: data.area_id === 'areaA' ? 'Entry' : '',
            notes: data.notes ?? '', archived: false, change_note: action === 'create' ? 'Initial stock' : data.change_note,
            actor_label: 'Fixture member', recorded_at: timestamp(),
          }
          saveStock(row)
          return reply({ json: { id, revision: row.revision } })
        }
        row = { ...row, revision: old.revision + 1, actor_label: 'Fixture member', recorded_at: timestamp() }
        saveStock(row)
        return reply({ json: { id, revision: row.revision } })
      }

      if (table === 'material_requirement_command') {
        const { p_project, p_action: action, p_requirement: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = requirements.get(id)
        if (action === 'publish') {
          if (!old || old.revision !== expected) return fail('Material requirement changed. Reload before updating Shopping.')
          const state = stale(old)
          if (Object.values(state).some(Boolean)) return fail('Material requirement sources changed. Review it before updating Shopping.')
          let link = shoppingLinks.get(id)
          let material = link ? materials.get(link.material_id) : null
          if (!material) {
            material = {
              id: randomUUID(), project_id: p_project, name: old.name, qty: `${old.purchase_quantity} ${old.unit}`,
              area_label: old.area_title || 'Several', supplier: '', status: 'needed', cost: '', category: old.category,
              category_icon: 'package', sort_order: materials.size + 1,
            }
            materials.set(material.id, material)
          } else {
            Object.assign(material, {
              name: old.name, qty: `${old.purchase_quantity} ${old.unit}`, area_label: old.area_title || 'Several', category: old.category,
            })
          }
          link = {
            requirement_id: id, material_id: material.id, synced_requirement_revision: old.revision,
            synced_name: material.name, synced_qty: material.qty, synced_area: material.area_label, synced_category: material.category,
          }
          shoppingLinks.set(id, link)
          return reply({ json: { id, revision: old.revision, material_id: material.id } })
        }

        if (action !== 'create' && old?.revision !== expected) return fail('Material requirement changed. Reload before saving again.')
        if (action === 'archive' || action === 'restore') {
          const row = { ...old, revision: old.revision + 1, archived: action === 'archive', change_note: action === 'archive' ? 'Archived' : 'Restored', actor_label: 'Fixture member', recorded_at: timestamp() }
          saveRequirement(row, allocations.get(key(old.id, old.revision)) ?? { stock: [], components: [] })
          return reply({ json: { id, revision: row.revision } })
        }

        const target = currentTarget(p_project)
        if (!target || target.decision.revision !== data.target_revision) return fail('Project target changed. Reload before saving the material requirement.')
        const artifact = data.artifact_id ? currentArtifact(p_project, data.artifact_id) : null
        if (data.artifact_id && (!artifact || artifact.revision !== data.artifact_revision)) return fail('Drawing version unavailable in this project')

        const stockRefs = []
        let stockQuantity = 0
        for (const ref of data.stock_allocations ?? []) {
          const stock = stocks.get(ref.id)
          if (!stock || stock.project_id !== p_project || stock.revision !== ref.revision || stock.archived || stock.status !== 'available' || stock.unit !== data.unit) return fail('Stock changed. Review the material requirement before reserving it.')
          const quantity = number(ref.quantity)
          if (quantity <= 0 || quantity > number(stock.quantity)) return fail('Stock quantity is already reserved by another active material requirement')
          stockQuantity += quantity
          stockRefs.push({ id: ref.id, revision: ref.revision, quantity: String(ref.quantity) })
        }

        const componentRefs = []
        let componentQuantity = 0
        for (const ref of data.component_allocations ?? []) {
          const component = currentComponent(p_project, ref.id)
          if (!component || component.revision !== ref.revision || component.intent !== 'reuse' || component.quantity === null) return fail('Reusable component changed. Review the material requirement before reserving it.')
          const quantity = number(ref.quantity)
          if (data.unit !== 'pcs' || quantity <= 0 || quantity > component.quantity) return fail('Reusable component quantity is already reserved by another active material requirement')
          componentQuantity += quantity
          componentRefs.push({ id: ref.id, revision: ref.revision, quantity })
        }

        const required = number(data.required_quantity)
        const waste = number(data.waste_percent)
        const increment = number(data.purchase_increment)
        const requiredWithWaste = round4Up(required * (1 + waste / 100))
        const shortfall = Math.max(requiredWithWaste - stockQuantity - componentQuantity, 0)
        const purchase = increment > 0 ? Math.ceil(shortfall / increment) * increment : 0
        const revision = (old?.revision ?? 0) + 1
        const row = {
          ...old, id, requirement_id: id, project_id: p_project, revision,
          name: data.name, category: data.category, area_id: data.area_id ?? null, area_title: data.area_id === 'areaA' ? 'Entry' : '',
          task_id: data.task_id ?? null, task_title: data.task_id === 'taskA' ? 'Prepare opening' : '', unit: data.unit,
          required_quantity: String(required), waste_percent: String(waste), purchase_increment: String(increment),
          required_with_waste: String(requiredWithWaste), stock_quantity: String(stockQuantity), component_quantity: String(componentQuantity), purchase_quantity: String(purchase),
          source_kind: 'manual', method_key: 'manual_base', method_version: '4B2a-v1', basis: data.basis, assumptions: data.assumptions ?? '',
          artifact_id: artifact?.id ?? null, artifact_revision: artifact?.revision ?? null, artifact_title: artifact?.title ?? '',
          target_revision: target.decision.revision, solution_id: target.decision.solution_id, solution_revision: target.decision.solution_revision,
          solution_title: target.solution.title, archived: false, change_note: action === 'create' ? 'Initial material requirement' : data.change_note,
          actor_label: 'Fixture member', recorded_at: timestamp(),
        }
        saveRequirement(row, { stock: stockRefs, components: componentRefs })
        return reply({ json: { id, revision } })
      }

      if (table === 'current_stock_items') {
        let rows = [...stocks.values()].filter(row => row.project_id === eq('project_id'))
        if (eq('archived')) rows = rows.filter(row => row.archived === (eq('archived') === 'true'))
        rows.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
        return reply({ json: rows.slice(offset, offset + limit) })
      }
      if (table === 'stock_revisions') {
        let rows = [...(stockHistory.get(eq('stock_id')) ?? [])].filter(row => row.project_id === eq('project_id')).reverse()
        if (eq('revision')) rows = rows.filter(row => row.revision === Number(eq('revision')))
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
        return reply({ json: eq('revision') ? rows[0] ?? null : rows.slice(offset, offset + limit) })
      }
      if (table === 'current_material_requirements') {
        let rows = [...requirements.values()].filter(row => row.project_id === eq('project_id'))
        if (eq('archived')) rows = rows.filter(row => row.archived === (eq('archived') === 'true'))
        if (eq('area_id')) rows = rows.filter(row => row.area_id === eq('area_id'))
        rows = rows.map(row => materialRow(row, stale(row))).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
        return reply({ json: rows.slice(offset, offset + limit) })
      }
      if (table === 'material_requirement_revisions') {
        let rows = [...(requirementHistory.get(eq('requirement_id')) ?? [])].filter(row => row.project_id === eq('project_id')).reverse()
        if (eq('revision')) rows = rows.filter(row => row.revision === Number(eq('revision')))
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
        return reply({ json: eq('revision') ? materialRow(rows[0], rows[0] ? stale(rows[0]) : {}) ?? null : rows.slice(offset, offset + limit).map(row => materialRow(row, stale(row))) })
      }
      if (table === 'material_requirement_stock_details' || table === 'material_requirement_component_details') {
        const requirementId = eq('requirement_id'), revision = Number(eq('requirement_revision'))
        const saved = allocations.get(key(requirementId, revision)) ?? { stock: [], components: [] }
        if (table === 'material_requirement_stock_details') {
          const rows = saved.stock.map(ref => {
            const historical = stockHistory.get(ref.id)?.find(row => row.revision === ref.revision)
            const current = stocks.get(ref.id)
            return {
              project_id: historical.project_id, requirement_id: requirementId, requirement_revision: revision,
              stock_id: ref.id, stock_revision: ref.revision, quantity: ref.quantity, name: historical.name, specification: historical.specification,
              unit: historical.unit, status: historical.status, area_title: historical.area_title, latest_revision: current.revision,
              current_quantity: current.quantity, current_status: current.status, currently_archived: current.archived,
            }
          })
          return reply({ json: rows })
        }
        const rows = saved.components.map(ref => {
          const historical = facts.histories.get(ref.id)?.find(row => row.revision === ref.revision)
          const current = facts.records.component.get(ref.id)
          return {
            project_id: historical.project_id, requirement_id: requirementId, requirement_revision: revision,
            component_id: ref.id, component_revision: ref.revision, quantity: ref.quantity, name: historical.name, kind: historical.kind,
            specification: historical.specification ?? '', intent: historical.intent, latest_revision: current.revision,
            current_quantity: current.quantity, current_intent: current.intent, currently_archived: current.archived,
          }
        })
        return reply({ json: rows })
      }
      if (table === 'material_requirement_shopping_state') {
        const rows = [...requirements.values()].filter(row => row.project_id === eq('project_id')).map(row => {
          const link = shoppingLinks.get(row.id)
          const material = link ? materials.get(link.material_id) : null
          const state = stale(row)
          return {
            project_id: row.project_id, requirement_id: row.id, material_id: link?.material_id ?? null,
            synced_requirement_revision: link?.synced_requirement_revision ?? 0, current_revision: row.revision,
            material_missing: Boolean(link && !material), source_outdated: Boolean(link && link.synced_requirement_revision !== row.revision),
            shopping_edited: Boolean(link && material && (material.name !== link.synced_name || material.qty !== link.synced_qty || material.area_label !== link.synced_area || material.category !== link.synced_category)),
            source_stale: Object.values(state).some(Boolean),
          }
        })
        return reply({ json: rows })
      }
      return false
    },
  }
  return fixture
}

export async function verifyMaterialPlanningBrowser(page, base, fixture, facts, width) {
  const component = [...facts.records.component.values()].find(row => row.name === 'Existing window')
  assert(component, 'Project facts proof must create Existing window before material planning')
  component.intent = 'reuse'
  component.specification = component.specification || '1180×1700'
  component.quantity = 2
  const history = facts.histories.get(component.id)
  const latestHistory = history?.find(row => row.revision === component.revision)
  if (latestHistory) Object.assign(latestHistory, { intent: 'reuse', specification: component.specification, quantity: 2 })

  await page.goto(base + '#/shopping')
  await page.getByRole('link', { name: /Material plan/ }).click()
  await page.getByRole('heading', { name: 'Material plan', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add stock', exact: true }).click()
  let modal = page.getByRole('dialog', { name: 'Add material stock', exact: true })
  await modal.getByLabel('Stock item', { exact: true }).fill('Spare matching window')
  await modal.getByLabel('Specification', { exact: true }).fill('1180×1700, dry stored')
  await modal.getByLabel('Quantity', { exact: true }).fill('1')
  await modal.getByLabel('Unit', { exact: true }).selectOption('pcs')
  await modal.getByLabel('Area', { exact: true }).selectOption('areaA')
  await modal.getByRole('button', { name: 'Save stock', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  const stockCard = page.getByRole('article', { name: 'Spare matching window', exact: true })
  await stockCard.getByText(/1 pcs/).waitFor()

  await page.getByRole('button', { name: 'Add requirement', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Add material requirement', exact: true })
  await modal.getByLabel('Material / requirement', { exact: true }).fill('Windows 1180×1700')
  await modal.getByLabel('Category', { exact: true }).fill('Openings')
  await modal.getByLabel('Area', { exact: true }).selectOption('areaA')
  await modal.getByLabel('Task', { exact: true }).selectOption('taskA')
  const drawing = modal.getByLabel('Drawing basis', { exact: true })
  const drawingOptions = await drawing.locator('option').count()
  assert(drawingOptions > 1, 'Material plan should expose a current drawing as optional lineage')
  await drawing.selectOption({ index: 1 })
  await modal.getByLabel('Base required quantity', { exact: true }).fill('4')
  await modal.getByLabel('Unit', { exact: true }).selectOption('pcs')
  await modal.getByLabel('Waste / allowance %', { exact: true }).fill('0')
  await modal.getByLabel('Purchase increment', { exact: true }).fill('1')
  await modal.getByLabel('Basis for the base quantity', { exact: true }).fill('Four matching openings are needed for the selected entrance target.')
  await modal.getByLabel('Assumptions and limits', { exact: true }).fill('Existing windows still need suitability inspection before installation.')
  await modal.getByLabel('Allocate Spare matching window', { exact: true }).fill('1')
  await modal.getByLabel('Allocate Existing window', { exact: true }).fill('2')
  await modal.getByText(/4 pcs after allowance.*1 stock.*2 reusable.*1 pcs to buy/).waitFor()
  await modal.getByRole('button', { name: 'Save requirement', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })

  const requirement = page.getByRole('article', { name: 'Windows 1180×1700', exact: true })
  await requirement.getByText('1 pcs to buy', { exact: false }).waitFor()
  await requirement.getByRole('button', { name: 'View basis', exact: true }).click()
  let detail = page.getByRole('dialog', { name: /Windows 1180×1700 · Version 1/ })
  await detail.getByText(/Spare matching window: 1 pcs from stock version/).waitFor()
  await detail.getByText(/Existing window: 2 pcs from component version/).waitFor()
  await detail.getByText(/Drawing:/).waitFor()
  await detail.getByRole('button', { name: 'Close', exact: true }).click()

  await requirement.getByRole('button', { name: 'Send to Shopping', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Send to Shopping', exact: true })
  await modal.getByText(/deliberately writes the saved purchase need/).waitFor()
  await modal.getByRole('button', { name: 'Send to Shopping', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await page.locator('a.back-link').filter({ hasText: /^Shopping$/ }).click()
  let shoppingRow = page.getByText('Windows 1180×1700', { exact: true }).locator('..')
  await shoppingRow.getByText('1 pcs', { exact: false }).waitFor()
  await shoppingRow.getByText('From material plan', { exact: true }).waitFor()

  const deliveredWrite = page.waitForResponse(response =>
    response.request().method() === 'PATCH' && response.url().includes('/rest/v1/materials?')
  )
  await shoppingRow.locator('..').click()
  await deliveredWrite
  await page.getByText('Got it', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('Windows 1180×1700', { exact: true }).waitFor()
  await page.getByText('Got it', { exact: true }).waitFor()
  await page.getByRole('link', { name: /Material plan/ }).click()
  await requirement.getByRole('button', { name: 'Revise', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Revise material requirement', exact: true })
  await modal.getByLabel('Base required quantity', { exact: true }).fill('5')
  await modal.getByLabel('Reason for change', { exact: true }).fill('One additional opening confirmed')
  await modal.getByText(/5 pcs after allowance.*1 stock.*2 reusable.*2 pcs to buy/).waitFor()
  await modal.getByRole('button', { name: 'Save new version', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await requirement.getByText('2 pcs to buy', { exact: false }).waitFor()
  await requirement.getByText(/Shopping still reflects material requirement version 1/).waitFor()
  await requirement.getByRole('button', { name: 'Update Shopping', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Update Shopping', exact: true })
  await modal.getByRole('button', { name: 'Update Shopping', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })

  await page.locator('a.back-link').filter({ hasText: /^Shopping$/ }).click()
  shoppingRow = page.getByText('Windows 1180×1700', { exact: true }).locator('..')
  await shoppingRow.getByText('2 pcs', { exact: false }).waitFor()
  await page.getByText('Got it', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('Windows 1180×1700', { exact: true }).waitFor()
  await page.getByText('From material plan', { exact: true }).waitFor()
  await page.getByText('Got it', { exact: true }).waitFor()

  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Material plan / Shopping must fit the viewport')
  await page.screenshot({ path: `test-results/material-plan-${width}.png`, fullPage: true })

  await page.getByRole('link', { name: 'Account', exact: true }).click()
  await page.locator('.card').filter({ hasText: 'Porch B' }).getByRole('button', { name: 'Open', exact: true }).click()
  await page.goto(base + '#/material-plan')
  await page.getByText('Choose a project target before recording material requirements.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('article', { name: 'Spare matching window', exact: true }).count(), 0)
  assert.equal(await page.getByRole('article', { name: 'Windows 1180×1700', exact: true }).count(), 0)
  await page.getByRole('link', { name: 'Account', exact: true }).click()
  await page.locator('.card').filter({ hasText: 'Porch A' }).getByRole('button', { name: 'Open', exact: true }).click()

  assert.equal(fixture.materials.size, 1)
  console.log(`Material plan stock/reuse/arithmetic/Shopping handoff/reload/project isolation passed at ${width}px; HTTP fixtures, no AI.`)
}
