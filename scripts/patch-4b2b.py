from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing marker in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def insert_before(path: str, marker: str, addition: str):
    p = Path(path)
    text = p.read_text()
    if addition.strip() in text:
        return
    if marker not in text:
        raise SystemExit(f'missing insert marker in {path}: {marker[:120]!r}')
    p.write_text(text.replace(marker, addition + marker, 1))

# SQL: select the two composite rows rather than flattening both tables.
replace(
    'supabase/migrations/20260914084207_deterministic_material_quantities.sql',
    '  select ar.*,g.* into artifact,generation\n',
    '  select ar,g into artifact,generation\n',
)

# Data seam: deterministic create/revise uses its own RPC and then the same read-back.
insert_before(
    'src/data/materialPlanning.ts',
    '    async publish(projectId: string, id: string, expected: number) {',
    '''    async editDeterministicRequirement(\n      projectId: string,\n      action: 'create' | 'revise',\n      id: string,\n      expected: number,\n      data: Record<string, unknown> = {},\n    ) {\n      const { db, guard } = connection(projectId)\n      const saved = checked(await db.rpc('material_requirement_geometry_command', {\n        p_project: projectId, p_action: action, p_requirement: id, p_expected: expected, p_data: data,\n      })) as Row\n      guard()\n      return requirementVersion(projectId, id, saved.revision)\n    },\n''',
)
replace(
    'src/data/database.ts',
    'export const editMaterialRequirement = materialPlanning.editRequirement\nexport const publishMaterialRequirement = materialPlanning.publish\n',
    'export const editMaterialRequirement = materialPlanning.editRequirement\nexport const editDeterministicMaterialRequirement = materialPlanning.editDeterministicRequirement\nexport const publishMaterialRequirement = materialPlanning.publish\n',
)

# Material Plan: source-aware calculation labels.
replace(
    'src/pages/MaterialPlan.tsx',
    '<div className="fact-source"><strong>Manual base requirement</strong><span>{formatQuantity(value.requiredQuantity, value.unit)}</span><p>{value.basis}</p></div>',
    '<div className="fact-source"><strong>{value.sourceKind === \'deterministic\' ? \'Calculated base requirement\' : \'Manual base requirement\'}</strong><span>{formatQuantity(value.requiredQuantity, value.unit)}</span><p>{value.basis}</p>{value.sourceKind === \'deterministic\' && <small>Method {value.methodKey} · {value.methodVersion}</small>}</div>',
)
replace(
    'src/pages/MaterialPlan.tsx',
    '<p className="foundation-hint">The base quantity below is a human-entered project value in 4B2a. Bob is not deriving geometry yet.</p>',
    '<p className="foundation-hint">This path records a human-entered base quantity. Use Calculate from drawing when a supported generated wall should own the base quantity instead.</p>',
)

