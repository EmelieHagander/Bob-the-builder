import type { ConceptModel } from '../../supabase/functions/_shared/solution-concept.ts'
import type { DesignIntent } from '../../supabase/functions/_shared/project-design-intent.ts'
import { designIntent } from './design-intent-fixture.ts'

/** Object names exist only in acceptance fixtures, never in runtime routing. */
export function conceptFixture(kind: 'box' | 'bed' | 'barn'): DesignIntent & { model: ConceptModel } {
  const intent = designIntent('concept')
  const model: ConceptModel = { version: 1, frame: { origin: 'Front left ground corner', x: 'Length', y: 'Width, front to back', z: 'Height above ground' }, nodes: [], components: [],
    views: [{ id: 'plan', label: 'Plan', plane: 'XY', kind: 'projection', at: null }, { id: 'profile', label: 'Longitudinal profile', plane: 'XZ', kind: 'projection', at: null }], constraints: [], unsupported: [] }
  const node = (id: string, value: number, unit: 'mm' | 'scalar' = 'mm') => { model.nodes.push({ id, role: 'decision', value, unit, reason: 'Synthetic design choice, not a measurement' }); return id }
  const derived = (id: string, operation: 'add_v1' | 'subtract_v1' | 'multiply_v1', a: string, b: string) => { model.nodes.push({ id, role: 'derived', operation, operands: [a, b], rounding: 'exact' }); return id }
  const part = (id: string, label: string, position: [string, string, string], size: [string, string, string], kind: 'solid' | 'space' | 'opening' = 'solid') => model.components.push({ id, label, kind, active: true, position, size, features: ['fixture_form'], choices: ['fixture_design'] })
  node('zero', 0)
  if (kind === 'box') {
    node('length', 600); node('width', 400); node('height', 300); node('wall', 18)
    derived('back_y', 'subtract_v1', 'width', 'wall')
    part('bottom', 'Bottom', ['zero', 'zero', 'zero'], ['length', 'width', 'wall'])
    part('front', 'Front wall', ['zero', 'zero', 'wall'], ['length', 'wall', 'height'])
    part('back', 'Back wall', ['zero', 'back_y', 'wall'], ['length', 'wall', 'height'])
  } else if (kind === 'bed') {
    node('length', 2000); node('width', 900); node('thickness', 40); node('lower', 400); node('upper', 1400)
    node('ladder_x', 50); node('ladder_y', 0); node('ladder_width', 300); node('ladder_height', 1500)
    node('drawer_width', 700); node('drawer_height', 250); node('drawer_x', 1000); node('opening_height', 900)
    part('lower_deck', 'Lower sleeping platform', ['zero', 'zero', 'lower'], ['length', 'width', 'thickness'])
    part('upper_deck', 'Upper sleeping platform', ['zero', 'zero', 'upper'], ['length', 'width', 'thickness'])
    part('ladder', 'Wall mounted ladder envelope', ['ladder_x', 'ladder_y', 'zero'], ['ladder_width', 'thickness', 'ladder_height'])
    part('drawer', 'Drawer envelope', ['drawer_x', 'zero', 'zero'], ['drawer_width', 'width', 'drawer_height'])
    part('access', 'Access opening', ['ladder_x', 'zero', 'lower'], ['ladder_width', 'thickness', 'opening_height'], 'opening')
    for (const [id, description, component] of [
      ['drawer_storage', 'Preserve the drawers shown in the reference concept.', 'drawer'],
      ['wall_access', 'Preserve the vertical ladder on the front wall.', 'ladder'],
      ['clear_access', 'Preserve the access opening beside the sleeping platform.', 'access'],
    ]) {
      intent.features.push({ id, description, basis: 'user_request', source_ref: 'Synthetic reference requirement' })
      model.components.find(c => c.id === component)!.features.push(id)
    }
    model.constraints.push({ id: 'ladder_side', label: 'Ladder stays on the front side', relation: 'equal', left: 'ladder_y', right: 'zero', feature: 'fixture_form' })
  } else {
    node('room_length', 2000); node('width', 3000); node('height', 2000); node('wall', 100)
    node('loft_height', 1500); node('floor', 150); node('foundation', 150); node('roof_allowance', 200); node('total_height', 3500)
    node('section_y', 1500); node('ladder_width', 400); node('ladder_x', 1500); node('window_z', 800); node('window_height', 600)
    derived('third_x', 'add_v1', 'room_length', 'room_length')
    derived('loft_z', 'add_v1', 'height', 'floor')
    derived('head_z', 'add_v1', 'loft_z', 'loft_height')
    derived('roof_z', 'add_v1', 'head_z', 'roof_allowance')
    derived('required_height', 'add_v1', 'roof_z', 'foundation')
    derived('second_ladder_x', 'add_v1', 'third_x', 'ladder_x')
    for (const [id, x] of [['first', 'zero'], ['middle', 'room_length'], ['last', 'third_x']]) part(id, `${id} room`, [x, 'zero', 'zero'], ['room_length', 'width', 'height'], 'space')
    for (const [id, x] of [['first', 'zero'], ['last', 'third_x']]) {
      part(`${id}_ceiling`, `${id} closed flat ceiling`, [x, 'zero', 'height'], ['room_length', 'width', 'floor'])
      part(`${id}_loft`, `${id} separate loft`, [x, 'zero', 'loft_z'], ['room_length', 'width', 'loft_height'], 'space')
      part(`${id}_window`, `${id} front window`, [x, 'zero', 'window_z'], ['ladder_width', 'wall', 'window_height'], 'opening')
    }
    part('first_ladder', 'First vertical wall ladder envelope', ['ladder_x', 'zero', 'zero'], ['ladder_width', 'wall', 'height'])
    part('last_ladder', 'Last vertical wall ladder envelope', ['second_ladder_x', 'zero', 'zero'], ['ladder_width', 'wall', 'height'])
    model.views[1] = { id: 'profile', label: 'Longitudinal section', plane: 'XZ', kind: 'section', at: 'section_y' }
    model.views.push({ id: 'wall_section', label: 'Front wall section', plane: 'XZ', kind: 'section', at: 'zero' })
    model.constraints.push({ id: 'height_stack', label: 'Rooms, floor, loft, roof and foundation must fit total height', relation: 'at_most', left: 'required_height', right: 'total_height', feature: 'fixture_form' })
    model.constraints.push({ id: 'length_view', label: 'Length section follows the rooms along X', relation: 'view_plane', view: 'profile', plane: 'XZ', feature: 'fixture_form' })
    model.unsupported.push('Pitched roof geometry needs a supported construction mapping; the roof allowance is only a dimensional budget.')
  }
  return { ...intent, summary: `Synthetic ${kind} early geometry`, model }
}
