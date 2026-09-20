import { storageBoxGeometry } from '../../../src/lib/storageBox.ts'

const text = { type: 'string' }
const nullableText = { type: ['string', 'null'] }
export const DRAWING_PROPERTIES = {
  record_id: { ...nullableText, description: 'Existing storage-box artifact UUID to revise, or null to create. Read the current artifact first.' },
  create_area_id: { ...nullableText, description: 'Exact Area ID on create or null for Project; always null on revision. Never move an existing drawing.' },
  expected_revision: { type: 'integer', description: '0 for create; exact current artifact revision for edit.' },
  target_revision: { type: 'integer', description: 'Exact current selected target decision for this Project/Area. An inherited Area target uses its Project decision. Read target first; do not invent/select one.' },
  title: text, description: text,
  assumptions: { ...text, description: 'Material, actual sources and unresolved fixing/site-fit decisions. Chosen dimensions are design specifications, never measured building facts.' },
  width_mm: { type: 'number', description: 'Outside box width in mm; at most 10000, max three decimals.' },
  height_mm: { type: 'number', description: 'Overall height including the bottom panel, in mm.' },
  depth_mm: { type: 'number', description: 'Outside front-to-back depth in mm.' },
  thickness_mm: { type: 'number', description: 'Uniform sheet thickness in mm, at most 100. This is a design choice unless actual material thickness has been supplied.' },
  measurements: { type: 'array', maxItems: 20, description: 'Exact relevant canonical measurement revisions. Preserve existing links on edit unless the user requests a change. Never substitute invented values or UUIDs.',
    items: { type: 'object', additionalProperties: false, required: ['id', 'revision'], properties: { id: text, revision: { type: 'integer' } } } },
  change_note: { ...text, description: 'Reason for this design/change. Required also on create, retained in the request audit.' },
  request_quote: { ...text, description: 'Exact 1–500 character quote from the CURRENT user message requesting this action or approving the earlier specified option.' },
}
export const DRAWING_DESCRIPTION = 'Create or revise an exact, editable 2D storage-box drawing inside Bob. Only an open-top rectangular sheet box is supported: full bottom under the walls, front/back between sides. Width/height/depth/thickness drive front, plan, section and finished part dimensions together. No runners, lid, stock-cutting optimisation, fasteners or structural approval. Read the selected target and existing drawings before saving. Make reasonable reversible design choices and identify them as proposals; ask only for missing essential constraints. Do not claim a measured site fit. Every change saves a Concept revision; success requires the returned receipt.'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const string = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
export function parseDrawingWrite(v: Record<string, unknown>) {
  if (v.record_id !== null && (typeof v.record_id !== 'string' || !uuid.test(v.record_id))) return null
  if (v.create_area_id !== null && !string(v.create_area_id, 200)) return null
  if (v.record_id !== null && v.create_area_id !== null) return null
  if (!Number.isSafeInteger(v.expected_revision) || (v.record_id === null ? v.expected_revision !== 0 : Number(v.expected_revision) < 1)
    || !Number.isSafeInteger(v.target_revision) || Number(v.target_revision) < 1
    || !string(v.title, 200) || !string(v.description, 6000) || !string(v.assumptions, 3500) || !string(v.change_note, 1000)) return null
  if (!Array.isArray(v.measurements) || v.measurements.length > 20) return null
  const seen = new Set<string>()
  for (const item of v.measurements) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2
      || typeof item.id !== 'string' || !uuid.test(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 1 || seen.has(item.id.toLowerCase())) return null
    seen.add(item.id.toLowerCase())
  }
  try {
    const recipe = storageBoxGeometry({ generator: 'storage_box_v1', version: 1,
      width_mm: v.width_mm, height_mm: v.height_mm, depth_mm: v.depth_mm, thickness_mm: v.thickness_mm }).recipe
    return { kind: 'drawing' as const, record_id: v.record_id as string | null, expected_updated_at: null,
      expected_revision: v.expected_revision as number, request_quote: v.request_quote as string,
      data: { title: v.title, description: v.description, assumptions: v.assumptions, target_revision: v.target_revision,
        recipe, measurements: v.measurements.map(m => ({ id: m.id, revision: m.revision })),
        ...(v.record_id === null ? { area_id: v.create_area_id } : { change_note: v.change_note }),
      } }
  } catch { return null }
}