# Dedicated, narrow deterministic editor. It never accepts a client base quantity/unit/basis.
deterministic_editor = r'''function DeterministicRequirementEditor({ projectId, target, value, areas, tasks, artifacts, stock, onClose, onSaved }: {
  projectId: string
  target: SelectedTarget
  value?: MaterialRequirementVersion
  areas: Area[]
  tasks: Task[]
  artifacts: ProjectArtifact[]
  stock: StockItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const currentArtifact = value?.artifactId ? artifacts.find(item => item.id === value.artifactId) : undefined
  const defaultArtifact = currentArtifact ?? artifacts[0]
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [name, setName] = useState(value?.name ?? '')
  const [category, setCategory] = useState(value?.category ?? 'Sheet material')
  const [area, setArea] = useState(value?.areaId ?? '')
  const [task, setTask] = useState(value?.taskId ?? '')
  const [waste, setWaste] = useState(value?.wastePercent ?? '0')
  const [increment, setIncrement] = useState(value?.purchaseIncrement ?? '1')
  const [assumptions, setAssumptions] = useState(value?.assumptions ?? '')
  const [artifactRef, setArtifactRef] = useState(defaultArtifact ? `${defaultArtifact.id}:${defaultArtifact.revision}` : '')
  const [stockQty, setStockQty] = useState<Record<string, string>>(() => Object.fromEntries((value?.stock ?? []).map(item => [item.id, item.quantity])))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = target.solution
  const taskOptions = tasks.filter(item => !area || item.areaId === area)
  const stockOptions = stock.filter(item => !item.archived && item.status === 'available' && item.unit === 'm2')

  return <Modal title={value ? 'Revise calculated requirement' : 'Calculate material from drawing'} wide onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !selected || !artifactRef) return
      setBusy(true); setError('')
      try {
        const [artifactId, artifactRevision] = artifactRef.split(':')
        await db.editDeterministicMaterialRequirement(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          name, category, area_id: area || null, task_id: task || null,
          waste_percent: waste.trim().replace(',', '.'), purchase_increment: increment.trim().replace(',', '.'),
          assumptions, artifact_id: artifactId, artifact_revision: Number(artifactRevision), target_revision: target.decision.revision,
          stock_allocations: stockOptions.flatMap(item => {
            const quantity = stockQty[item.id]?.trim().replace(',', '.')
            return quantity && Number(quantity) > 0 ? [{ id: item.id, revision: item.revision, quantity }] : []
          }),
          ...(value ? { change_note: reason } : {}),
        })
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <div className="fact-source"><strong>Selected project target</strong><p>{selected ? `${selected.title} · Version ${selected.revision}` : 'No target selected'}</p><span>Target decision {target.decision.revision}. A changed target rejects this save.</span></div>
        <p className="foundation-hint">Bob calculates net wall surface from the exact saved stud-wall recipe: wall area minus opening area. The server owns the base quantity, unit, formula and method identity; this form only adds the material meaning, allowance and confirmed stock.</p>
        <Field label="Material / requirement"><input style={inputStyle} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Category"><input style={inputStyle} required maxLength={120} value={category} onChange={event => setCategory(event.target.value)} /></Field>
        <div className="fact-filters">
          <Field label="Area"><select style={inputStyle} value={area} onChange={event => { setArea(event.target.value); setTask('') }}><option value="">Project as a whole</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Task"><select style={inputStyle} value={task} onChange={event => setTask(event.target.value)}><option value="">No task yet</option>{taskOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        </div>
        <Field label="Generated drawing"><select style={inputStyle} required value={artifactRef} onChange={event => setArtifactRef(event.target.value)}>{artifacts.map(item => <option key={item.id} value={`${item.id}:${item.revision}`}>{item.title} · Version {item.revision} · {item.status === 'concept' ? 'Concept' : item.status === 'build_ready' ? 'Build ready' : 'Measured'}</option>)}</select></Field>
        <div className="fact-source"><strong>Calculated base</strong><span>m²</span><p>The exact value is calculated and read back on save. Estimated drawing inputs stay visibly Concept; calculation does not upgrade their certainty.</p></div>
        <div className="fact-filters">
          <Field label="Waste / allowance %"><input style={inputStyle} inputMode="decimal" required value={waste} onChange={event => setWaste(event.target.value)} /></Field>
          <Field label="Purchase increment"><input style={inputStyle} inputMode="decimal" required value={increment} onChange={event => setIncrement(event.target.value)} /></Field>
        </div>
        <Field label="Assumptions and limits"><textarea style={inputStyle} rows={2} maxLength={4000} value={assumptions} onChange={event => setAssumptions(event.target.value)} /></Field>
        <div className="fact-details"><h4>Use confirmed material stock</h4>{!stockOptions.length && <p>No Available stock uses m². Add stock outside this form first.</p>}{stockOptions.map(item => <AllocationInput key={item.id} label={item.name} max={item.quantity} value={stockQty[item.id] ?? ''} unit="m2" onChange={next => setStockQty(values => ({ ...values, [item.id]: next }))} />)}</div>
        {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{busy ? 'Calculating and reading back…' : value ? 'Recalculate and save new version' : 'Save calculated requirement'}</button></div>
      </fieldset>
    </form>
  </Modal>
}

'''
insert_before('src/pages/MaterialPlan.tsx', 'function RequirementVersionDialog(', deterministic_editor)

