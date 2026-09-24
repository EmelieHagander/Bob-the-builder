/** Shared product nouns. Runtime prompts and the dictionary table render this source. */
export const VOCABULARY_VERSION = '2026-09-24.1'
export const DOMAIN_TERMS = {
  project: { en: 'Project', sv: 'Projekt', meaning: 'Shared undertaking; distinct from a physical Building.' },
  plan: { en: 'Plan', sv: 'Plan', meaning: 'Organisation of this same work, not a second work tree.' },
  area: { en: 'Area', sv: 'Arbetsområde', meaning: 'Optional grouping of Steps within a Project; not a physical Space.' },
  plan_step: { en: 'Step', sv: 'Steg', meaning: 'Coherent work/result under Project or Area; not a Task instruction.' },
  task: { en: 'Task', sv: 'Uppgift', meaning: 'Assignable action with one primary Step; other links are references.' },
  task_instruction: { en: 'Instruction / checkpoint', sv: 'Instruktion / kontrollpunkt', meaning: 'Guidance/check within a Task (task_steps); distinct from plan Steps.' },
  phase: { en: 'Phase', sv: 'Fas', meaning: 'Lifecycle: concept/design/planning/build/complete; not a parent.' },
  status: { en: 'Status', sv: 'Status', meaning: 'Execution state; parallel active Steps are allowed. Bob focus is separate.' },
  completion_requirement: { en: 'Finish criterion', sv: 'Färdigvillkor', meaning: 'Evidence-backed condition for finishing a Step.' },
  dependency: { en: 'Dependency', sv: 'Beroende', meaning: 'Prerequisite; display order alone is not one.' },
  readiness: { en: 'Readiness', sv: 'Startklarhet', meaning: 'Prerequisites for proceeding; distinct from phase/status/approval.' },
  space: { en: 'Space', sv: 'Rum / utrymme', meaning: 'Persistent room/space, distinct from project Area.' },
  selected_target: { en: 'Selected design', sv: 'Vald lösning', meaning: 'Chosen Solution revision; distinct from physical scope and attachment destination.' },
  artifact: { en: 'Drawing / artifact', sv: 'Ritning / underlag', meaning: 'Versioned output at stated fidelity; an illustration is not measured geometry.' },
  assembly: { en: 'Assembly', sv: 'Konstruktion', meaning: 'Related CAD part instances, not a work Step. CAD STEP is a file format.' },
  material_requirement: { en: 'Material requirement', sv: 'Materialbehov', meaning: 'Required quantity/basis; distinct from stock, shopping and finish criteria.' },
} as const
export type DomainTerm = keyof typeof DOMAIN_TERMS
const core: DomainTerm[] = ['project', 'plan', 'area', 'plan_step', 'task', 'task_instruction', 'phase', 'status', 'completion_requirement', 'dependency', 'readiness']
const specialist: Record<'bob' | 'planner' | 'cad', DomainTerm[]> = {
  bob: [...core, 'space', 'selected_target', 'artifact'],
  planner: core,
  cad: ['project', 'area', 'plan_step', 'task', 'task_instruction', 'space', 'selected_target', 'artifact', 'assembly', 'material_requirement'],
}
export function domainVocabulary(role: keyof typeof specialist): string {
  return [`Shared vocabulary ${VOCABULARY_VERSION}`, 'Project → optional Area → Step → Task.',
    ...specialist[role].map(key => `${DOMAIN_TERMS[key].en}: ${DOMAIN_TERMS[key].meaning}`),
    'Null primary_step_id means unorganised work. Preserve it. Tools define writable scope and authority.',
  ].join('\n')
}
export function vocabularyTable(): string {
  return ['| Key | English | Svenska | Meaning |', '|---|---|---|---|',
    ...Object.entries(DOMAIN_TERMS).map(([key, term]) => `| ${key} | ${term.en} | ${term.sv} | ${term.meaning} |`),
  ].join('\n')
}
