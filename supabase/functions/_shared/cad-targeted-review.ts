import type { CadReview, DesignHandoff } from './cad-review.ts'
import { fingerprint, stableJsonValue } from './bob-job-journal.ts'
import { constructionEvidenceReuse } from './construction-evidence.ts'
import type { ConstructionObservation } from './construction-views.ts'

/** Prepared replacement for the mandatory full CAD review (FORM package 3).
 * Code assembles exact requirements, deterministic findings and evidence; a
 * reviewer answers concrete questions; code computes the verdict. The path is
 * inactive until the pinned catalog enables CAD_TARGETED_REVIEW_ROLE. */
export const CAD_TARGETED_REVIEW_VERSION = 'cad-targeted-review-v1'
export const CAD_TARGETED_REVIEW_ROLE = 'role.cad-targeted-reviewer'
/** The role is published disabled; only an explicitly enabled pinned role
 * selects this path. A disabled or absent role keeps the full review. */
export function targetedReviewEnabled(manifest: { definitions: { prompt_key: string; definition: Record<string, any> }[] }) {
 return manifest.definitions.some(row => row.prompt_key === CAD_TARGETED_REVIEW_ROLE && row.definition?.enabled === true)
}

type Row = Record<string, any>
type Status = 'met' | 'unresolved' | 'failed'
export type FeatureCodeEvidence = { status: 'failed' | 'unsupported' | 'unknown' | 'not_checked' | 'properties_passed'; functional_fidelity: 'unverified'; checks: { id: string; kind: string; status: string; code: string }[] }
export type FormEvidenceCoverage =
 | { status: 'current'; result_id: string; observed_at: string; scope: { evaluated_component_ids: string[]; pending_component_ids: string[] } }
 | { status: 'none' | 'not_current' | 'unavailable'; reason: string | null }
export interface CadReviewPacket {
 version: typeof CAD_TARGETED_REVIEW_VERSION
 binding: { candidate: string; construction: { artifact_id: string; revision: number } | null; design_intent: unknown; requirements: string }
 requirements: { id: string; requirement: string; basis: string; source_ref: string | null; required: boolean; code_evidence: FeatureCodeEvidence | null }[]
 coverage: { views: { requested: string[]; rendered: string[]; missing: string[] }; references: string[]; form_evidence: FormEvidenceCoverage }
 open_items: string[]
 code_findings: CadReview['issues']
 questions: { requirements: string[]; views: string[]; reference: boolean }
}

/** The newest stored FORM check for the exact revision, used only when the
 * existing reuse rule still calls it current. Older or changed evidence is
 * reported as such; it never becomes a pass by omission. */
export function formEvidenceCoverage(observation: ConstructionObservation | null, draft: Row | null, today: string): { coverage: FormEvidenceCoverage; evidence: Row | null } {
 if (!observation || !draft) return { coverage: { status: 'none', reason: null }, evidence: null }
 const reuse = constructionEvidenceReuse(observation, draft, today)
 if (reuse !== 'current_for_analysis') return { coverage: { status: 'not_current', reason: reuse }, evidence: null }
 const evidence = observation.output.form_evidence
 return { coverage: { status: 'current', result_id: observation.id, observed_at: observation.observed_at,
  scope: { evaluated_component_ids: [...evidence.scope.evaluated_component_ids], pending_component_ids: [...evidence.scope.pending_component_ids] } }, evidence }
}

/** Every handoff requirement is in the packet; relevance can never drop one.
 * Intent features map to FORM property evidence by their `intent_` id. */
export async function buildCadReviewPacket(input: {
 handoff: DesignHandoff; requiredFeatureIds: ReadonlySet<string>; candidateFingerprint: string
 construction: { artifact_id: string; revision: number } | null; designIntentPin: unknown
 renderedViews: string[]; referenceRefs: string[]; formEvidence: { coverage: FormEvidenceCoverage; evidence: Row | null }
}): Promise<CadReviewPacket> {
 const { handoff, formEvidence } = input
 const features: Row[] = formEvidence.evidence?.requirements ?? [], checks: Row[] = formEvidence.evidence?.property_checks ?? []
 const requirements = handoff.requirements.map(r => {
  const feature = r.id.startsWith('intent_') ? features.find(f => 'intent_' + f.feature_id === r.id) : undefined
  const code_evidence: FeatureCodeEvidence | null = feature ? { status: feature.status, functional_fidelity: 'unverified',
   checks: checks.filter(c => feature.property_check_ids.includes(c.id)).map(c => ({ id: c.id, kind: c.kind, status: c.status, code: c.code })) } : null
  return { id: r.id, requirement: r.requirement, basis: r.basis, source_ref: r.source_ref, required: input.requiredFeatureIds.has(r.id), code_evidence }
 })
 const missing = handoff.views.filter(view => !input.renderedViews.includes(view))
 const code_findings: CadReview['issues'] = []
 if (missing.length) code_findings.push({ severity: 'error', code: 'views', correction: 'Render missing requested views: ' + missing.join(', ') })
 for (const r of requirements) if (r.code_evidence?.status === 'failed') code_findings.push({ severity: 'error', code: 'requirements',
  correction: `Code property checks failed for ${r.id}: ${r.code_evidence.checks.filter(c => c.status === 'failed').map(c => c.id + ' ' + c.code).join(', ')}` })
 const requirementKey = [...handoff.requirements].sort((a, b) => a.id.localeCompare(b.id))
 return {
  version: CAD_TARGETED_REVIEW_VERSION,
  binding: { candidate: input.candidateFingerprint, construction: input.construction, design_intent: stableJsonValue(input.designIntentPin ?? null),
   requirements: await fingerprint({ requirements: requirementKey, required: [...input.requiredFeatureIds].sort() }) },
  requirements,
  coverage: { views: { requested: [...handoff.views], rendered: [...input.renderedViews], missing }, references: [...input.referenceRefs], form_evidence: formEvidence.coverage },
  open_items: [...handoff.unresolved],
  code_findings,
  questions: { requirements: requirements.map(r => r.id), views: handoff.views.filter(view => input.renderedViews.includes(view)), reference: input.referenceRefs.length > 0 },
 }
}