replace(
    'src/pages/MaterialPlan.tsx',
    "  if (data && !loading && !error && edit) return <RequirementEditor projectId={projectId} target={target} value={data} areas={areas} tasks={tasks} artifacts={artifacts} stock={stock} components={components} onClose={onClose} onSaved={onSaved} />\n",
    "  if (data && !loading && !error && edit) {\n    const generated = artifacts.filter(item => item.generator === 'stud_wall_opening_v1' && item.targetRevision === target.decision.revision)\n    return data.sourceKind === 'deterministic'\n      ? <DeterministicRequirementEditor projectId={projectId} target={target} value={data} areas={areas} tasks={tasks} artifacts={generated} stock={stock} onClose={onClose} onSaved={onSaved} />\n      : <RequirementEditor projectId={projectId} target={target} value={data} areas={areas} tasks={tasks} artifacts={artifacts} stock={stock} components={components} onClose={onClose} onSaved={onSaved} />\n  }\n",
)
replace(
    'src/pages/MaterialPlan.tsx',
    "  const [editor, setEditor] = useState<'new' | { id: string; revision: number } | null>(null)\n",
    "  const [editor, setEditor] = useState<'new' | { id: string; revision: number } | null>(null)\n  const [calculator, setCalculator] = useState(false)\n",
)
replace(
    'src/pages/MaterialPlan.tsx',
    "  const selected = data?.target.solution\n\n",
    "  const selected = data?.target.solution\n  const generatedArtifacts = (data?.artifacts ?? []).filter(item => item.generator === 'stud_wall_opening_v1' && item.targetRevision === data?.target.decision.revision)\n\n",
)
replace(
    'src/pages/MaterialPlan.tsx',
    '<div className="page-head"><div><Link to="/shopping" className="back-link">Shopping</Link><h1 className="page-title">Material plan</h1><p className="page-sub">Keep required, already available and still-to-buy quantities connected to the exact project target.</p></div><button className="btn btn-primary" disabled={!selected} onClick={() => setEditor(\'new\')}>Add requirement</button></div>',
    '<div className="page-head"><div><Link to="/shopping" className="back-link">Shopping</Link><h1 className="page-title">Material plan</h1><p className="page-sub">Keep required, already available and still-to-buy quantities connected to the exact project target.</p></div><div className="foundation-actions"><button className="btn btn-primary" disabled={!selected} onClick={() => setEditor(\'new\')}>Add requirement</button><button className="btn" disabled={!selected || !generatedArtifacts.length} onClick={() => setCalculator(true)}>Calculate from drawing</button></div></div>',
)
replace(
    'src/pages/MaterialPlan.tsx',
    '<section style={{ marginTop: 20 }}><div className="page-head"><div><h2 style={{ margin: 0 }}>Material requirements</h2><p className="foundation-hint">Base quantity is manual in 4B; allowance, allocation and purchase rounding are deterministic.</p></div></div>',
    '<section style={{ marginTop: 20 }}><div className="page-head"><div><h2 style={{ margin: 0 }}>Material requirements</h2><p className="foundation-hint">Base quantity can be manual or calculated from a supported saved drawing. Allowance, allocation and purchase rounding remain deterministic.</p>{selected && !generatedArtifacts.length && <p className="foundation-hint">Need a supported wall calculation? <Link to="/artifacts">Generate a wall elevation in Plans & drawings</Link> first.</p>}</div></div>',
)
replace(
    'src/pages/MaterialPlan.tsx',
    '<span className="image-purpose">Manual base</span>',
    '<span className="image-purpose">{item.sourceKind === \'deterministic\' ? \'Calculated from drawing\' : \'Manual base\'}</span>',
)
replace(
    'src/pages/MaterialPlan.tsx',
    "    {data && editor === 'new' && selected && <RequirementEditor projectId={projectId} target={data.target} areas={data.areas} tasks={data.tasks} artifacts={data.artifacts} stock={data.stock} components={data.components} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); bump() }} />}\n",
    "    {data && editor === 'new' && selected && <RequirementEditor projectId={projectId} target={data.target} areas={data.areas} tasks={data.tasks} artifacts={data.artifacts} stock={data.stock} components={data.components} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); bump() }} />}\n    {data && calculator && selected && generatedArtifacts.length > 0 && <DeterministicRequirementEditor projectId={projectId} target={data.target} areas={data.areas} tasks={data.tasks} artifacts={generatedArtifacts} stock={data.stock} onClose={() => setCalculator(false)} onSaved={() => { setCalculator(false); bump() }} />}\n",
)

