/** Discover saved outputs of one exact Construction without copying geometry,
 * quantities or delivery state into a second register. Reopen the returned
 * records through their existing owners before claiming complete delivery. */
export const CONSTRUCTION_DELIVERY_TOOL = { type: 'function' as const, function: {
 name: 'read_construction_delivery',
 description: 'Find saved drawings, material requirements or cutting plans belonging to one exact Construction revision, including its saved description. Follow next_after for each resource. Returns the latest matching revision of each output identity, which may be historical; current_revision and archived show that distinction. This is an index, not proof that every promised output exists or has been opened. Reopen drawing/CAD sections with read_project_record_section and needs/cut plans with read_project_work; compare returned revisions and source states. Reuse saved geometry and repair missing Step links with link_project_drawing. Preliminary blank/fastener needs, hypothetical cutting plans and positive model feedback never establish fabrication or purchase approval.',
 parameters: { type: 'object', additionalProperties: false, properties: {
  artifact_id: { type: 'string', format: 'uuid' },
  revision: { type: 'integer', minimum: 1, maximum: 999999999 },
  resource: { type: 'string', enum: ['drawings', 'requirements', 'cut_plans'] },
  after: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
 }, required: ['artifact_id', 'revision', 'resource', 'after'] },
} }

export type ConstructionDeliveryResource = 'drawings' | 'requirements' | 'cut_plans'

/** Fail closed on wrong project/source/resource and incomplete page envelopes.
 * The caller's authorization is also checked before and after the RPC. */
export function validConstructionDelivery(value: any, projectId: string, artifactId: string, revision: number, resource: string): boolean {
 return value?.status === 'ok' && value.projectId === projectId && value.artifact_id === artifactId
  && value.revision === revision && value.resource === resource && value.index_only === true
  && Array.isArray(value.records) && value.records.length <= 12
  && typeof value.truncated === 'boolean' && (value.truncated ? typeof value.next_after === 'string' : value.next_after === null)
  && value.records.every((r: any) => typeof r?.id === 'string' && Number.isSafeInteger(r.revision) && r.revision > 0
   && r.source?.artifact_id === artifactId && r.source.revision === revision)
  && JSON.stringify(value).length <= 100000
}
