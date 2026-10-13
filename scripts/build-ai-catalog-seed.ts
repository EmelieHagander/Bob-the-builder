/** One-time source-to-database migration builder. Runtime never imports this.
 * Rebuild with the pinned pre-migration git revision; deployed versions live in
 * shared.ai_prompt_versions, not in these former TypeScript declarations.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const SOURCE_REF = 'e0d5fcd4f212cb42743309ee0c0b5e8e37756d6d'
const root = process.cwd()
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : SOURCE_REF
const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : undefined
const shared = 'supabase/functions/_shared/'
type Definition = { key: string; kind: string; label: string; description: string; content: string; definition: any; metadata: any; variables: string[] }
const definitions = new Map<string, Definition>()
function read(file: string) { return execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 }) }
function add(key: string, kind: string, content = '', definition: any = {}, source?: string, variables: string[] = [], label = key, description = '') {
  if (definitions.has(key)) throw new Error(`Duplicate catalog key ${key}`)
  definitions.set(key, { key, kind, label, description, content, definition,
    metadata: { migrated_from: source ?? 'approved prompt proposal', source_revision: ref, seed_version: 1, label, description }, variables })
}

// Evaluate only requested constant initializers, lazily resolving AST symbols.
// This avoids module/network/environment side effects and retains exact numeric,
// enum, required-field and imported-schema values from the baseline.
type Module = { ast: ts.SourceFile; nodes: Map<string, ts.Node>; imports: Map<string, { file: string; name: string }>; values: Map<string, any> }
const modules = new Map<string, Module>()
function moduleFor(file: string): Module {
  if (modules.has(file)) return modules.get(file)!
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const module: Module = { ast, nodes: new Map(), imports: new Map(), values: new Map() }
  modules.set(file, module)
  for (const statement of ast.statements) {
    if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) module.nodes.set(d.name.text, d.initializer)
      if (ts.isObjectBindingPattern(d.name) && d.initializer) for (const binding of d.name.elements) if (ts.isIdentifier(binding.name)) {
        const synthetic = ts.createSourceFile(`${file}.${binding.name.text}`, `(()=>{const ${d.name.getText()}=${d.initializer.getText()};return ${binding.name.text}})()`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        module.nodes.set(binding.name.text, (synthetic.statements[0] as ts.ExpressionStatement).expression)
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) module.nodes.set(statement.name.text, statement)
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const spec = statement.moduleSpecifier.text
      if (!spec.startsWith('.') || statement.importClause?.isTypeOnly) continue
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
      const clause = statement.importClause
      if (clause?.name) module.imports.set(clause.name.text, { file: resolved, name: 'default' })
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) if (!binding.isTypeOnly) module.imports.set(binding.name.text, { file: resolved, name: binding.propertyName?.text ?? binding.name.text })
    }
  }
  return module
}
const builtins: Record<string, any> = { Object, Array, String, Number, Boolean, Math, JSON, Set, Map, RegExp, Date, structuredClone, undefined, NaN, Infinity }
function evaluate(file: string, node: ts.Node, locals: Record<string, any> = {}) {
  const source = ts.isFunctionDeclaration(node) ? node.getText().replace(/^export\s+/, '') : node.getText()
  const code = ts.transpile(`(${source})`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const scope = new Proxy({}, {
    has: () => true,
    get: (_, key) => {
      if (typeof key !== 'string') return undefined
      if (Object.hasOwn(locals, key)) return locals[key]
      if (Object.hasOwn(builtins, key)) return builtins[key]
      return value(file, key)
    },
  })
  return vm.runInNewContext(`(function(scope){with(scope){return ${code.trim().replace(/;$/, '')}}})(scope)`, { scope }, { timeout: 3000 })
}
function value(file: string, name: string): any {
  if (file.endsWith('.json')) return JSON.parse(read(file))
  const m = moduleFor(file)
  if (m.values.has(name)) return m.values.get(name)
  const imported = m.imports.get(name)
  if (imported) return value(imported.file, imported.name)
  const node = m.nodes.get(name)
  if (!node) throw new Error(`Unresolved extraction symbol ${file}:${name}`)
  const result = evaluate(file, node)
  m.values.set(name, result)
  return result
}
function nodes(file: string, predicate: (n: ts.Node) => boolean) {
  const result: ts.Node[] = []
  const visit = (n: ts.Node) => { if (predicate(n)) result.push(n); ts.forEachChild(n, visit) }
  visit(moduleFor(file).ast)
  return result
}
function strings(file: string) { return nodes(file, n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)).map(n => (n as ts.StringLiteral).text) }
function find(file: string, prefix: string) {
  const result = strings(file).find(s => s.startsWith(prefix))
  if (result === undefined) throw new Error(`Missing text ${file}: ${prefix}`)
  return result
}
function textFrom(file: string, symbol: string) { return String(value(shared + file, symbol)) }
function fragment(key: string, file: string, prefix: string, variables: string[] = []) { add(key, 'instruction_fragment', find(shared + file, prefix), {}, shared + file, variables) }

const seedFile = 'supabase/migrations/20261009150000_seed_bob_ai_catalog.sql'
const proposalPath = process.argv.includes('--proposal') ? process.argv[process.argv.indexOf('--proposal')+1] : undefined
const proposal = proposalPath ? readFileSync(proposalPath,'utf8') : ''
const approvedInput = JSON.parse(readFileSync('scripts/fixtures/bob-ai-personas-v1.json','utf8')) as {personas:Record<string,string>;method:string}
function paragraph(begin: string) {
  const start = proposal.indexOf(begin)
  if (start < 0) throw new Error(`Missing approved persona ${begin}`)
  return proposal.slice(start).split('\n\n')[0].trim()
}
const proposedPersonas: Record<string, () => string> = {
  'ask-bob': () => paragraph('Du är Bob,') + '\n\n' + paragraph('Du driver arbetet som'),
  'cad-designer': () => paragraph('Du är Daisy,'), 'cad-research': () => paragraph('Du är Kjell,'),
  'cad-reviewer': () => paragraph('Du är Rita,'), 'plan-compiler': () => paragraph('Du är Plantus,'),
  'plan-reviewer': () => paragraph('Du är Vera,'), 'context-summary': () => paragraph('Du sköter Bobs samtalsminne.'),
  'work-router': () => paragraph('Du ger serverns statusmeddelanden'), 'drawing-resume-reply': () => paragraph('Du formulerar beskedet efter'),
  'generate-project-image': () => paragraph('Kort bildroll för art direction:').replace('Kort bildroll för art direction: ', ''),
  'memory-agent': () => paragraph('Du är bygglagets minnesagent.'),
}
for (const [role, getter] of Object.entries(proposedPersonas)) {
  const key = role === 'ask-bob' ? 'bob.persona' : `${role}.persona`
  const content = proposal ? getter() : approvedInput.personas[key]
  if (!content) throw new Error(`Missing saved persona ${key}`)
  add(key, 'prompt', content)
}

add('bob.contract', 'instruction_fragment', String(value(shared + 'project-answer.ts', 'BOB_TRUTH_RULES')), {}, shared + 'project-answer.ts')
add('cad-designer.contract', 'instruction_fragment', textFrom('cad-assistant.ts', 'CAD_SYSTEM').split('\n\n').slice(1).join('\n\n'), {}, shared + 'cad-assistant.ts')
fragment('cad-research.contract', 'cad-research.ts', 'You collect source records')
add('cad-reviewer.contract', 'instruction_fragment', textFrom('cad-review.ts', 'CAD_REVIEW_SYSTEM'), {}, shared + 'cad-review.ts')
add('plan-compiler.contract', 'instruction_fragment', textFrom('plan-assistant.ts', 'COMPILER_SYSTEM'), {}, shared + 'plan-assistant.ts')
add('plan-reviewer.contract', 'instruction_fragment', textFrom('plan-assistant.ts', 'REVIEWER_SYSTEM'), {}, shared + 'plan-assistant.ts')
fragment('context-summary.contract', 'bob-working-context.ts', 'Continue the story of this private conversation')
add('work-router.contract', 'instruction_fragment', find(shared + 'delivery-language.ts', 'Localise server-owned delivery notices.') + textFrom('delivery-language.ts', 'DELIVERY_LANGUAGE_INSTRUCTION'), {}, shared + 'delivery-language.ts')
fragment('drawing-resume-reply.contract', 'drawing-resume-reply.ts', 'Write a compact private status reply')
add('generate-project-image.contract', 'instruction_fragment', 'Create the illustration described by the supplied image brief at its stated fidelity. The result is an illustration, with its origin and reference images preserved by the server.', {})
add('memory-agent.contract', 'agent_contract', '', { status: 'proposed_not_enabled', mandate: 'Manage derived memory within caller-authorized sources; never alter primary measurements, approvals, task status, phase or plan strategy.', implementation: 'Existing private conversation folding is context-summary; broader managed-memory lifecycle is not implemented by this catalog migration.' })

const vocabularyFile = 'src/domain/vocabulary.ts'
add('domain.vocabulary', 'vocabulary', '', { version: value(vocabularyFile, 'VOCABULARY_VERSION'), terms: value(vocabularyFile, 'DOMAIN_TERMS'), roles: value(vocabularyFile, 'specialist') }, vocabularyFile)
for (const role of ['bob', 'planner', 'cad']) add(`domain.vocabulary.${role}`, 'vocabulary', value(vocabularyFile, 'domainVocabulary')(role), { role, vocabulary_key: 'domain.vocabulary' }, vocabularyFile)
add('bob.method', 'project_method', proposal ? paragraph('Du arbetar genom projektets faser:') : approvedInput.method, {
  hierarchy: ['project', 'area?', 'plan_step', 'task'], vocabulary_key: 'domain.vocabulary',
  phases: [
    { key: 'concept', label: 'Idé', purpose: 'Klargöra vad som ska förändras, var och varför.' },
    { key: 'design', label: 'Design', purpose: 'Välja en konkret lösning för det aktuella arbetet.' },
    { key: 'planning', label: 'Planering', purpose: 'Göra lösningen möjlig att genomföra.' },
    { key: 'build', label: 'Genomförande', purpose: 'Genomföra arbetet och följa vad som händer på plats.' },
    { key: 'complete', label: 'Klart', purpose: 'Förankra slutresultat, uppföljning och historik i det som faktiskt blev byggt.' },
  ],
  authority: 'Existing phase/plan write authorization and approval contracts remain enforced by handlers and SQL.',
})

const schemas: Record<string, [string, string]> = {
  bob_conversation_brief: ['bob-conversation-brief.ts', 'CONVERSATION_BRIEF_SCHEMA'],
  bob_delivery_language: ['delivery-language.ts', 'DELIVERY_LANGUAGE_SCHEMA'],
  bob_plan_compilation: ['plan-assistant.ts', 'compilationSchema'], bob_plan_review: ['plan-assistant.ts', 'reviewSchema'],
  design_handoff: ['cad-review.ts', 'DESIGN_HANDOFF_SCHEMA'], bob_cad_review: ['cad-review.ts', 'CAD_REVIEW_SCHEMA'],
  cad_recipe: ['cad-schema.ts', 'CAD_RECIPE_SCHEMA'], cad_parameters: ['cad-parameters.ts', 'CAD_PARAMETERS_SCHEMA'],
  intake: ['cad-intake.ts', 'INTAKE_SCHEMA'], dimension_bindings: ['cad-intake.ts', 'DIMENSION_BINDINGS_SCHEMA'],
  cad_arrays: ['cad-arrays.ts', 'CAD_ARRAYS_SCHEMA'], cad_frames: ['cad-frames.ts', 'CAD_FRAMES_SCHEMA'],
}
for (const [key, [file, name]] of Object.entries(schemas)) add(`schema.${key}`, 'response_schema', '', value(shared + file, name), shared + file)
definitions.get('schema.bob_cad_review')!.metadata.dynamic_requirements = true
const resumeSchema = nodes(shared + 'drawing-resume-reply.ts', n => ts.isPropertyAssignment(n) && n.name.getText() === 'schema')[0] as ts.PropertyAssignment
add('schema.drawing_resume_reply', 'response_schema', '', evaluate(shared + 'drawing-resume-reply.ts', resumeSchema.initializer), shared + 'drawing-resume-reply.ts')

const toolMap = new Map<string, { tool: any; source: string }>()
function collectTools(result: any, source: string) {
  if (Array.isArray(result)) for (const item of result) collectTools(item, source)
  else if (result?.type === 'function' && result.function?.name && result.function.parameters) {
    const previous = toolMap.get(result.function.name)
    if (previous && JSON.stringify(previous.tool) !== JSON.stringify(result)) throw new Error(`Conflicting tool definition ${result.function.name}`)
    toolMap.set(result.function.name, { tool: result, source })
  }
}
const allSharedFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, shared], { encoding: 'utf8', cwd: root }).trim().split('\n').filter(f => f.endsWith('.ts'))
for (const file of allSharedFiles) for (const [name] of moduleFor(file).nodes) if (/(?:_TOOL|_TOOLS|^FINISH$|^EXPERT_TOOLS$)/.test(name)) collectTools(value(file, name), file)
// Context-category enum is server-bound from authorized adapters, not AI authored.
const contextFile = shared + 'project-context/dispatcher.ts'
const contextTools = nodes(contextFile, n => ts.isVariableDeclaration(n) && n.name.getText() === 'tools')[0] as ts.VariableDeclaration
collectTools(evaluate(contextFile, contextTools.initializer!, { registry: new Map() }), contextFile)
const descriptionTool = nodes(contextFile, n => ts.isObjectLiteralExpression(n) && n.getText().includes("name: 'describe_project_image'")).find(n => n.getText().startsWith("{ type: 'function'"))!
collectTools(evaluate(contextFile, descriptionTool), contextFile)

const oldCatalog = JSON.parse(read(shared + 'project-tools/catalog-seed.json'))
const policies = new Map(oldCatalog.map((row: any) => [row.name, row]))
for (const [name, { tool, source }] of [...toolMap].sort(([a], [b]) => a.localeCompare(b))) {
  const policy: any = policies.get(name)
  const parameters = tool.function.parameters
  const required = parameters.required ?? []
  const properties = Object.keys(parameters.properties ?? {})
  const definition = {
    ...tool.function, handler: name,
    additional_description: policy?.how_to ?? tool.function.description,
    required_parameters: required, optional_parameters: properties.filter(k => !required.includes(k)),
    envelope: { type: 'function', schema_version: policy?.schema_version ?? 1, arguments: 'JSON object validated against parameters; project binding and write provenance remain server-owned.' },
    expected_return: { format: 'json', contract: 'The registered handler returns its structured domain result and status; a successful write additionally returns its saved receipt. A provider tool call alone is not a saved result.' },
    ...(name === 'list_project_category' ? { schema_bindings: { 'parameters.properties.category.enum': 'server.categories' } } : {}),
  }
  add(`tools.${name}`, 'tool_contract', '', definition, source, [], policy?.description ?? tool.function.description)
  if (Object.hasOwn(parameters.properties ?? {}, 'request_quote')) definitions.get(`tools.${name}`)!.metadata.server_fields = ['request_quote']
  if (name === 'finish_cad_research') definitions.get(`tools.${name}`)!.metadata.dynamic_evidence_refs = true
  if (name === 'list_project_category') definitions.get(`tools.${name}`)!.metadata.schema_bindings = { 'parameters.properties.category.enum': 'server.categories' }
}
for (const row of oldCatalog) if (row.active && !toolMap.has(row.name)) throw new Error(`Active catalog tool without extracted schema: ${row.name}`)
add('bob.tools', 'tool_contract', '', { catalog: oldCatalog, shelves: value(shared + 'project-tools/bob-tools.ts', 'TOOLBOX_SHELVES'), contract_keys: [...toolMap.keys()].sort().map(name => `tools.${name}`) }, shared + 'project-tools/catalog-seed.json')

// Runtime instructions remain templates; variables carry only server-owned data.
fragment('cad-research.readiness-rules', 'cad-research.ts', 'Assess INPUT readiness')
fragment('cad-research.invalid-assessment', 'cad-research.ts', 'Assess every requirement once')
fragment('cad-reviewer.requirement-keys', 'cad-assistant.ts', '\nReport requirements as an object')
fragment('cad-designer.first-layout', 'cad-assistant.ts', 'First deliverable: a compact layout')
fragment('cad-designer.repair', 'cad-assistant.ts', 'Inspect and repair the rendered')
add('cad-designer.repair-with-delta', 'instruction_fragment', find(shared+'cad-assistant.ts','Inspect and repair the rendered') + find(shared+'cad-assistant.ts',' Send repairs with revise_cad_candidate'), {}, shared+'cad-assistant.ts')
const workflow = nodes(shared + 'cad-assistant.ts', n => ts.isTemplateExpression(n) && n.head.text.startsWith('\n\nWorkflow:'))[0] as ts.TemplateExpression
const workflowVariables = ['stage', 'remaining_calls', 'first_layout_instruction', 'repair_instruction', 'remaining_reads', 'input_corrections', 'renders']
const templateSlots = ['stage', 'remaining_calls', 'first_layout_instruction}}{{repair_instruction', 'remaining_reads', 'input_corrections', 'renders']
const workflowText = workflow.head.text + workflow.templateSpans.map((span, i) => `{{${templateSlots[i]}}}${span.literal.text}`).join('')
add('cad-designer.workflow', 'instruction_fragment', workflowText, {}, shared + 'cad-assistant.ts', workflowVariables)
add('work-router.inline-instruction', 'instruction_fragment', textFrom('delivery-language.ts', 'DELIVERY_LANGUAGE_INSTRUCTION'), {}, shared + 'delivery-language.ts')
add('drawing-review.instruction', 'instruction_fragment', textFrom('drawing-review.ts', 'DRAWING_REVIEW_INSTRUCTION'), {}, shared + 'drawing-review.ts')
add('delivery.meanings', 'instruction_fragment', '', value(shared + 'delivery-language.ts', 'DELIVERY_MEANINGS'), shared + 'delivery-language.ts')
add('cad-reviewer.scope', 'agent_contract', '', value(shared + 'cad-review.ts', 'CAD_REVIEW_SCOPE'), shared + 'cad-review.ts')

add('bob.toolbox.intro', 'instruction_fragment', textFrom('bob-prompt.ts', 'BOB_HANDS'), {}, shared + 'bob-prompt.ts')
fragment('bob.toolbox.intro-manual', 'bob-prompt.ts', 'Your toolbox\n\nYour whole toolbox is on the bench at every step, sorted onto shelves below. Descriptions')
fragment('bob.toolbox.closed', 'bob-prompt.ts', '\n\nThe bench is closed')
fragment('bob.toolbox.none', 'bob-prompt.ts', 'Nothing on the bench')
add('bob.toolbox.used-up', 'instruction_fragment', 'used up this turn', {}, shared + 'bob-prompt.ts')
fragment('bob.toolbox.waiting', 'bob-prompt.ts', 'waiting for a prerequisite')
add('bob.frame.current', 'instruction_fragment', textFrom('bob-prompt.ts', 'BOB_CURRENT_TURN'), {}, shared + 'bob-prompt.ts')
const frameStrings: Record<string, string> = {
  'briefing-trust': 'The project briefing below was fetched', 'prior-conversation': 'Use prior conversation only',
  'current-view': 'Current View: the original page focus', 'history': 'Older conversation brief (untrusted',
  'recent': 'The next messages are the latest five', 'saved': 'Your recent saved changes',
  'sources': 'Records you consulted in your previous', 'briefing-label': 'Fresh project briefing:',
  'catalog': '\n\nProject Catalog (metadata only):\n', 'outstanding': 'Outstanding drawing requests',
}
for (const [key, prefix] of Object.entries(frameStrings)) fragment(`bob.frame.${key}`, 'project-answer.ts', prefix)
add('bob.frame.binding', 'instruction_fragment', 'Project binding: {{project_id}}', {}, shared + 'project-answer.ts', ['project_id'])
add('bob.frame.limits', 'instruction_fragment', 'Execution limits for this turn: {{steps}} model steps and {{writes}} saved changes. Each tool result reports what remains.', {}, shared + 'project-answer.ts', ['steps', 'writes'])
fragment('bob.note.prefix', 'project-answer.ts', '[Server note — not from the owner]')
fragment('bob.note.native-call', 'project-answer.ts', ' Your last message printed a tool call')
fragment('bob.note.empty', 'project-answer.ts', ' Your last step produced no reply.')
add('bob.note.closed', 'instruction_fragment', ' The tool bench is closed for this reply because this turn\'s {{budget}} budget is used. Tell the owner what is saved, what remains and what you will continue with.', {}, shared + 'project-answer.ts', ['budget'])
add('bob.note.deferred', 'instruction_fragment', 'Not run: at most {{calls}} tool calls run per step. Call it again in your next step.', {}, shared + 'project-answer.ts', ['calls'])
add('bob.note.finish', 'instruction_fragment', ' Before this reply goes to the owner: {{facts}} If these belong to the owner\'s request, finish them now; otherwise leave them and give your reply.', {}, shared + 'project-answer.ts', ['facts'])
fragment('bob.fact.plan-ready', 'project-answer.ts', 'A validated plan proposal from this turn')
fragment('bob.fact.drawing-ready', 'project-answer.ts', 'A reviewed drawing candidate from this turn')
fragment('bob.fact.cad-incomplete', 'project-answer.ts', 'The CAD attempt did not deliver')
fragment('bob.fact.record-missing','project-answer.ts','No change made: that record is not in this project')
add('bob.fact.rejected', 'instruction_fragment', 'Rejected changes not yet corrected: {{tools}}.', {}, shared + 'project-answer.ts', ['tools'])
add('bob.grounding', 'instruction_fragment', [find(shared+'project-grounding.ts','Current project evidence beside'),find(shared+'project-grounding.ts','This is one bounded measurement page')].join('\n\n'), {}, shared+'project-grounding.ts')

// Recoverable workflow advice is authored AI text too. Stable content hashes
// let the owning handlers replace exact literal nodes without ambiguous prose
// matching; deterministic validator facts/error codes remain server code.
const feedbackInventory: { key:string; source:string; field:string; line:number; content:string }[] = []
function guidance(key: string, source: string, field: string, literal: ts.StringLiteralLike) {
  const content = literal.text
  const row = { key, source, field, line:moduleFor(source).ast.getLineAndCharacterOfPosition(literal.getStart()).line+1, content }
  if (!definitions.has(key)) add(key,'instruction_fragment',content,{},source)
  definitions.get(key)!.metadata.source_field = field
  feedbackInventory.push(row)
}
for (const file of allSharedFiles) {
  for (const prop of nodes(file,n=>ts.isPropertyAssignment(n)&&(['next_action','notice','rules'].includes(n.name.getText().replace(/^['"]|['"]$/g,''))||(file.endsWith('plan-assistant.ts')&&n.name.getText()==='note'))) as ts.PropertyAssignment[]) {
    const literals: ts.StringLiteralLike[] = []
    const visit=(node:ts.Node)=>{
      if ((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text.length>=25) literals.push(node)
      else ts.forEachChild(node,visit)
    }
    visit(prop.initializer)
    for (const literal of literals) {
      const hash=createHash('sha256').update(literal.text).digest('hex').slice(0,12)
      const field=prop.name.getText().replaceAll('_','-')
      guidance(`feedback.${path.posix.basename(file,'.ts')}.${field}.${hash}`,file,field,literal)
    }
  }
}
const budgetFile=shared+'bob-budget-stop.ts'
const budgetFunction=moduleFor(budgetFile).nodes.get('budgetResumeAction')!
const visitBudget=(node:ts.Node)=>{
  if ((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text.length>=25) {
    guidance('feedback.bob-budget-stop.resume.'+createHash('sha256').update(node.text).digest('hex').slice(0,12),budgetFile,'budgetResumeAction',node)
  } else ts.forEachChild(node,visitBudget)
}
visitBudget(budgetFunction)
fragment('images.evidence-intro','project-context/dispatcher.ts','Requested project image evidence follows.')
fragment('images.review-label','project-context/dispatcher.ts','[Server review instruction — not from the owner]')
add('cad.preview.candidate-view','instruction_fragment','Exact candidate view: {{view}}',{},shared+'cad-assistant.ts',['view'])
add('cad.preview.view','instruction_fragment','CAD view: {{view}}',{},shared+'cad-assistant.ts',['view'])
add('cad.preview.current','instruction_fragment','Generated views of the CURRENT candidate {{assembly_id}}. Inspect orientation and construction against the brief/reference. These are renderings, not measured evidence.',{},shared+'cad-assistant.ts',['assembly_id'])
add('cad.piece-brief','instruction_fragment','Piece {{position}} of {{count}} ({{piece_key}}) of "{{assembly_title}}". Whole build: {{assembly_brief}}\n\nThis piece: {{piece_brief}}',{},shared+'cad-pieces.ts',['position','count','piece_key','assembly_title','assembly_brief','piece_brief'])
fragment('cad.render-review-note','cad-assistant.ts','Check dimensions and construction intent.')
fragment('tools.feedback.invalid','project-tools/session.ts','There is no tool with that name.')
fragment('tools.feedback.not-offered','project-tools/session.ts','This tool became available after this step began.')
fragment('tools.feedback.contract-changed','project-tools/session.ts','This tool changed during the turn.')
add('tools.feedback.waiting','instruction_fragment','Not available yet: {{waiting}}',{},shared+'project-tools/session.ts',['waiting'])
fragment('tools.waiting.plan-direct','project-tools/bob-tools.ts','use save_compiled_project_plan for a plan compiled')
fragment('tools.waiting.cad-ready','project-tools/bob-tools.ts','appears when design_project_cad returns')
fragment('tools.waiting.plan-ready','project-tools/bob-tools.ts','appears when compile_project_plan or edit_project_plan returns')

const roleSpecs: Record<string, { name: string; title: string; purpose: string; tier: string; effort: string | null; tokens: number; module: string; vocab?: string; schema?: string; enabled?: boolean }> = {
  'ask-bob': { name: 'Bob', title: 'Byggexpert och projektkollega', purpose: 'Driver beställarens delegerade arbete från idé till slutfört bygge.', tier: 'standard', effort: 'high', tokens: 16000, module: 'global', vocab: 'bob' },
  'cad-designer': { name: 'Daisy', title: 'Designer', purpose: 'Utformar, renderar och förbättrar en CAD-kandidat inom det avgränsade uppdraget.', tier: 'standard', effort: 'medium', tokens: 32000, module: 'cad', vocab: 'cad' },
  'cad-research': { name: 'Kjell', title: 'Researcher', purpose: 'Undersöker underlag och startklarhet; lämnar exakta källposter till konstruktören.', tier: 'mini', effort: 'low', tokens: 3000, module: 'cad', vocab: 'cad', schema: 'intake' },
  'cad-reviewer': { name: 'Rita', title: 'Ritningsgranskare', purpose: 'Bedömer den exakta kandidatens krav, geometri, källor och vyer oberoende.', tier: 'mini', effort: 'high', tokens: 50000, module: 'cad', vocab: 'cad', schema: 'bob_cad_review' },
  'plan-compiler': { name: 'Plantus', title: 'Planskrivare', purpose: 'Gör Bobs avsikt till en exakt planrepresentation utifrån behörigt aktuellt projektunderlag.', tier: 'mini', effort: 'low', tokens: 24000, module: 'living-plan', vocab: 'planner', schema: 'bob_plan_compilation' },
  'plan-reviewer': { name: 'Vera', title: 'Plangranskare', purpose: 'Ger rådgivande oberoende granskning av avsikt, ordning, identiteter och belägg.', tier: 'nano', effort: 'low', tokens: 4000, module: 'living-plan', vocab: 'planner', schema: 'bob_plan_review' },
  'context-summary': { name: 'Samtalsminnet', title: 'Förvaltare av privat konversationsminne', purpose: 'Sammanfattar och indexerar privat samtal utan att omvandla historik till aktuell projektfakta.', tier: 'mini', effort: 'low', tokens: 3000, module: 'global', schema: 'bob_conversation_brief' },
  'work-router': { name: 'Statusspråk', title: 'Statuslokaliserare', purpose: 'Återger serverns verifierade statusbetydelser på beställarens språk.', tier: 'standard', effort: 'low', tokens: 4000, module: 'global', schema: 'bob_delivery_language' },
  'drawing-resume-reply': { name: 'Ritningsbesked', title: 'Återupptagningsbesked', purpose: 'Formulerar ett kvittobaserat besked om återupptaget ritningsarbete.', tier: 'standard', effort: 'low', tokens: 4000, module: 'global', schema: 'drawing_resume_reply' },
  'project-image': { name: 'Illustratören', title: 'Bildgenerator', purpose: 'Gestaltar en avgränsad bildbrief som illustration med angiven fidelity.', tier: 'image', effort: null, tokens: 1000, module: 'global' },
}
for (const [role, spec] of Object.entries(roleSpecs)) {
  const personaKey = role === 'ask-bob' ? 'bob.persona' : role === 'project-image' ? 'generate-project-image.persona' : `${role}.persona`
  const contractKey = role === 'ask-bob' ? 'bob.contract' : role === 'project-image' ? 'generate-project-image.contract' : `${role}.contract`
  const methodKeys = spec.vocab ? [`domain.vocabulary.${spec.vocab}`, ...(role === 'ask-bob' ? ['bob.method'] : [])] : []
  const toolKeys = role === 'ask-bob' ? oldCatalog.filter((t:any)=>toolMap.has(t.name)).map((t: any) => `tools.${t.name}`) : role === 'cad-designer' ? ['render_cad_candidate', 'render_saved_cad_candidate', 'report_cad_blocker', 'read_cad_artifact', 'revise_cad_candidate'].map(n => `tools.${n}`) : role === 'cad-research' ? ['tools.finish_cad_research'] : []
  add(`profile.${role}`, 'execution_profile', '', { tier: spec.tier, reasoning_effort: spec.effort, max_output_tokens: spec.tokens, timeout_ms: spec.tier === 'image' ? 180000 : 120000, requirements: { images: ['ask-bob', 'cad-designer', 'cad-research', 'cad-reviewer'].includes(role), functions: toolKeys.length > 0, json_schema: !!spec.schema }, provider_adapter: spec.tier === 'image' ? 'openai-images-v1' : 'openai-responses-v1', ...(spec.tier==='image'?{provider_parameters:{size:'1024x1536',quality:'high'}}:{}) })
  add(`routing.${role}`, 'routing_policy', '', { default_profile_key: `profile.${role}`, escalation_profile_key: null, escalation: { enabled: false, reason: 'Current tier preserved; model routing evaluation is separate from this migration.' }, fallback: 'fail_closed', binding: 'same_manifest_for_whole_job' })
  if (!definitions.has(`agent-contract.${role}`)) add(`agent-contract.${role}`, 'agent_contract', '', { mode: role === 'ask-bob' || role === 'cad-designer' ? 'tool_loop' : role === 'cad-research' ? 'read_only_tool_loop' : 'structured_read_only', instructions_key: contractKey, response_schema_key: spec.schema ? `schema.${spec.schema}` : null, source_scope: role === 'context-summary' ? 'private_conversation' : 'caller_authorized_project', writes: role === 'ask-bob' ? 'registered domain handlers only' : 'none', review_authority: role === 'cad-reviewer' ? 'candidate gate only' : role === 'plan-reviewer' ? 'advisory, no veto' : null })
  const additionalPromptKeys = role === 'cad-designer' ? ['cad-designer.workflow'] : role === 'cad-reviewer' ? ['cad-reviewer.requirement-keys'] : []
  add(`role.${role}`, 'role', '', { name: spec.name, title: spec.title, purpose: spec.purpose, function_name: role === 'drawing-resume-reply' ? 'work-router' : role, module: spec.module, coworker_id: 'bob', enabled: spec.enabled ?? true, prompt_keys: [personaKey, contractKey, ...methodKeys, ...additionalPromptKeys], profile_key: `profile.${role}`, routing_key: `routing.${role}`, contract_key: `agent-contract.${role}`, method_keys: methodKeys, tool_keys: toolKeys, ...(spec.schema ? {response_schema_key:`schema.${spec.schema}`} : {}) }, undefined, [], spec.title, spec.purpose)
}
add('profile.memory-agent', 'execution_profile', '', { tier:'mini', reasoning_effort:'low', max_output_tokens:3000, timeout_ms:120000, requirements:{images:false,functions:false,json_schema:false},provider_adapter:'openai-responses-v1' })
add('role.memory-agent', 'role', '', { name: 'Minnesagenten', title: 'Förvaltare av härlett projekt- och samtalsminne', purpose: 'Sparar, hämtar och arkiverar relevanta härledda minnen.', enabled: false, prompt_keys: ['memory-agent.persona'], profile_key: 'profile.memory-agent', contract_key: 'memory-agent.contract', method_keys: [], tool_keys: [], status: 'cataloged_proposal_not_runtime_capability' })
for (const tier of ['nano', 'mini', 'standard', 'image']) add(`tier.${tier}`, 'tier_binding', '', { tier, model_name: tier === 'nano' ? 'gpt-5.4-nano' : tier === 'mini' ? 'gpt-5.4-mini' : tier === 'standard' ? 'gpt-5.4' : null, selection: 'preserve_existing_ai_settings_on_seed' })

const records = [...definitions.values()].sort((a, b) => a.key.localeCompare(b.key))
const json = JSON.stringify(records, null, 2)
const sql = `-- Generated by scripts/build-ai-catalog-seed.ts from ${ref}.
-- Canonical runtime values are immutable database versions. No runtime fallback.
begin;
do $seed$
declare item jsonb; prompt_uuid uuid; version_uuid uuid; next_version integer; binding_model text;
  activation jsonb:='{}'; current_setting shared.ai_settings;
begin
  for item in select value from jsonb_array_elements($ai_catalog_seed$${json}$ai_catalog_seed$::jsonb) loop
    if item->>'kind'='tier_binding' then
      -- Bind image to the existing image function; text tiers to their existing
      -- role settings. This deliberately preserves the currently deployed models.
      select s.model into binding_model from shared.ai_settings s
      where s.app='bob' and s.coworker_id='bob' and s.model_type::text=item->'definition'->>'tier'
        and s.model is not null
      order by (s.function_name=case item->'definition'->>'tier' when 'standard' then 'ask-bob' when 'mini' then 'context-summary' when 'nano' then 'plan-reviewer' else 'generate-project-image' end) desc,s.updated_at desc limit 1;
      if binding_model is null then binding_model:=item->'definition'->>'model_name'; end if;
      if binding_model is null then raise exception 'Missing active model for tier %',item->'definition'->>'tier'; end if;
      item:=jsonb_set(item,'{definition,model_name}',to_jsonb(binding_model));
    end if;
    if item->>'kind'='execution_profile' then
      select * into current_setting from shared.ai_settings
      where app='bob' and coworker_id='bob' and function_name=case replace(item->>'key','profile.','')
        when 'drawing-resume-reply' then 'work-router' when 'memory-agent' then 'context-summary'
        else replace(item->>'key','profile.','') end
      order by updated_at desc limit 1;
      if found then
        item:=jsonb_set(item,'{definition,max_output_tokens}',to_jsonb(greatest((item->'definition'->>'max_output_tokens')::integer,coalesce(current_setting.max_output_tokens,0))));
        item:=jsonb_set(item,'{definition,reasoning_effort}',coalesce(to_jsonb(current_setting.reasoning_effort),'null'::jsonb));
        item:=jsonb_set(item,'{definition,tier}',to_jsonb(current_setting.model_type));
      end if;
    end if;
    insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
    values('bob',item->>'key',item->>'label',item->>'description',item->>'content','',item->>'kind')
    on conflict(app,prompt_key) do update set label=excluded.label,description=excluded.description,definition_kind=excluded.definition_kind
    returning id into prompt_uuid;
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prompt_uuid;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prompt_uuid,next_version,item->>'kind',1,item->'metadata',item->>'content',item->'definition','',item->'variables') returning id into version_uuid;
    activation:=activation||jsonb_build_object(item->>'key',version_uuid::text);
  end loop;
  -- Adapter capabilities describe only the supported baseline, preserving any
  -- already explicit catalog values. Model generation/repricing stays central.
  update shared.ai_models set capabilities=jsonb_build_object(
    'provider_adapter',case when model_type='image' then 'openai-images-v1' else 'openai-responses-v1' end,
    'supports_functions',model_type in ('nano','mini','standard'),
    'supports_json_schema',supports_json_schema,
    'reasoning_efforts',case when supports_reasoning then '["low","medium","high"]'::jsonb else '[]'::jsonb end
  )||capabilities
  where model_name in (select definition->>'model_name' from shared.ai_prompt_versions
    where id::text in (select value from jsonb_each_text(activation)) and definition_kind='tier_binding');
  perform shared.activate_ai_catalog('bob',activation);
end $seed$;
commit;
`
if (process.argv.includes('--feedback-inventory')) process.stdout.write(JSON.stringify(feedbackInventory,null,2)+'\n')
else if (process.argv.includes('--json')) process.stdout.write(json + '\n')
else if (process.argv.includes('--check')) { const target = output ?? seedFile; if (readFileSync(target,'utf8') !== sql) throw new Error(`Catalog seed differs: rebuild ${target}`); console.log(`Verified ${target}: ${records.length} definitions.`) }
else if (output) { writeFileSync(output, sql); console.log(`Wrote ${output}: ${records.length} definitions, ${toolMap.size} tool contracts, ${Object.keys(roleSpecs).length} enabled roles.`) }
else console.log(JSON.stringify({ source_revision: ref, definitions: records.length, tools: toolMap.size, keys: records.map(d => d.key) }, null, 2))