# Browser fixture supports the server-owned deterministic RPC.
replace(
    'scripts/material-planning-browser.mjs',
    "        'stock_command', 'material_requirement_command', 'materials',\n",
    "        'stock_command', 'material_requirement_command', 'material_requirement_geometry_command', 'materials',\n",
)
replace(
    'scripts/material-planning-browser.mjs',
    '    stocks, stockHistory, requirements, requirementHistory, allocations, shoppingLinks, materials,\n',
    '    stocks, stockHistory, requirements, requirementHistory, allocations, shoppingLinks, materials, artifacts,\n',
)
geometry_fixture_block = r'''
      if (table === 'material_requirement_geometry_command') {
        const { p_project, p_action: action, p_requirement: id, p_expected: expected, p_data: data } = request.postDataJSON()
        assert.equal(p_project, 'A')
        const old = requirements.get(id)
        if (!['create', 'revise'].includes(action)) return fail('Invalid deterministic material requirement command')
        if (action !== 'create' && old?.revision !== expected) return fail('Material requirement changed. Reload before saving again.')
        for (const forbidden of ['required_quantity', 'unit', 'basis', 'source_kind', 'method_key', 'method_version', 'component_allocations']) {
          if (forbidden in data) return fail('Unsupported deterministic material fields. Quantity, unit, basis, source and method are derived by the server.')
        }
        const artifact = currentArtifact(p_project, data.artifact_id)
        const generation = artifacts.generations.get(key(data.artifact_id, Number(data.artifact_revision)))
        if (!artifact || artifact.revision !== Number(data.artifact_revision) || generation?.generator !== 'stud_wall_opening_v1' || generation.generator_version !== 1) {
          return fail('A current stud_wall_opening_v1 drawing version is required for this calculation')
        }
        const byRole = Object.fromEntries(generation.inputs.map(item => [item.role, item]))
        const mm = item => number(item.value) * (item.unit === 'm' ? 1000 : item.unit === 'cm' ? 10 : 1)
        const wallWidth = mm(byRole.wall_width), wallHeight = mm(byRole.wall_height)
        const openingWidth = mm(byRole.opening_width), openingHeight = mm(byRole.opening_height)
        const required = round4Up((wallWidth * wallHeight - openingWidth * openingHeight) / 1_000_000)
        const target = currentTarget(p_project)
        if (!target || target.decision.revision !== data.target_revision) return fail('Project target changed. Reload before saving the material requirement.')
        const stockRefs = []
        let stockQuantity = 0
        for (const ref of data.stock_allocations ?? []) {
          const savedStock = stocks.get(ref.id)
          if (!savedStock || savedStock.project_id !== p_project || savedStock.revision !== ref.revision || savedStock.archived || savedStock.status !== 'available' || savedStock.unit !== 'm2') return fail('Stock changed. Review the material requirement before reserving it.')
          const quantity = number(ref.quantity)
          if (quantity <= 0 || quantity > number(savedStock.quantity)) return fail('Stock quantity is already reserved by another active material requirement')
          stockQuantity += quantity
          stockRefs.push({ id: ref.id, revision: ref.revision, quantity: String(ref.quantity) })
        }
        const waste = number(data.waste_percent), increment = number(data.purchase_increment)
        const requiredWithWaste = round4Up(required * (1 + waste / 100))
        const purchase = increment > 0 ? Math.ceil(Math.max(requiredWithWaste - stockQuantity, 0) / increment) * increment : 0
        const revision = (old?.revision ?? 0) + 1
        const hasEstimate = generation.inputs.some(item => item.truth === 'estimated')
        const row = {
          ...old, id, requirement_id: id, project_id: p_project, revision,
          name: data.name, category: data.category, area_id: data.area_id ?? null, area_title: data.area_id === 'areaA' ? 'Entry' : '',
          task_id: data.task_id ?? null, task_title: data.task_id === 'taskA' ? 'Prepare opening' : '', unit: 'm2',
          required_quantity: String(required), waste_percent: String(waste), purchase_increment: String(increment),
          required_with_waste: String(requiredWithWaste), stock_quantity: String(stockQuantity), component_quantity: '0', purchase_quantity: String(purchase),
          source_kind: 'deterministic', method_key: 'stud_wall_net_area', method_version: '4B2b-v1',
          basis: `Calculated from ${artifact.title} v${artifact.revision} using stud_wall_net_area 4B2b-v1: (${wallWidth} mm × ${wallHeight} mm − ${openingWidth} mm × ${openingHeight} mm) ÷ 1,000,000 = ${required} m². Input certainty: ${hasEstimate ? 'contains explicit estimate' : 'measured/provided inputs only'}.`,
          assumptions: data.assumptions ?? '', artifact_id: artifact.id, artifact_revision: artifact.revision, artifact_title: artifact.title,
          target_revision: target.decision.revision, solution_id: target.decision.solution_id, solution_revision: target.decision.solution_revision,
          solution_title: target.solution.title, archived: false, change_note: action === 'create' ? 'Initial material requirement' : data.change_note,
          actor_label: 'Fixture member', recorded_at: timestamp(),
        }
        saveRequirement(row, { stock: stockRefs, components: [] })
        return reply({ json: { id, revision } })
      }

'''
insert_before('scripts/material-planning-browser.mjs', "      if (table === 'material_requirement_command') {\n", geometry_fixture_block)

