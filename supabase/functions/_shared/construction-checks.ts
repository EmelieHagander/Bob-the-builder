import { intrinsicAxes } from './cad-frames.ts'
import { parseCadAssemblyRequest } from './cad-adapter.ts'
import seed from './building-knowledge-seed.json' with { type: 'json' }

/** Conservative analytic checks, not the CAD kernel or a structural/product approval.
 * Only uncut boxes at right-angle rotations are admitted. Unsupported geometry
 * never receives a bounding-box approximation masquerading as an exact result. */
export const CONSTRUCTION_CHECK_VERSION = 'orthogonal-butt-v1'
type RecordData = Record<string, any>
type Issue = { code: string; ids: string[]; message: string }
type Box = { id: string; min: number[]; max: number[]; faces: Map<string, { axis: number; sign: number; plane: number }> }
const axes = ['x', 'y', 'z'] as const
const tolerance = 0.000001 // canonical parameter precision, mm; not a manufacturing tolerance
const same = (a: number, b: number) => Math.abs(a - b) <= tolerance
const key = (a: string, b: string) => JSON.stringify([a, b].sort())
const dimension = (r: RecordData, name: string) => {
 const p = r.properties?.[name]
 return p && p.unit === 'mm' && p.parameter === null && p.truth === 'provided_spec' && typeof p.value === 'string' && Number(p.value) > 0 && Number.isFinite(Number(p.value)) ? Number(p.value) : null
}
export function constructionKnowledge(today: string) {
 return seed.cards.filter(c => ['timber.fasteners', 'timber.adhesives'].includes(c.id) && c.status === 'active' && c.audience === 'public'
  && c.rights === 'original_summary_links_only' && c.reviewed_at <= today && c.review_due >= today)
}
export function checkConstruction(draft: RecordData, catalog: Map<string, RecordData>, today: string) {
 const issues: Issue[] = [], gaps: Issue[] = [], boxes: Box[] = []
 const add = (code: string, ids: string[], message: string) => { issues.push({ code, ids, message }) }
 const gap = (code: string, ids: string[], message: string) => { gaps.push({ code, ids, message }) }
 const knowledge = constructionKnowledge(today)
 const recipe = parseCadAssemblyRequest(draft.recipe)
 if (draft.source_state !== 'current' || draft.archived || draft.revision !== draft.current_revision)
  add('checkpoint_not_current', [], 'Read the current unarchived draft and refresh changed source revisions before checking.')
 if (!recipe || !Array.isArray(draft.materials) || !Array.isArray(draft.joints)) {
  add('invalid_checkpoint', [], 'A canonical construction checkpoint is required.')
  return result()
 }
 if (recipe.clearances?.length || recipe.motions?.length) add('unsupported_checks', [], 'Motion and clearance checks need the CAD kernel; this checker cannot approve them.')
 const definitions = new Map(recipe.definitions.map(d => [d.id, d]))
 for (const d of recipe.definitions) {
  if (d.primitive !== 'box' || d.cuts?.length) { add('unsupported_geometry', [d.id], 'Only uncut boxes are supported by this check version.'); continue }
  const binding = draft.materials.find((m: RecordData) => m.definition_id === d.id)
  const material = binding && catalog.get(`${binding.material_id}@${binding.material_revision}`)
  if (!material || material.kind !== 'material' || material.current_revision !== binding.material_revision) {
   add('material_unavailable_or_changed', [d.id], 'Read the exact current material revision.'); continue
  }
  if (!['sheet_stock', 'rectangular_profile'].includes(material.profile_code)) {
   add('unsupported_material_profile', [d.id, material.id], 'This box checker requires sheet_stock or rectangular_profile material.'); continue
  }
  const dims = [d.x_mm, d.y_mm, d.z_mm]
  const thickness = dimension(material, 'thickness')
  if (thickness === null) add('material_dimension_unknown', [d.id, material.id], 'Material thickness needs an explicit dimension; an estimate is not a specification.')
  else if (!dims.some(v => same(v, thickness))) add('material_thickness_mismatch', [d.id, material.id], 'No local part dimension matches the pinned material thickness.')
  if (material.profile_code === 'rectangular_profile') {
   const width = dimension(material, 'width')
   if (width === null || thickness === null || !dims.some((v, i) => same(v, thickness) && dims.some((w, j) => i !== j && same(w, width))))
    add('material_cross_section_mismatch', [d.id, material.id], 'Two distinct local axes must match the specified profile cross-section.')
  }
  if (binding.part_id) {
   const part = catalog.get(`${binding.part_id}@${binding.part_revision}`)
   if (!part || part.kind !== 'part' || part.current_revision !== binding.part_revision || part.material_id !== material.id || part.material_revision !== material.revision)
    add('part_unavailable_or_changed', [d.id, binding.part_id], 'The exact part must refer to this material revision.')
   else if (part.profile_code !== 'panel') add('unsupported_part_profile', [d.id, part.id], 'Only dimensioned panel part definitions are currently checked.')
   else {
    const specified = ['thickness', 'width', 'length'].map(k => dimension(part, k))
    if (specified.some(v => v === null)) add('part_dimension_unknown', [d.id, part.id], 'Resolve catalog part parameters into an exact dimensioned revision before checking.')
    else if (!(specified as number[]).sort((a,b)=>a-b).every((v,i)=>same(v, [...dims].sort((a,b)=>a-b)[i])))
     add('part_dimensions_mismatch', [d.id, part.id], 'Geometry does not match the three pinned panel dimensions.')
   }
  }
  gap('product_specification_unverified', [d.id, material.id], 'Catalog dimensions are declared inputs, not verified manufacturer instructions, stock availability or product suitability.')
 }
 for (const instance of recipe.instances) {
  const d = definitions.get(instance.definition_id)!, p = instance.placement
  if (d.primitive !== 'box' || d.cuts?.length) continue
  if (![p.rx, p.ry, p.rz].every(v => v % 90 === 0)) {
   add('unsupported_rotation', [instance.id], 'Only multiples of 90 degrees are checked; no approximate collision approval.'); continue
  }
  // Reuse exactly the CAD frame convention; columns are the local basis vectors.
  const basis = intrinsicAxes([p.rx, p.ry, p.rz]).map(v => v.map(Math.round))
  const origin = [p.x, p.y, p.z], dims = [d.x_mm, d.y_mm, d.z_mm]
  const min = [...origin], max = [...origin], faces: Box['faces'] = new Map()
  for (let local = 0; local < 3; local++) {
   const world = basis[local].findIndex(v => Math.abs(v) === 1), sign = basis[local][world]
   min[world] += Math.min(0, sign * dims[local]); max[world] += Math.max(0, sign * dims[local])
   faces.set(`${axes[local]}_min`, { axis: world, sign: -sign, plane: origin[world] })
   faces.set(`${axes[local]}_max`, { axis: world, sign, plane: origin[world] + sign * dims[local] })
  }
  boxes.push({ id: instance.id, min, max, faces })
 }
 const byId = new Map(boxes.map(b => [b.id, b])), contacts = new Set<string>(), connected = new Map(boxes.map(b => [b.id, new Set<string>()]))
 for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j], overlap = axes.map((_, k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]))
  if (overlap.every(v => v > tolerance)) add('part_collision', [a.id, b.id], 'Parts overlap in volume; correct dimensions or placement.')
  else if (overlap.filter(v => Math.abs(v) <= tolerance).length === 1 && overlap.filter(v => v > tolerance).length === 2) contacts.add(key(a.id, b.id))
 }
 const joined = new Set<string>(), jointChecks: RecordData[] = []
 for (const joint of draft.joints) {
  const a = byId.get(joint.first.instance_id), b = byId.get(joint.second.instance_id)
  const fa = a?.faces.get(joint.first.face), fb = b?.faces.get(joint.second.face)
  const ids = [joint.id, joint.first.instance_id, joint.second.instance_id]
  const sourceId = joint.method === 'glued_butt' ? 'timber.adhesives' : 'timber.fasteners'
  const source = knowledge.find(c => c.id === sourceId)
  if (!['screwed_butt', 'glued_butt'].includes(joint.method)) add('unsupported_joint_method', ids, 'Choose a supported butt-joint concept or retain this as an unresolved construction.')
  if (!source) add('joint_knowledge_unavailable', ids, 'The method reference is absent, withdrawn or due for review.')
  const wooden = [a,b].every(box => {
   const inst = recipe.instances.find(i => i.id === box?.id)
   const binding = draft.materials.find((m:RecordData)=>m.definition_id===inst?.definition_id)
   const material = binding && catalog.get(`${binding.material_id}@${binding.material_revision}`)
   return material?.categories?.some((c:string)=>c==='wood'||c.startsWith('wood.'))
  })
  if (!wooden) add('joint_material_not_supported', ids, 'The available method references apply to wood; another material needs its own applicable evidence.')
  const fits = !!a && !!b && !!fa && !!fb && a.id !== b.id && fa.axis === fb.axis && fa.sign === -fb.sign && same(fa.plane, fb.plane)
   && axes.every((_, k) => k === fa.axis || Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > tolerance)
  if (!fits) add('joint_faces_do_not_meet', ids, 'Local faces must oppose on the same plane with positive contact area; correct direction, span or position.')
  else {
   joined.add(key(a.id,b.id)); connected.get(a.id)!.add(b.id); connected.get(b.id)!.add(a.id)
  }
  jointChecks.push({ id:joint.id, fit:fits, method:joint.method, reference:source?{id:source.id,version:source.version,content_sha256:source.content_sha256}:null })
  gap('joint_product_and_capacity_unverified', ids, joint.method === 'glued_butt'
   ? 'Select compatible adhesive and verify surface preparation, grain, clamping, cure, environment and load. Face contact proves no adhesive strength.'
   : 'Select documented fasteners and verify quantity, diameter, length, penetration, spacing, edge/end distances, access, environment and load.')
 }
 for (const pair of contacts) if (!joined.has(pair)) add('contact_without_joint', JSON.parse(pair), 'Touching parts have no valid declared joint; specify the connection rather than inferring fastening from contact.')
 if (boxes.length > 1) {
  const seen = new Set<string>(), pending = [boxes[0].id]
  while (pending.length) { const id = pending.pop()!; if(seen.has(id))continue;seen.add(id);pending.push(...connected.get(id)!) }
  if (seen.size !== boxes.length) add('disconnected_parts', boxes.filter(b=>!seen.has(b.id)).map(b=>b.id), 'All parts of this supported fixed assembly need a path of valid joints. Physical joint cycles are allowed.')
 }
 for (const question of draft.open_questions ?? []) gap('open_design_question', [], question)
 return result({ part_count:recipe.instances.length, joint_count:draft.joints.length, joint_checks:jointChecks,
  bounds_mm:boxes.length?{min:axes.map((_,k)=>Math.min(...boxes.map(b=>b.min[k]))),max:axes.map((_,k)=>Math.max(...boxes.map(b=>b.max[k]))),size:axes.map((_,k)=>Math.max(...boxes.map(b=>b.max[k]))-Math.min(...boxes.map(b=>b.min[k])))}:null })
 function result(extra:RecordData={}) {
  return { status:'checked', checker_version:CONSTRUCTION_CHECK_VERSION, artifact_id:draft.artifact_id, revision:draft.revision,
   concept_ready:issues.length===0, fabrication_ready:false, rendered:false, reviewed:false,
   issues:issues.slice(0,200), issue_count:issues.length, fabrication_gaps:gaps.slice(0,200), fabrication_gap_count:gaps.length,
   references:knowledge.map(c=>({id:c.id,title:c.title,url:c.url,version:c.version,reviewed_at:c.reviewed_at,limitations:c.limitations})),
   limits:['Declared requirements still need comparison with the reported bounds and part count.','No strength, stability, tip resistance, raw-stock nesting, fastener layout or manufacturer-product approval.','A check result is revision-bound evidence, not a saved drawing or permission to manufacture.'], ...extra }
 }
}