/** A code failure is final for this candidate: no reviewer can approve it. */
export function codeFindingReview(packet: CadReviewPacket): CadReview {
 const failed = new Set(packet.requirements.filter(r => r.code_evidence?.status === 'failed').map(r => r.id))
 return { verdict: 'revise', summary: 'Deterministic checks failed before any model review.',
  requirements: packet.requirements.map(r => failed.has(r.id)
   ? { id: r.id, status: 'failed', evidence: 'Code property checks failed on the exact construction revision.' }
   : { id: r.id, status: 'unresolved', evidence: 'Not reviewed: deterministic checks failed first.' }),
  issues: structuredClone(packet.code_findings) }
}

const string = { type: 'string', minLength: 1, maxLength: 2000 }
const nullable = { type: ['string', 'null'], maxLength: 2000 }
const record = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const answer = (statuses: string[]) => record({ status: { type: 'string', enum: statuses }, evidence: string, correction: nullable })
const ISSUE_CODES = ['orientation', 'geometry', 'views', 'reference', 'requirements', 'readability', 'uncertainty'] as const
/** Catalog schema source. `requirements` is keyed by exact handoff ids through
 * the catalog's dynamic requirement binding, as for the full review. */
export const CAD_TARGETED_REVIEW_SCHEMA = record({
 summary: string,
 requirements: { type: 'array', maxItems: 24, items: record({ id: { type: 'string' }, status: { type: 'string', enum: ['met', 'unresolved', 'failed'] }, evidence: string, correction: nullable }) },
 views: answer(['met', 'unresolved', 'failed']),
 reference: answer(['met', 'unresolved', 'failed', 'not_applicable']),
 issues: { type: 'array', maxItems: 20, items: record({ severity: { type: 'string', enum: ['warning', 'error'] }, code: { type: 'string', enum: [...ISSUE_CODES] }, correction: string }) },
})

const exact = (v: any, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const validAnswer = (v: any, statuses: string[]) => exact(v, ['status', 'evidence', 'correction']) && statuses.includes(v.status) && text(v.evidence)
 && (v.correction === null || text(v.correction)) && (v.status !== 'failed' || v.correction !== null)

/** Strict: every packet requirement answered exactly once, a failure names its
 * correction, and the verdict is computed here rather than taken from a model. */
export function parseTargetedCadReview(value: unknown, packet: CadReviewPacket): CadReview | null {
 let v: any = value
 if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
 if (!exact(v, ['summary', 'requirements', 'views', 'reference', 'issues']) || !text(v.summary)) return null
 const ids = packet.questions.requirements
 let answers: any[] = v.requirements
 if (answers && !Array.isArray(answers)) {
  if (!exact(answers, ids)) return null
  answers = ids.map(id => ({ id, ...v.requirements[id] }))
 }
 if (!Array.isArray(answers) || answers.length !== ids.length || new Set(answers.map(a => a?.id)).size !== ids.length) return null
 for (const a of answers) { if (!ids.includes(a?.id)) return null; const { id: _id, ...rest } = a; if (!validAnswer(rest, ['met', 'unresolved', 'failed'])) return null }
 if (!validAnswer(v.views, ['met', 'unresolved', 'failed']) || !validAnswer(v.reference, ['met', 'unresolved', 'failed', 'not_applicable'])) return null
 if (packet.questions.reference === (v.reference.status === 'not_applicable')) return null
 if (!Array.isArray(v.issues) || v.issues.length > 20 || v.issues.some((r: any) => !exact(r, ['severity', 'code', 'correction'])
  || !['warning', 'error'].includes(r.severity) || !ISSUE_CODES.includes(r.code) || !text(r.correction))) return null
 const issues: CadReview['issues'] = structuredClone(v.issues)
 for (const a of answers) if (a.status === 'failed') issues.push({ severity: 'error', code: 'requirements', correction: `${a.id}: ${a.correction}` })
 for (const [key, code] of [['views', 'views'], ['reference', 'reference']] as const) {
  const a = v[key]
  if (a.status === 'failed') issues.push({ severity: 'error', code, correction: a.correction })
  else if (a.status === 'unresolved') issues.push({ severity: 'warning', code: 'uncertainty', correction: a.correction ?? a.evidence })
 }
 const required = new Set(packet.requirements.filter(r => r.required).map(r => r.id))
 const requirements = answers.map(a => ({ id: a.id as string, status: a.status as Status, evidence: a.evidence as string }))
 const revise = requirements.some(r => r.status === 'failed' || required.has(r.id) && r.status !== 'met') || issues.some(i => i.severity === 'error') || v.views.status !== 'met'
 return { verdict: revise ? 'revise' : 'pass', summary: v.summary, requirements, issues }
}

export async function targetedReviewBasis(packet: CadReviewPacket) {
 return { mode: 'targeted' as const, version: CAD_TARGETED_REVIEW_VERSION, packet: await fingerprint(packet) }
}