# Browser acceptance: calculate from the generated v2 stud wall, read back, revise, publish.
browser_proof = r'''
  await page.getByRole('link', { name: /Material plan/ }).click()
  await page.getByRole('button', { name: 'Add stock', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Add material stock', exact: true })
  await modal.getByLabel('Stock item', { exact: true }).fill('Saved wall board')
  await modal.getByLabel('Specification', { exact: true }).fill('Area stock for deterministic wall proof')
  await modal.getByLabel('Quantity', { exact: true }).fill('2')
  await modal.getByLabel('Unit', { exact: true }).selectOption('m2')
  await modal.getByLabel('Area', { exact: true }).selectOption('areaA')
  await modal.getByRole('button', { name: 'Save stock', exact: true }).click(); await modal.waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'Calculate from drawing', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Calculate material from drawing', exact: true })
  await modal.getByLabel('Material / requirement', { exact: true }).fill('Wall board coverage')
  await modal.getByLabel('Category', { exact: true }).fill('Sheet material')
  await modal.getByLabel('Area', { exact: true }).selectOption('areaA')
  await modal.getByLabel('Task', { exact: true }).selectOption('taskA')
  await modal.getByLabel('Generated drawing', { exact: true }).selectOption({ label: /Stud wall elevation · Version 2/ })
  assert.equal(await modal.getByLabel('Base required quantity', { exact: true }).count(), 0, 'Calculated flow must not accept a client base quantity')
  await modal.getByLabel('Waste / allowance %', { exact: true }).fill('10')
  await modal.getByLabel('Purchase increment', { exact: true }).fill('1')
  await modal.getByLabel('Assumptions and limits', { exact: true }).fill('Coverage only; sheet layout and fastening are not inferred.')
  await modal.getByLabel('Allocate Saved wall board', { exact: true }).fill('2')
  await modal.getByRole('button', { name: 'Save calculated requirement', exact: true }).click(); await modal.waitFor({ state: 'hidden' })

  const calculated = page.getByRole('article', { name: 'Wall board coverage', exact: true })
  await calculated.getByText('Calculated from drawing', { exact: true }).waitFor()
  await calculated.getByText(/8 m² to buy/).waitFor()
  await calculated.getByText(/8,628 m²/).waitFor()
  await calculated.getByRole('button', { name: 'View basis', exact: true }).click()
  detail = page.getByRole('dialog', { name: /Wall board coverage · Version 1/ })
  await detail.getByText(/stud_wall_net_area · 4B2b-v1/).waitFor()
  await detail.getByText(/Stud wall elevation · Version 2/).waitFor()
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload(); await calculated.getByText('Calculated from drawing', { exact: true }).waitFor()

  await calculated.getByRole('button', { name: 'Revise', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Revise calculated requirement', exact: true })
  assert.equal(await modal.getByLabel('Base required quantity', { exact: true }).count(), 0)
  await modal.getByLabel('Waste / allowance %', { exact: true }).fill('0')
  await modal.getByLabel('Reason for change', { exact: true }).fill('Use exact coverage before sheet-layout allowance')
  await modal.getByRole('button', { name: 'Recalculate and save new version', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
  await calculated.getByText(/7 m² to buy/).waitFor()
  await calculated.getByRole('button', { name: 'Send to Shopping', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Send to Shopping', exact: true })
  await modal.getByRole('button', { name: 'Send to Shopping', exact: true }).click(); await modal.waitFor({ state: 'hidden' })
'''
insert_before(
    'scripts/material-planning-browser.mjs',
    "  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Material plan / Shopping must fit the viewport')\n",
    browser_proof,
)
replace(
    'scripts/material-planning-browser.mjs',
    '  assert.equal(fixture.materials.size, 1)\n',
    '  assert.equal(fixture.materials.size, 2)\n',
)
replace(
    'scripts/material-planning-browser.mjs',
    '  console.log(`Material plan stock/reuse/arithmetic/Shopping handoff/reload/project isolation passed at ${width}px; HTTP fixtures, no AI.`)\n',
    '  console.log(`Material plan manual + deterministic drawing quantity, stock/reuse/arithmetic/Shopping handoff/reload/project isolation passed at ${width}px; HTTP fixtures, no AI.`)\n',
)

