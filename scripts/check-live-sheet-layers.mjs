// Composed into the existing nonce-labelled foundation fixture after 4B2b.
// Ordinary Auth/PostgREST only; no AI, service key, Auth signup or cross-app writes.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data }

export async function verifySheetLayers(client, anonymous, projectId, areaId, artifactId) {
  const project = checked(await client.from('projects').select('name,type,description').eq('id', projectId).single())
  assert.equal(project.type, 'Verification')
  assert.match(project.name, /^Bob foundations verification [0-9a-f-]{36}$/)
  assert.equal(project.description, 'Disposable media/task foundation verification. No real project data.')
  const artifact = checked(await client.from('current_artifacts').select('*').eq('project_id', projectId).eq('id', artifactId).single())
  assert.equal(artifact.area_id, areaId)
  assert.equal(artifact.generator, 'stud_wall_opening_v1')
  const targets = checked(await client.from('current_target').select('*').eq('project_id', projectId))
  const target = targets.find(item => item.area_id === areaId) ?? targets.find(item => item.area_id === null)
  assert(target?.solution_id, 'Use the current exact effective target')
  const taskId = 't_sheet_layer_' + randomUUID(), stockId = randomUUID(), requirementId = randomUUID(), packId = randomUUID()
  checked(await client.from('tasks').insert({ id: taskId, area_id: areaId, name: 'Disposable sheet-layer work' }))
  checked(await client.rpc('stock_command', {
    p_project: projectId, p_action: 'create', p_stock: stockId, p_expected: 0,
    p_data: { name: 'Disposable compatible sheet stock', quantity: '2', unit: 'm2', status: 'available', area_id: areaId },
  }))
  const layer = { layer_count: '2', coverage_kind: 'sheet_dimensions', coverage_truth: 'provided_spec', coverage_source: 'Disposable product packaging fixture', sheet_width_mm: '1200', sheet_height_mm: '2400' }
  const input = {
    name: 'Disposable sheet layer', category: 'Sheet material', area_id: areaId, task_id: taskId,
    artifact_id: artifactId, artifact_revision: artifact.revision, target_revision: target.revision,
    waste_percent: '10', assumptions: 'Area-based fixture, not a cut or layout plan.',
    stock_allocations: [{ id: stockId, revision: 1, quantity: '2' }], sheet_layer: layer,
  }
  const calculate = (id, action, expected, data) => client.rpc('material_requirement_geometry_command', {
    p_project: projectId, p_action: action, p_requirement: id, p_expected: expected, p_data: data,
  })
  const command = (id, action, expected) => client.rpc('material_requirement_command', {
    p_project: projectId, p_action: action, p_requirement: id, p_expected: expected, p_data: {},
  })
  const read = id => client.from('current_material_requirements').select('*').eq('project_id', projectId).eq('id', id).single()
  const materialReadiness = async () => checked(await client.from('task_material_readiness').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  checked(await calculate(requirementId, 'create', 0, input))
  let row = checked(await read(requirementId))
  assert.equal(row.method_key, 'stud_wall_sheet_layer'); assert.equal(row.method_version, '1')
  assert.equal(row.source_kind, 'deterministic'); assert.equal(row.unit, 'm2')
  assert.equal(row.sheet_layer.layer_count, 2)
  assert.equal(row.sheet_layer.net_wall_area_m2, '8.628')
  assert.equal(row.sheet_layer.unit_coverage_m2, '2.88')
  assert.equal(Number(row.required_quantity), 17.256)
  assert.equal(Number(row.required_with_waste), 18.9816)
  assert.equal(Number(row.stock_quantity), 2)
  assert.equal(Number(row.purchase_quantity), 17.28)
  assert.match(row.basis, /AREA-BASED ONLY/)
  assert.equal((await materialReadiness()).ready, false)
  assert((await calculate(randomUUID(), 'create', 0, { ...input, purchase_increment: '999' })).error, 'Sheet purchase increments are server-owned')
  assert((await anonymous.rpc('material_requirement_geometry_command', {
    p_project: projectId, p_action: 'create', p_requirement: randomUUID(), p_expected: 0, p_data: input,
  })).error, 'Unsigned calculation must fail')
  assert((await client.rpc('material_requirement_geometry_command', {
    p_project: 'p_bygga_in_entren', p_action: 'create', p_requirement: randomUUID(), p_expected: 0, p_data: input,
  })).error, 'Disposable membership grants no real-project calculation access')
  assert((await client.from('material_requirement_revisions').update({ sheet_layer: {} }).eq('project_id', projectId).eq('requirement_id', requirementId)).error,
    'Raw recipe changes are denied')

  const published = checked(await command(requirementId, 'publish', 1))
  const shopping = () => client.from('materials').select('*').eq('project_id', projectId).eq('id', published.material_id).single()
  assert.equal(checked(await shopping()).qty, '6 sheets (17.28 m²)')
  checked(await client.from('materials').update({ status: 'ordered', supplier: 'Disposable sheet supplier', cost: '456 kr' })
    .eq('project_id', projectId).eq('id', published.material_id))
  assert.equal((await materialReadiness()).ready, false, 'Ordered is not delivered')
  checked(await client.from('materials').update({ status: 'delivered' }).eq('project_id', projectId).eq('id', published.material_id))
  assert.equal((await materialReadiness()).ready, true)
  checked(await calculate(requirementId, 'revise', 1, { ...input, sheet_layer: { ...layer, layer_count: '1' }, change_note: 'One layer explicitly selected' }))
  assert.equal(checked(await shopping()).qty, '6 sheets (17.28 m²)', 'A revision does not implicitly publish')
  assert.equal((await materialReadiness()).ready, false, 'A newer material version makes the old Shopping snapshot insufficient')
  checked(await command(requirementId, 'publish', 2))
  const updated = checked(await shopping())
  assert.equal(updated.qty, '3 sheets (8.64 m²)')
  assert.equal(updated.status, 'delivered'); assert.equal(updated.supplier, 'Disposable sheet supplier'); assert.equal(updated.cost, '456 kr')
  assert.equal((await materialReadiness()).ready, true)
  const history = checked(await client.from('material_requirement_revisions').select('revision,sheet_layer')
    .eq('project_id', projectId).eq('requirement_id', requirementId).order('revision'))
  assert.deepEqual(history.map(item => item.sheet_layer.layer_count), [2, 1])
  checked(await command(requirementId, 'archive', 2))
  checked(await command(requirementId, 'restore', 3))
  row = checked(await read(requirementId))
  assert.equal(row.revision, 4); assert.equal(row.sheet_layer.layer_count, 1)

  // Positive deletion / missing-item recovery catches FK-trigger regressions.
  checked(await client.from('materials').delete().eq('project_id', projectId).eq('id', published.material_id))
  const missing = checked(await client.from('material_requirement_shopping_state').select('*')
    .eq('project_id', projectId).eq('requirement_id', requirementId).single())
  assert.equal(missing.material_missing, true)
  const recovered = checked(await command(requirementId, 'publish', 4))
  assert.equal(checked(await client.from('materials').select('qty,status').eq('project_id', projectId).eq('id', recovered.material_id).single()).qty,
    '3 sheets (8.64 m²)')

  checked(await calculate(packId, 'create', 0, {
    ...input, name: 'Disposable pack layer', task_id: null, waste_percent: '0', stock_allocations: [],
    sheet_layer: { layer_count: '1', coverage_kind: 'pack_coverage', coverage_truth: 'estimated', coverage_source: 'Disposable pack coverage estimate', pack_coverage_m2: '4.314' },
  }))
  const pack = checked(await read(packId))
  assert.equal(pack.sheet_layer.pack_coverage_m2, '4.314')
  assert.match(pack.basis, /contains explicit estimate/)
  const packPublish = checked(await command(packId, 'publish', 1))
  assert.equal(checked(await client.from('materials').select('qty').eq('project_id', projectId).eq('id', packPublish.material_id).single()).qty, '2 packs (8.628 m²)')
  console.log('Live sheet layers: exact drawing/layer/product recipe, allowance/stock/whole purchase units, sheet and estimated pack paths, explicit Shopping/delivery/readiness, revision history, archive/restore, deletion recovery and raw/anonymous/foreign-project denial passed. No AI invoked.')
}
