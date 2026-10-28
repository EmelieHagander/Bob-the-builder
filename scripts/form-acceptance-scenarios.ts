// Frozen FORM package 5 comparison scenarios (Docs/bob-delivery-flow.md#form-next).
// The same messages run once on the baseline catalog and once on the candidate
// catalog. Hard checks cover facts code can decide; everything a reviewer must
// judge is recorded as an observation, never silently passed or failed.
import { checkConstruction } from '../supabase/functions/_shared/construction-checks.ts'

type Row = Record<string, any>
export type FormReader = {
 constructions(): Promise<Row[]>
 construction(id: string, revision?: number): Promise<Row>
 catalogRecord(id: string, revision: number): Promise<Row>
 drawings(artifactId: string, revision: number): Promise<Row[]>
}
export type StepContext = { reader: FormReader; state: Row; check(name: string, ok: boolean, detail?: unknown): void; observe(name: string, value: unknown): void
 /** Offline tests only; live runs use the production checker. */ checker?: typeof checkConstruction }
export type FormScenario = { id: 'box' | 'bunk-bed'; title: string; steps: { label: string; message: string; after: (ctx: StepContext) => Promise<void> }[] }

const size = (r: Row) => r.bounds_mm?.size as number[] | undefined
async function current(ctx: StepContext) {
 const listed = await ctx.reader.constructions()
 ctx.check('one_construction', listed.length === 1, { count: listed.length })
 if (listed.length !== 1) return null
 const draft = await ctx.reader.construction(listed[0].id)
 const catalog = new Map<string, Row>()
 for (const binding of draft.materials ?? []) for (const kind of ['material', 'part']) {
  const id = binding[kind + '_id'], revision = binding[kind + '_revision']
  if (id && !catalog.has(id + '@' + revision)) catalog.set(id + '@' + revision, await ctx.reader.catalogRecord(id, revision))
 }
 const checked = (ctx.checker ?? checkConstruction)(draft, catalog, new Date().toISOString().slice(0, 10))
 ctx.check('construction_concept_ready', checked.concept_ready === true, checked.concept_ready ? undefined : checked.issues.slice(0, 5))
 ctx.observe('construction', { artifact_id: draft.artifact_id, revision: draft.revision, parts: checked.part_count, joints: checked.joint_count, size_mm: size(checked) })
 return { draft, checked }
}
function sameArtifact(ctx: StepContext, now: { draft: Row }) {
 ctx.check('same_construction_artifact', now.draft.artifact_id === ctx.state.artifact_id, { before: ctx.state.artifact_id, after: now.draft.artifact_id })
 ctx.check('new_construction_revision', now.draft.revision > ctx.state.revision, { before: ctx.state.revision, after: now.draft.revision })
}
async function savedDrawing(ctx: StepContext) {
 const now = await current(ctx)
 if (!now) return
 const drawings = await ctx.reader.drawings(now.draft.artifact_id, now.draft.revision)
 ctx.check('drawing_saved_for_latest_revision', drawings.length > 0, { construction_revision: now.draft.revision, drawings: drawings.length })
 ctx.observe('drawings', drawings.map(d => ({ id: d.id, revision: d.revision, source: d.source ?? null })))
}
const ladderOffset = (draft: Row, checked: Row) => {
 const ladder = (draft.recipe?.instances ?? []).filter((i: Row) => /ladder|stege|steg/i.test(i.id))
 const span = size(checked), min = checked.bounds_mm?.min as number[] | undefined
 if (!ladder.length || !span || !min) return null
 const x = ladder.reduce((sum: number, i: Row) => sum + (i.placement?.x ?? 0), 0) / ladder.length
 return x - (min[0] + span[0] / 2)
}

export const FORM_SCENARIOS: FormScenario[] = [
 { id: 'box', title: 'Låda — bredd ändras, sedan slutritning', steps: [
  { label: 'concept', message: 'Jag vill ha en enkel förvaringslåda i 12 mm plywood: 400 mm bred, 300 mm djup och 250 mm hög som yttermått, öppen upptill, med fem paneler (botten, två gavlar, framsida och baksida). Ta fram lösningen och spara en kontrollerad konstruktion.',
   after: async ctx => { const now = await current(ctx); if (!now) return
    ctx.check('five_parts', now.checked.part_count === 5, { parts: now.checked.part_count })
    ctx.check('initial_size', JSON.stringify(size(now.checked)) === JSON.stringify([400, 300, 250]), size(now.checked))
    Object.assign(ctx.state, { artifact_id: now.draft.artifact_id, revision: now.draft.revision }) } },
  { label: 'width_change', message: 'Ändra samma låda till 500 mm ytterbredd. Behåll djup, höjd, material och byggsätt, räkna om beroende mått och kontrollera igen.',
   after: async ctx => { const now = await current(ctx); if (!now) return
    sameArtifact(ctx, now)
    ctx.check('changed_size', JSON.stringify(size(now.checked)) === JSON.stringify([500, 300, 250]), size(now.checked))
    Object.assign(ctx.state, { revision: now.draft.revision }) } },
  { label: 'final_drawing', message: 'Gör nu den slutliga ritningen av den rättade lådan med vyer framifrån, från sidan och ovanifrån, och spara den kopplad till konstruktionen.', after: savedDrawing },
 ] },
 { id: 'bunk-bed', title: 'Våningssäng — stegen flyttas, sedan ritning', steps: [
  { label: 'concept', message: 'Våningssäng för två barn: två madrasser 90 × 200 cm, total höjd högst 1600 mm, stege på vänster gavel sett framifrån och två lådor under den nedre sängen. Ta fram lösningen och spara en kontrollerad konstruktion av stommen med stegen; lådorna får stå kvar som återstående arbete.',
   after: async ctx => { const now = await current(ctx); if (!now) return
    const offset = ladderOffset(now.draft, now.checked)
    ctx.check('ladder_modelled', offset !== null)
    ctx.observe('ladder_offset_mm', offset)
    ctx.check('height_limit', (size(now.checked)?.[2] ?? Infinity) <= 1600, size(now.checked))
    Object.assign(ctx.state, { artifact_id: now.draft.artifact_id, revision: now.draft.revision, ladder_offset: offset,
     others: (now.draft.recipe?.instances ?? []).filter((i: Row) => !/ladder|stege|steg/i.test(i.id)).map((i: Row) => ({ id: i.id, placement: i.placement })) }) } },
  { label: 'move_ladder', message: 'Flytta stegen till höger gavel. Lådorna och allt annat ska vara oförändrat. Kontrollera igen.',
   after: async ctx => { const now = await current(ctx); if (!now) return
    sameArtifact(ctx, now)
    const offset = ladderOffset(now.draft, now.checked)
    ctx.check('ladder_moved_to_opposite_gable', offset !== null && ctx.state.ladder_offset !== null && Math.sign(offset) === -Math.sign(ctx.state.ladder_offset) && offset !== 0,
     { before: ctx.state.ladder_offset, after: offset })
    const others = (now.draft.recipe?.instances ?? []).filter((i: Row) => !/ladder|stege|steg/i.test(i.id))
    const changed = (ctx.state.others as Row[]).filter(o => JSON.stringify(others.find((i: Row) => i.id === o.id)?.placement ?? null) !== JSON.stringify(o.placement)).map(o => o.id)
    ctx.observe('non_ladder_parts_changed', changed)
    Object.assign(ctx.state, { revision: now.draft.revision }) } },
  { label: 'drawing', message: 'Gör ritningen av stommen med vyer framifrån och från sidan och spara den kopplad till konstruktionen.', after: savedDrawing },
 ] },
]