# The live drawing proof returns the already-verified generated Artifact so material planning can consume it.
replace(
    'scripts/check-live-artifacts.mjs',
    '  await verifyDeterministicArtifactGeometry(client, anonymous, projectId, areaId)\n\n  console.log(',
    '  const geometry = await verifyDeterministicArtifactGeometry(client, anonymous, projectId, areaId)\n\n  console.log(',
)
replace(
    'scripts/check-live-artifacts.mjs',
    '  return { artifactId }\n',
    '  return { artifactId, geometryArtifactId: geometry.artifactId }\n',
)

# Hosted material proof: real Auth/PostgREST consumes the persisted 4B1 drawing, then proves staleness and explicit Shopping update.
live_block = r'''

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
'''
insert_before(
    'scripts/check-live-material-planning.mjs',
    "  console.log('Live material plan:",
    live_block,
)
replace(
    'scripts/check-live-material-planning.mjs',
    "  console.log('Live material plan: exact target/drawing/stock/reuse lineage, transparent arithmetic, Shopping handoff/preservation, edit disclosure, stale-source guard, raw-write denial and project authority passed. No AI invoked.')",
    "  console.log('Live material plan: manual + deterministic drawing-derived quantities, exact target/drawing/stock/reuse lineage, transparent arithmetic, Shopping handoff/preservation, stale-source guard, raw-write denial and project authority passed. No AI invoked.')",
)

