/** Server-only, request-scoped AI configuration. The database owns definitions;
 * this module owns their format and provider-adapter validation. It has no
 * default prompt, model or tier and never reads project data. */
export type AiDefinitionKind = 'role' | 'prompt' | 'tool_contract' | 'agent_contract' |
  'project_method' | 'execution_profile' | 'tier_binding' | 'routing_policy' |
  'response_schema' | 'instruction_fragment' | 'vocabulary'
export type AiTier = 'nano' | 'mini' | 'standard' | 'image' | 'embedding'
type JsonObject = Record<string, unknown>
export type AiVariables = Record<string, string | number | boolean | null>
export interface AiCatalogDefinition {
  id: string; prompt_id: string; prompt_key: string; version: number;
  definition_kind: AiDefinitionKind; definition_format_version: number;
  content: string; definition: JsonObject; metadata: JsonObject;
  flow?: unknown; available_variables?: unknown; payload_hash: string;
}
export interface AiCatalogModel {
  model_name: string; provider: string; model_type?: AiTier; is_active: boolean; is_default: boolean;
  max_output_tokens: number; supports_images: boolean; supports_reasoning: boolean;
  supports_image_output: boolean; input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number; cached_input_cost_per_1m_tokens: number | null;
  capabilities: JsonObject; [key: string]: unknown;
}
export interface AiCatalogManifest {
  format_version: 1; app: string; manifest_id: string; created_at: string;
  definitions: AiCatalogDefinition[]; models: AiCatalogModel[];
  settings?: JsonObject[];
}
export interface AiCatalogClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface AiFunctionTool {
  type: 'function'; function: { name: string; description: string; parameters: JsonObject; strict?: boolean };
}
export interface ResolvedAiRole {
  app: string; manifestId: string; roleKey: string; roleVersionId: string;
  profileVersionId: string; tierVersionId: string; tier: AiTier;
  model: AiCatalogModel; providerAdapter: 'openai-responses-v1' | 'openai-images-v1';
  reasoningEffort: string | null; maxOutputTokens: number; timeoutMs?: number;
  providerParameters: JsonObject; systemMessage: string;
  definition: AiCatalogDefinition; profile: AiCatalogDefinition;
}
export class AiCatalogError extends Error {
  constructor(public readonly code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'AiCatalogError' }
}
const kinds = new Set<AiDefinitionKind>(['role','prompt','tool_contract','agent_contract','project_method','execution_profile','tier_binding','routing_policy','response_schema','instruction_fragment','vocabulary'])
const tiers = new Set<string>(['nano','mini','standard','image','embedding'])
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function fail(code: string, detail?: string): never { throw new AiCatalogError(code, detail) }
function validateProviderParameters(params: unknown, adapter: string): JsonObject {
  const allowed = adapter === 'openai-images-v1' ? ['size','quality'] : ['temperature','top_p','parallel_tool_calls','verbosity']
  if (!object(params) || Object.keys(params).some(name => !allowed.includes(name))) fail('ai_profile_incompatible','provider parameters')
  if (adapter === 'openai-images-v1' && (params.size === undefined || params.quality === undefined)) fail('ai_profile_incompatible','image profile parameters')
  if (params.temperature !== undefined && (!finite(params.temperature) || params.temperature < 0 || params.temperature > 2)) fail('ai_profile_incompatible','temperature')
  if (params.top_p !== undefined && (!finite(params.top_p) || params.top_p < 0 || params.top_p > 1)) fail('ai_profile_incompatible','top_p')
  if (params.parallel_tool_calls !== undefined && typeof params.parallel_tool_calls !== 'boolean') fail('ai_profile_incompatible','parallel tools')
  if (params.verbosity !== undefined && !['low','medium','high'].includes(String(params.verbosity))) fail('ai_profile_incompatible','verbosity')
  if (params.quality !== undefined && !['low','medium','high'].includes(String(params.quality))) fail('ai_profile_incompatible','image quality')
  if (params.size !== undefined && !['1024x1024','1024x1536','1536x1024'].includes(String(params.size))) fail('ai_profile_incompatible','image size')
  return params
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
/** Snapshot JSON is produced/hashed by a service-only RPC. Copy before freezing
 * so a caller cannot mutate a pinned model, price or definition afterwards. */
export function validateAiManifest(value: unknown, app: string): AiCatalogManifest {
  if (!object(value) || value.format_version !== 1 || value.app !== app || !string(value.manifest_id) || !string(value.created_at) || !Array.isArray(value.definitions) || !Array.isArray(value.models)) fail('ai_catalog_invalid')
  const seen = new Set<string>()
  for (const raw of value.definitions) {
    if (!object(raw) || !string(raw.id) || !string(raw.prompt_id) || !string(raw.prompt_key) || !Number.isInteger(raw.version) || Number(raw.version) < 1 || raw.definition_format_version !== 1 || !kinds.has(raw.definition_kind as AiDefinitionKind) || typeof raw.content !== 'string' || !object(raw.definition) || !object(raw.metadata) || !string(raw.payload_hash) || seen.has(raw.prompt_key)) fail('ai_catalog_invalid','definition')
    seen.add(raw.prompt_key)
  }
  const models = new Set<string>()
  for (const raw of value.models) {
    if (!object(raw) || !string(raw.model_name) || !string(raw.provider) || raw.is_active !== true || !finite(raw.max_output_tokens) || raw.max_output_tokens < 1 || !object(raw.capabilities) || models.has(raw.model_name)) fail('ai_catalog_invalid','model')
    for (const field of ['input_cost_per_1m_tokens','output_cost_per_1m_tokens']) if (!finite(raw[field]) || Number(raw[field]) < 0) fail('ai_catalog_invalid','model pricing')
    for (const field of ['supports_images','supports_reasoning','supports_image_output','is_default']) if (typeof raw[field] !== 'boolean') fail('ai_catalog_invalid','model capability flags')
    if (raw.cached_input_cost_per_1m_tokens !== null && (!finite(raw.cached_input_cost_per_1m_tokens) || raw.cached_input_cost_per_1m_tokens < 0)) fail('ai_catalog_invalid','cached pricing')
    models.add(raw.model_name)
  }
  if (value.settings !== undefined && (!Array.isArray(value.settings) || !value.settings.every(object))) fail('ai_catalog_invalid','settings')
  return freeze(JSON.parse(JSON.stringify(value)) as AiCatalogManifest)
}
function refs(value: unknown, code = 'ai_contract_missing'): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(string)) fail(code,'references')
  return value as string[]
}
function render(definition: AiCatalogDefinition, variables: AiVariables): string {
  // Only declared variables can substitute text; unknown braces (JSON examples)
  // remain literal. Missing declared variables fail before provider dispatch.
  const available = definition.available_variables
  const declared = Array.isArray(available) ? available.map(v => typeof v === 'string' ? v : object(v) ? v.name : undefined).filter(string)
    : object(available) ? Object.keys(available) : []
  let result = definition.content
  for (const name of declared) {
    const marker = '{{' + name + '}}'
    if (!result.includes(marker)) continue
    if (!(name in variables)) fail('ai_prompt_missing','variable ' + name)
    result = result.split(marker).join(variables[name] === null ? '' : String(variables[name]))
  }
  return result
}
export interface AiCatalogSession {
  load(): Promise<AiCatalogManifest>;
  manifest(): AiCatalogManifest;
  definition(key: string, kind?: AiDefinitionKind): AiCatalogDefinition;
  text(key: string, variables?: AiVariables): string;
  role(key: string, variables?: AiVariables): ResolvedAiRole;
  tool(key: string, parameters?: Record<string, unknown>): AiFunctionTool;
  schema(key: string, parameters?: Record<string, unknown>): { name: string; description?: string; schema: JsonObject; strict: boolean };
}
function parameterStrings(parameters: JsonObject, key: string): string[] | undefined {
  const value = parameters[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(string) || new Set(value).size !== value.length) fail('ai_contract_missing','invalid ' + key)
  return value as string[]
}
function toolParameters(row: AiCatalogDefinition, parameters: JsonObject): JsonObject {
  const allowed = new Set<string>()
  const bindings = object(row.metadata.schema_bindings) ? row.metadata.schema_bindings : object(row.definition.schema_bindings) ? row.definition.schema_bindings : {}
  for (const source of Object.values(bindings)) if (typeof source === 'string' && source.startsWith('server.')) allowed.add(source.slice(7))
  if (row.metadata.dynamic_evidence_refs === true || row.definition.dynamic_evidence_refs === true) allowed.add('evidence_refs')
  if (row.metadata.dynamic_requirements === true || row.definition.dynamic_requirements === true) allowed.add('requirement_ids')
  if (Array.isArray(row.metadata.server_fields)) allowed.add('server_quote')
  allowed.add('include_manual')
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => allowed.has(key)))
}
/** A contract declares exact paths that may receive server-owned task data.
 * This never merges an arbitrary caller-provided schema into a definition. */
