// Called by the existing live foundation proof in its disposable project. No AI calls.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifyMaterialPlanning(client, anonymous, projectId, areaId, taskId, facts, artifacts) {
  const stockId = randomUUID()
  const requirementId = randomUUID()
  const stockCommand = (action, expected, data = {}) => client.rpc('stock_command', {
    p_project: projectId, p_action: action, p_stock: stockId, p_expected: expected, p_data: data,
  })
  const requirementCommand = (action, expected, data = {}) => client.rpc('material_requirement_command', {
    p_project: projectId, p_action: action, p_requirement: requirementId, p_expected: expected, p_data: data,
  })

  checked(await stockCommand('create', 0, {
    name: 'Disposable matching window stock',
    specification: 'Verification stock only',
    quantity: '1', unit: 'pcs', status: 'available', area_id: areaId, notes: 'Disposable live fixture',
  }))
  let stock = checked(await client.from('current_stock_items').select('*')
    .eq('project_id', projectId).eq('id', stockId).single())
  assert.equal(stock.revision, 1)
  assert.equal(Number(stock.quantity), 1)
  assert.equal(stock.status, 'available')
  assert((await client.from('stock_revisions').update({ quantity: 999 }).eq('stock_id', stockId)).error,
    'Raw material-stock history writes must be denied')
  assert((await anonymous.from('current_stock_items').select('id').eq('project_id', projectId)).error,
    'Unsigned users must not read project material stock')

  const component = checked(await client.from('current_components').select('*')
    .eq('project_id', projectId).eq('id', facts.componentId).single())
  assert.equal(component.intent, 'reuse')
  assert.equal(component.quantity, 2)
  const artifact = checked(await client.from('current_artifacts').select('*')
    .eq('project_id', projectId).eq('id', artifacts.artifactId).single())
  const target = checked(await client.from('current_target').select('*').eq('project_id', projectId).single())

  const requirementData = (requiredQuantity, changeNote = undefined) => ({
    name: 'Disposable windows 1180×1700',
    category: 'Openings',
    area_id: areaId,
    task_id: taskId,
    unit: 'pcs',
    required_quantity: String(requiredQuantity),
    waste_percent: '0',
    purchase_increment: '1',
    basis: 'Disposable manual quantity for hosted 4B2a verification.',
    assumptions: 'Reuse allocation is a project decision, not a suitability approval.',
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    target_revision: target.revision,
    stock_allocations: [{ id: stockId, revision: 1, quantity: '1' }],
    component_allocations: [{ id: facts.componentId, revision: component.revision, quantity: 2 }],
    ...(changeNote ? { change_note: changeNote } : {}),
  })

  checked(await requirementCommand('create', 0, requirementData(4)))
  let requirement = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', requirementId).single())
  assert.equal(requirement.revision, 1)
  assert.equal(Number(requirement.required_quantity), 4)
  assert.equal(Number(requirement.required_with_waste), 4)
  assert.equal(Number(requirement.stock_quantity), 1)
  assert.equal(Number(requirement.component_quantity), 2)
  assert.equal(Number(requirement.purchase_quantity), 1)
  assert.equal(requirement.source_kind, 'manual')
  assert.equal(requirement.method_key, 'manual')
  assert.equal(requirement.method_version, '4B2a-v1')
  assert.equal(requirement.target_revision, target.revision)
  assert.equal(requirement.artifact_id, artifact.id)
  assert.equal(requirement.artifact_revision, artifact.revision)
  assert.equal(requirement.target_changed, false)
  assert.equal(requirement.artifact_changed, false)
  assert.equal(requirement.stock_changed, false)
  assert.equal(requirement.component_changed, false)

  const stockRefs = checked(await client.from('material_requirement_stock_details').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).eq('requirement_revision', 1))
  assert.equal(stockRefs.length, 1)
  assert.equal(stockRefs[0].stock_revision, 1)
  assert.equal(Number(stockRefs[0].quantity), 1)
  const componentRefs = checked(await client.from('material_requirement_component_details').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).eq('requirement_revision', 1))
  assert.equal(componentRefs.length, 1)
  assert.equal(componentRefs[0].component_revision, component.revision)
  assert.equal(Number(componentRefs[0].quantity), 2)
  assert((await client.from('material_requirement_revisions').update({ purchase_quantity: 999 }).eq('requirement_id', requirementId)).error,
    'Raw material-requirement history writes must be denied')
  assert((await client.rpc('stock_command', {
    p_project: 'p_bygga_in_entren', p_action: 'create', p_stock: randomUUID(), p_expected: 0,
    p_data: { name: 'Denied', quantity: '1', unit: 'pcs', status: 'available' },
  })).error, 'Disposable membership must not grant material-stock access to a real project')

  const firstPublish = checked(await requirementCommand('publish', 1))
  assert(firstPublish.material_id)
  const materialId = firstPublish.material_id
  let shopping = checked(await client.from('materials').select('*').eq('project_id', projectId).eq('id', materialId).single())
  assert.equal(shopping.qty, '1 pcs')
  checked(await client.from('materials').update({
    status: 'delivered', supplier: 'Disposable supplier', cost: '123 kr',
  }).eq('project_id', projectId).eq('id', materialId))

  checked(await requirementCommand('revise', 1, requirementData(5, 'One additional disposable opening')))
  requirement = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', requirementId).single())
  assert.equal(requirement.revision, 2)
  assert.equal(Number(requirement.purchase_quantity), 2)
  let sync = checked(await client.from('material_requirement_shopping_state').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  assert.equal(sync.synced_requirement_revision, 1)
  assert.equal(sync.current_revision, 2)
  assert.equal(sync.source_outdated, true)

  const secondPublish = checked(await requirementCommand('publish', 2))
  assert.equal(secondPublish.material_id, materialId)
  shopping = checked(await client.from('materials').select('*').eq('project_id', projectId).eq('id', materialId).single())
  assert.equal(shopping.qty, '2 pcs')
  assert.equal(shopping.status, 'delivered')
  assert.equal(shopping.supplier, 'Disposable supplier')
  assert.equal(shopping.cost, '123 kr')
  sync = checked(await client.from('material_requirement_shopping_state').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  assert.equal(sync.source_outdated, false)
  assert.equal(sync.shopping_edited, false)
  assert.equal(sync.source_stale, false)

  checked(await client.from('materials').update({ qty: '99 pcs' }).eq('project_id', projectId).eq('id', materialId))
  sync = checked(await client.from('material_requirement_shopping_state').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  assert.equal(sync.shopping_edited, true, 'Independent Shopping edits must be disclosed')
  checked(await requirementCommand('publish', 2))
  shopping = checked(await client.from('materials').select('*').eq('project_id', projectId).eq('id', materialId).single())
  assert.equal(shopping.qty, '2 pcs')
  assert.equal(shopping.status, 'delivered')
  assert.equal(shopping.supplier, 'Disposable supplier')
  assert.equal(shopping.cost, '123 kr')

  checked(await stockCommand('revise', 1, {
    name: 'Disposable matching window stock', specification: 'Verification stock only',
    quantity: '2', unit: 'pcs', status: 'available', area_id: areaId, notes: 'Found one more disposable item',
    change_note: 'Make saved requirement stale',
  }))
  stock = checked(await client.from('current_stock_items').select('*')
    .eq('project_id', projectId).eq('id', stockId).single())
  assert.equal(stock.revision, 2)
  requirement = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', requirementId).single())
  assert.equal(requirement.stock_changed, true)
  assert((await requirementCommand('publish', 2)).error,
    'A stale material requirement must be reviewed before Shopping can be updated again')



  const deterministicStockId = randomUUID()
  const deterministicRequirementId = randomUUID()
  const deterministicStock = (action, expected, data = {}) => client.rpc('stock_command', {
    p_project: projectId, p_action: action, p_stock: deterministicStockId, p_expected: expected, p_data: data,
  })
  const deterministicRequirement = (action, expected, data = {}) => client.rpc('material_requirement_geometry_command', {
    p_project: projectId, p_action: action, p_requirement: deterministicRequirementId, p_expected: expected, p_data: data,
  })
  checked(await deterministicStock('create', 0, {
    name: 'Disposable saved wall board', specification: 'Hosted 4B2b verification stock only',
    quantity: '2', unit: 'm2', status: 'available', area_id: areaId, notes: 'Disposable live fixture',
  }))
  let generated = checked(await client.from('current_artifacts').select('*')
    .eq('project_id', projectId).eq('id', artifacts.geometryArtifactId).single())
  assert.equal(generated.generator, 'stud_wall_opening_v1')
  assert.equal(generated.revision, 4)
  const deterministicData = (artifactRevision, wastePercent, changeNote = undefined) => ({
    name: 'Disposable wall board coverage', category: 'Sheet material', area_id: areaId, task_id: taskId,
    waste_percent: String(wastePercent), purchase_increment: '1',
    assumptions: 'Coverage only; sheet layout, fastening and structural design are outside this calculation.',
    artifact_id: artifacts.geometryArtifactId, artifact_revision: artifactRevision, target_revision: target.revision,
    stock_allocations: [{ id: deterministicStockId, revision: 1, quantity: '2' }],
    ...(changeNote ? { change_note: changeNote } : {}),
  })
  checked(await deterministicRequirement('create', 0, deterministicData(generated.revision, 10)))
  let calculated = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', deterministicRequirementId).single())
  assert.equal(Number(calculated.required_quantity), 8.628)
  assert.equal(Number(calculated.required_with_waste), 9.4908)
  assert.equal(Number(calculated.stock_quantity), 2)
  assert.equal(Number(calculated.purchase_quantity), 8)
  assert.equal(calculated.unit, 'm2')
  assert.equal(calculated.source_kind, 'deterministic')
  assert.equal(calculated.method_key, 'stud_wall_net_area')
  assert.equal(calculated.method_version, '4B2b-v1')
  assert.match(calculated.basis, /4200 mm.*2400 mm.*1210 mm.*1200 mm/)
  assert.equal(calculated.artifact_revision, 4)
  assert((await client.rpc('material_requirement_geometry_command', {
    p_project: projectId, p_action: 'create', p_requirement: randomUUID(), p_expected: 0,
    p_data: { ...deterministicData(4, 0), required_quantity: '999' },
  })).error, 'Clients must not forge a deterministic base quantity')
  assert((await anonymous.rpc('material_requirement_geometry_command', {
    p_project: projectId, p_action: 'create', p_requirement: randomUUID(), p_expected: 0, p_data: deterministicData(4, 0),
  })).error, 'Unsigned users must not calculate project material requirements')
  assert((await client.rpc('material_requirement_geometry_command', {
    p_project: 'p_bygga_in_entren', p_action: 'create', p_requirement: randomUUID(), p_expected: 0, p_data: {},
  })).error, 'Disposable membership must not grant deterministic material access to a real project')

  const deterministicPublish = checked(await client.rpc('material_requirement_command', {
    p_project: projectId, p_action: 'publish', p_requirement: deterministicRequirementId, p_expected: 1, p_data: {},
  }))
  let deterministicShopping = checked(await client.from('materials').select('*')
    .eq('project_id', projectId).eq('id', deterministicPublish.material_id).single())
  assert.equal(deterministicShopping.qty, '8 m²')
  checked(await client.from('materials').update({ status: 'delivered', supplier: 'Disposable sheet supplier', cost: '456 kr' })
    .eq('project_id', projectId).eq('id', deterministicPublish.material_id))

  const artifactCommand = (action, expected) => client.rpc('artifact_command', {
    p_project: projectId, p_action: action, p_artifact: artifacts.geometryArtifactId, p_expected: expected, p_data: {},
  })
  checked(await artifactCommand('archive', 4))
  checked(await artifactCommand('restore', 5))
  generated = checked(await client.from('current_artifacts').select('*')
    .eq('project_id', projectId).eq('id', artifacts.geometryArtifactId).single())
  assert.equal(generated.revision, 6)
  calculated = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', deterministicRequirementId).single())
  assert.equal(calculated.artifact_changed, true)
  assert((await client.rpc('material_requirement_command', {
    p_project: projectId, p_action: 'publish', p_requirement: deterministicRequirementId, p_expected: 1, p_data: {},
  })).error, 'A newer generated drawing version must stale the calculated material source')

  checked(await deterministicRequirement('revise', 1, deterministicData(6, 0, 'Recalculate from the current persisted drawing version')))
  calculated = checked(await client.from('current_material_requirements').select('*')
    .eq('project_id', projectId).eq('id', deterministicRequirementId).single())
  assert.equal(calculated.revision, 2)
  assert.equal(calculated.artifact_revision, 6)
  assert.equal(Number(calculated.required_quantity), 8.628)
  assert.equal(Number(calculated.purchase_quantity), 7)
  const deterministicSync = checked(await client.from('material_requirement_shopping_state').select('*')
    .eq('project_id', projectId).eq('requirement_id', deterministicRequirementId).single())
  assert.equal(deterministicSync.source_outdated, true)
  checked(await client.rpc('material_requirement_command', {
    p_project: projectId, p_action: 'publish', p_requirement: deterministicRequirementId, p_expected: 2, p_data: {},
  }))
  deterministicShopping = checked(await client.from('materials').select('*')
    .eq('project_id', projectId).eq('id', deterministicPublish.material_id).single())
  assert.equal(deterministicShopping.qty, '7 m²')
  assert.equal(deterministicShopping.status, 'delivered')
  assert.equal(deterministicShopping.supplier, 'Disposable sheet supplier')
  assert.equal(deterministicShopping.cost, '456 kr')
  console.log('Live material plan: manual + deterministic drawing-derived quantities, exact target/drawing/stock/reuse lineage, transparent arithmetic, Shopping handoff/preservation, stale-source guard, raw-write denial and project authority passed. No AI invoked.')
  return { stockId, requirementId, materialId }
}
