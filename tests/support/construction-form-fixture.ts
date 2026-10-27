import { designIntent } from './design-intent-fixture.ts'
import type { DesignIntent } from '../../supabase/functions/_shared/project-design-intent.ts'
import type { ConceptModel } from '../../supabase/functions/_shared/solution-concept.ts'

export function constructionFormFixture() {
  const intent = designIntent('construction') as DesignIntent & { model: ConceptModel }
  intent.features = ['frame', 'drawer'].map(id => ({ id, description: `Synthetic ${id} requirement`, basis: 'user_request', source_ref: null }))
  intent.choices = [{ ...intent.choices[0], id: 'frame_design' }, { ...intent.choices[0], id: 'drawer_finish', question: 'Choose the later drawer finish', geometry_dependency: false, status: 'open', selected_direction: null }]
  const component = (id: string, size: number[], at: number[]) => ({ id, label: id, kind: 'solid' as const, active: true, features: [id], choices: [id === 'frame' ? 'frame_design' : 'drawer_finish'],
    position: at.map((_, k) => `${id}_p${k}`) as [string,string,string], size: size.map((_, k) => `${id}_s${k}`) as [string,string,string] })
  const frame = component('frame', [600,400,18], [0,0,0]), drawer = component('drawer', [100,100,18], [800,0,0])
  intent.model = { version: 1, frame: { origin: 'Synthetic front left', x: 'Length', y: 'Width', z: 'Height' },
    nodes: [frame, drawer].flatMap((c, n) => [...c.position, ...c.size].map((id, k) => ({ id, role: 'decision' as const, unit: 'mm' as const, reason: 'Synthetic only', value: [[0,0,0,600,400,18],[800,0,0,100,100,18]][n][k] }))),
    components: [frame, drawer], constraints: [], unsupported: [], views: [{id:'plan',label:'Plan',plane:'XY',kind:'projection',at:null},{id:'front',label:'Front',plane:'XZ',kind:'projection',at:null}] }
  const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'partial_frame', views: ['front','top'],
    definitions: [{id:'rail',primitive:'box',material_ref:null,x_mm:18,y_mm:400,z_mm:18}],
    instances: ['left','right'].map((id, n) => ({id,definition_id:'rail',placement:{x:n*582,y:0,z:0,rx:0,ry:0,rz:0}})) }
  const refinement = { version: 1 as const, mappings: [{component_id:'frame',instance_ids:['left','right']}] }
  return { intent, recipe, refinement }
}