function boundSchema(row: AiCatalogDefinition, source: JsonObject, parameters: JsonObject): JsonObject {
  const result = JSON.parse(JSON.stringify(source)) as JsonObject
  const bindings = object(row.metadata.schema_bindings) ? row.metadata.schema_bindings : object(row.definition.schema_bindings) ? row.definition.schema_bindings : {}
  for (const [path, sourceName] of Object.entries(bindings)) {
    if (typeof sourceName !== 'string' || !sourceName.startsWith('server.')) fail('ai_contract_missing','schema binding')
    const key = sourceName.slice(7), values = parameterStrings(parameters,key)
    if (values === undefined) continue
    const parts = path.replace(/^parameters\./,'').replace(/^schema\./,'').split('.')
    if (parts.some(part => ['__proto__','constructor','prototype'].includes(part))) fail('ai_contract_missing','schema binding path')
    let target: unknown = result
    for (const part of parts.slice(0,-1)) target = object(target) && Object.hasOwn(target,part) ? target[part] : undefined
    if (!object(target)) fail('ai_contract_missing','schema binding path')
    target[parts.at(-1)!] = values
  }
  const ids = parameterStrings(parameters,'requirement_ids')
  if (ids) {
    if (row.definition.dynamic_requirements !== true && row.metadata.dynamic_requirements !== true) fail('ai_contract_missing','undeclared requirement binding')
    const properties = object(result.properties) ? result.properties : undefined
    const requirements = properties && object(properties.requirements) ? properties.requirements : undefined
    const item = requirements && object(requirements.items) ? requirements.items : undefined
    if (!properties || !item || !object(item.properties)) fail('ai_contract_missing','requirement item schema')
    const { id: _id, ...itemProperties } = item.properties
    const itemSchema = { ...item, properties: itemProperties, required: Object.keys(itemProperties) }
    properties.requirements = { type: 'object', additionalProperties: false, properties: Object.fromEntries(ids.map(id => [id,itemSchema])), required: ids }
  }
  const evidence = parameterStrings(parameters,'evidence_refs')
  if (evidence) {
    if (row.definition.dynamic_evidence_refs !== true && row.metadata.dynamic_evidence_refs !== true) fail('ai_contract_missing','undeclared evidence binding')
    const properties = object(result.properties) ? result.properties : {}
    for (const name of ['checks','additional_needs',...(properties.execution_issues?['execution_issues']:[])]) {
      const field = properties[name]
      const items = object(field) && object(field.items) ? field.items : undefined
      const itemProperties = items && object(items.properties) ? items.properties : undefined
      const sourceRefs = itemProperties && object(itemProperties.source_refs) ? itemProperties.source_refs : undefined
      if (!sourceRefs || !object(sourceRefs.items)) fail('ai_contract_missing','evidence item schema')
      if (!evidence.length) sourceRefs.maxItems = 0
      else if (evidence.length <= 400 && JSON.stringify(evidence).length <= 30000) sourceRefs.items.enum = [...evidence].sort()
    }
  }
  if (parameters.server_quote === true) {
    if (!Array.isArray(row.metadata.server_fields) || !row.metadata.server_fields.every(string)) fail('ai_contract_missing','server fields')
    const fields = row.metadata.server_fields as string[]
    const properties = object(result.properties) ? result.properties : {}
    for (const field of fields) delete properties[field]
    if (Array.isArray(result.required)) result.required = result.required.filter(key => !fields.includes(String(key)))
  }
  return result
}
export function createAiCatalogSession(client: AiCatalogClient, options: { app: string; manifest?: unknown; manifestId?: string }): AiCatalogSession {
  let snapshot = options.manifest === undefined ? undefined : validateAiManifest(options.manifest, options.app)
  let pending: Promise<AiCatalogManifest> | undefined
  const manifest = () => snapshot ?? fail('ai_catalog_not_loaded')
  const definition = (key: string, kind?: AiDefinitionKind) => {
    const found = manifest().definitions.find(row => row.prompt_key === key)
    if (!found || (kind && found.definition_kind !== kind)) fail(kind === 'prompt' || kind === 'instruction_fragment' ? 'ai_prompt_missing' : kind === 'execution_profile' ? 'ai_profile_missing' : 'ai_contract_missing',key)
    return found!
  }
  const session: AiCatalogSession = {
    async load() {
      if (snapshot) return snapshot
      if (!pending) pending = (async () => {
        const { data, error } = await client.rpc('resolve_ai_catalog', { p_app: options.app, p_manifest_id: options.manifestId ?? null })
        if (error) fail('ai_catalog_unavailable')
        snapshot = validateAiManifest(data,options.app)
        return snapshot
      })()
      return pending
    },
    manifest, definition,
    text(key, variables = {}) { const row = definition(key); if (!['prompt','instruction_fragment','project_method','vocabulary','agent_contract'].includes(row.definition_kind)) fail('ai_prompt_missing',key); return render(row,variables) },
    role(key, variables = {}) {
      const row = definition(key.startsWith('role.') ? key : 'role.' + key,'role')
      const body = row.definition
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') fail('ai_catalog_invalid','role enabled flag')
      if (body.enabled === false) fail('ai_function_disabled',key)
      let profileKey = body.profile_key
      if (body.routing_key) {
        const routing = definition(String(body.routing_key),'routing_policy').definition
        profileKey = routing.default_profile_key ?? routing.default_profile ?? profileKey
      }
      if (!string(profileKey)) fail('ai_profile_missing',key)
      const profile = definition(profileKey,'execution_profile'), config = profile.definition
      if (config.enabled !== undefined && typeof config.enabled !== 'boolean') fail('ai_catalog_invalid','profile enabled flag')
      if (config.enabled === false) fail('ai_function_disabled',key)
      const tier = config.tier ?? config.model_type
      if (!string(tier) || !tiers.has(tier)) fail('ai_tier_unavailable',key)
      const bindings = manifest().definitions.filter(d => d.definition_kind === 'tier_binding' && d.definition.tier === tier)
      if (bindings.length !== 1) fail('ai_tier_unavailable',tier)
      const binding = bindings[0], model = manifest().models.find(m => m.model_name === binding.definition.model_name)
      if (!model) fail('ai_tier_unavailable',tier)
      const adapter = model.capabilities.provider_adapter
      if (model.provider !== 'openai' || (adapter !== 'openai-responses-v1' && adapter !== 'openai-images-v1')) fail('ai_profile_incompatible','provider adapter')
      if ((tier === 'image') !== (adapter === 'openai-images-v1') || (tier === 'image' && !model.supports_image_output)) fail('ai_profile_incompatible','model class')
      const effort = config.reasoning_effort ?? null
      if (effort !== null && (!string(effort) || !model.supports_reasoning || !Array.isArray(model.capabilities.reasoning_efforts) || !model.capabilities.reasoning_efforts.includes(effort))) fail('ai_profile_incompatible','reasoning effort')
      const limit = config.max_output_tokens
      if (!finite(limit) || !Number.isInteger(limit) || limit < 1 || limit > model.max_output_tokens) fail('ai_profile_incompatible','output limit')
      const requirements = object(config.requirements) ? config.requirements : {}
      if (requirements.images && !model.supports_images || requirements.functions && model.capabilities.supports_functions !== true || requirements.json_schema && model.capabilities.supports_json_schema !== true) fail('ai_profile_incompatible','capability')
      const promptKeys = refs(body.prompt_keys,'ai_prompt_missing')
      if (!promptKeys.length) fail('ai_prompt_missing',key)
      const systemMessage = promptKeys.map(promptKey => session.text(promptKey,variables)).filter(Boolean).join('\n\n')
      if (!systemMessage.trim()) fail('ai_prompt_missing',key)
      if (body.contract_key) definition(String(body.contract_key),'agent_contract')
      for (const method of refs(body.method_keys)) definition(method)
      for (const tool of refs(body.tool_keys)) definition(tool,'tool_contract')
      const params = validateProviderParameters(config.provider_parameters ?? {},adapter)
      if (config.timeout_ms !== undefined && (!finite(config.timeout_ms) || config.timeout_ms <= 0)) fail('ai_profile_incompatible','timeout')
      return freeze({ app: options.app, manifestId: manifest().manifest_id, roleKey: row.prompt_key, roleVersionId: row.id, profileVersionId: profile.id, tierVersionId: binding.id,
        tier: tier as AiTier, model, providerAdapter: adapter, reasoningEffort: effort as string | null, maxOutputTokens: limit, timeoutMs: config.timeout_ms as number | undefined,
        providerParameters: params, systemMessage, definition: row, profile })
    },
    tool(key, parameters = {}) {
      const fullKey = manifest().definitions.some(d => d.prompt_key === key) ? key : 'tools.' + key
      const row = definition(fullKey,'tool_contract'), body = row.definition
      const functionBody = object(body.function) ? body.function : body
      if (!string(functionBody.name) || typeof functionBody.description !== 'string' || !object(functionBody.parameters)) fail('ai_contract_missing',fullKey)
      const additional = body.additional_description
      const description = parameters.include_manual === true && typeof additional === 'string' && additional ? functionBody.description + '\n\n' + additional : functionBody.description
      return { type: 'function', function: { name: functionBody.name, description, parameters: boundSchema(row,functionBody.parameters,toolParameters(row,parameters)), strict: functionBody.strict === true } }
    },
    schema(key, parameters = {}) {
      const fullKey = manifest().definitions.some(d => d.prompt_key === key) ? key : 'schema.' + key
      const row = definition(fullKey,'response_schema'), body = row.definition
      const schema = body.schema ?? body.output_schema ?? (body.type ? body : undefined)
      if (!object(schema)) fail('ai_contract_missing',fullKey)
      return { name: string(body.name) ? body.name : fullKey.replace(/^schema\./,''), description: typeof body.description === 'string' ? body.description : undefined, schema: boundSchema(row,schema,parameters), strict: body.strict !== false }
    },
  }
  return session
}
/** One seam for all catalog-backed text callers, including tests. Output
 * contracts replace local schemas; task-specific data goes through declared
 * binders. Dynamic system context remains the trusted app server's input. */