# PGlite regression uses the already-created 4B1 wall fixture.
replace(
    'tests/artifact-generation.test.ts',
    "async function artifact(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {\n  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any\n}\n",
    "async function artifact(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {\n  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any\n}\nasync function stock(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {\n  return (await as(uid, 'select bob.stock_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any\n}\nasync function calculatedRequirement(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {\n  return (await as(uid, 'select bob.material_requirement_geometry_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any\n}\nasync function materialRequirement(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {\n  return (await as(uid, 'select bob.material_requirement_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any\n}\n",
)
append = r'''

test('4B2b derives net wall area into the existing material requirement and Shopping path', async () => {
  const stockId=u(60), requirementId=u(61)
  await stock('A',one,'create',stockId,0,{name:'Saved wall board',specification:'Area stock',quantity:'2',unit:'m2',status:'available',area_id:'areaA',notes:''})
  const data=(artifactRevision:number,waste='10',extra:Record<string,unknown>={})=>({
    name:'Wall board coverage',category:'Sheet material',area_id:'areaA',task_id:null,waste_percent:waste,purchase_increment:'1',
    assumptions:'Coverage only; sheet layout, fastening and structure are outside this calculation.',
    artifact_id:u(30),artifact_revision:artifactRevision,target_revision:1,
    stock_allocations:[{id:stockId,revision:1,quantity:'2'}],...extra,
  })
  await calculatedRequirement('A',one,'create',requirementId,0,data(4))
  let row=(await as(one,'select * from bob.current_material_requirements where id=$1',[requirementId])).rows[0] as any
  assert.equal(Number(row.required_quantity),8.628)
  assert.equal(Number(row.required_with_waste),9.4908)
  assert.equal(Number(row.stock_quantity),2)
  assert.equal(Number(row.purchase_quantity),8)
  assert.equal(row.unit,'m2')
  assert.equal(row.source_kind,'deterministic')
  assert.equal(row.method_key,'stud_wall_net_area')
  assert.equal(row.method_version,'4B2b-v1')
  assert.equal(row.artifact_revision,4)
  assert.match(row.basis,/4200 mm.*2400 mm.*1210 mm.*1200 mm/)
  await assert.rejects(calculatedRequirement('A',one,'create',u(62),0,data(4,'0',{required_quantity:'999'})),/Unsupported deterministic material fields/)
  await assert.rejects(calculatedRequirement('A',outsider,'create',u(62),0,data(4)),/project_denied/)

  const published=await materialRequirement('A',one,'publish',requirementId,1)
  let shopping=(await as(one,'select * from bob.materials where id=$1',[published.material_id])).rows[0] as any
  assert.equal(shopping.qty,'8 m²')
  await as(one,"update bob.materials set status='delivered',supplier='Fixture sheets',cost='42 kr' where id=$1",[published.material_id])

  await artifact('A',one,'archive',u(30),4)
  await artifact('A',one,'restore',u(30),5)
  row=(await as(one,'select * from bob.current_material_requirements where id=$1',[requirementId])).rows[0] as any
  assert.equal(row.artifact_changed,true)
  await assert.rejects(materialRequirement('A',one,'publish',requirementId,1),/Drawing changed/)

  await calculatedRequirement('A',one,'revise',requirementId,1,data(6,'0',{change_note:'Recalculate from current drawing'}))
  row=(await as(one,'select * from bob.current_material_requirements where id=$1',[requirementId])).rows[0] as any
  assert.equal(row.revision,2)
  assert.equal(row.artifact_revision,6)
  assert.equal(Number(row.required_quantity),8.628)
  assert.equal(Number(row.purchase_quantity),7)
  assert.equal(row.source_kind,'deterministic')
  const old=(await as(one,'select source_kind,method_key,artifact_revision,required_quantity from bob.material_requirement_revisions where requirement_id=$1 and revision=1',[requirementId])).rows[0] as any
  assert.equal(old.source_kind,'deterministic'); assert.equal(old.method_key,'stud_wall_net_area'); assert.equal(old.artifact_revision,4); assert.equal(Number(old.required_quantity),8.628)
  await materialRequirement('A',one,'publish',requirementId,2)
  shopping=(await as(one,'select * from bob.materials where id=$1',[published.material_id])).rows[0] as any
  assert.equal(shopping.qty,'7 m²'); assert.equal(shopping.status,'delivered'); assert.equal(shopping.supplier,'Fixture sheets'); assert.equal(shopping.cost,'42 kr')
})

test('4B2b keeps explicit estimated geometry visibly concept-level in its persisted basis', async () => {
  const requirementId=u(63)
  await calculatedRequirement('A',one,'create',requirementId,0,{
    name:'Estimated wall coverage',category:'Sheet material',area_id:'areaA',task_id:null,waste_percent:'0',purchase_increment:'1',
    assumptions:'Estimate remains an estimate.',artifact_id:u(32),artifact_revision:1,target_revision:1,stock_allocations:[],
  })
  const row=(await as(one,'select * from bob.current_material_requirements where id=$1',[requirementId])).rows[0] as any
  assert.equal(row.source_kind,'deterministic')
  assert.match(row.basis,/Drawing status: concept/)
  assert.match(row.basis,/contains explicit estimate/)
})
'''
p=Path('tests/artifact-generation.test.ts')
text=p.read_text()
if "4B2b derives net wall area" not in text:
    p.write_text(text+append)

print('4B2b patch applied')