export function applyCatalogModelOptions<T extends { app: string; functionName: string; aiFunction?: string; systemMessage?: string; tools?: AiFunctionTool[]; timeoutMs?: number; catalogRoleKey?: string; catalogSchemaKey?: string; catalogVariables?: AiVariables; catalogSchemaParameters?: JsonObject; catalogToolParameters?: Record<string,JsonObject> }>(session: AiCatalogSession, options: T): T & { aiDefinition: ResolvedAiRole } {
  const role = session.role(options.catalogRoleKey ?? options.functionName,options.catalogVariables)
  const result: T & { aiDefinition: ResolvedAiRole } = { ...options, aiDefinition: role, systemMessage: options.systemMessage ?? role.systemMessage }
  if (role.timeoutMs !== undefined) result.timeoutMs = Math.min(options.timeoutMs ?? Infinity,role.timeoutMs)
  if (options.catalogSchemaKey) {
    const schema = session.schema(options.catalogSchemaKey,options.catalogSchemaParameters)
    Object.assign(result,{schemaName: schema.name,schemaDescription: schema.description,schema: schema.schema})
  }
  if (options.tools) result.tools = options.tools.map(tool => session.tool(tool.function.name,{...options.catalogSchemaParameters,...options.catalogToolParameters?.[tool.function.name]}))
  return result
}
/** Validate the actual call, too: capabilities must cover dynamically selected
 * tools/images/output schemas even when a profile forgot to require them. */
export function validateAiCall(role: ResolvedAiRole, input: { app: string; images?: boolean; tools?: boolean; schema?: boolean; imageOutput?: boolean }) {
  if (role.app !== input.app) fail('ai_profile_incompatible','app scope')
  if (input.imageOutput ? role.providerAdapter !== 'openai-images-v1' : role.providerAdapter !== 'openai-responses-v1') fail('ai_profile_incompatible','provider adapter')
  if (input.images && !role.model.supports_images || input.tools && role.model.capabilities.supports_functions !== true || input.schema && role.model.capabilities.supports_json_schema !== true || input.imageOutput && !role.model.supports_image_output) fail('ai_profile_incompatible','call capability')
}
