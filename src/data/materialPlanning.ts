import type { SupabaseClient } from '@supabase/supabase-js'

export type QuantityUnit = 'pcs' | 'm' | 'm2' | 'm3' | 'kg' | 'l'
export type StockStatus = 'available' | 'inspect' | 'unavailable'
export type RequirementSourceKind = 'manual' | 'deterministic'

export interface StockItem {
  id: string
  projectId: string
  revision: number
  name: string
  specification: string
  quantity: string
  unit: QuantityUnit
  status: StockStatus
  areaId: string | null
  areaTitle: string
  notes: string
  archived: boolean
  reason: string
  actor: string
  recordedAt: string
}

export interface RequirementStockAllocation {
  id: string
  revision: number
  quantity: string
  name: string
  specification: string
  unit: QuantityUnit
  status: StockStatus
  areaTitle: string
  latestRevision: number
  currentQuantity: string
  currentStatus: StockStatus
  archived: boolean
}

export interface RequirementComponentAllocation {
  id: string
  revision: number
  quantity: number
  name: string
  kind: string
  specification: string
  intent: string
  latestRevision: number
  currentQuantity: number | null
  currentIntent: string
  archived: boolean
}

export interface MaterialRequirement {
  id: string
  projectId: string
  revision: number
  name: string
  category: string
  areaId: string | null
  areaTitle: string
  taskId: string | null
  taskTitle: string
  unit: QuantityUnit
  requiredQuantity: string
  wastePercent: string
  purchaseIncrement: string
  requiredWithWaste: string
  stockQuantity: string
  componentQuantity: string
  purchaseQuantity: string
  sourceKind: RequirementSourceKind
  methodKey: string
  methodVersion: string
  basis: string
  assumptions: string
  artifactId: string | null
  artifactRevision: number | null
  artifactTitle: string
  targetRevision: number
  solutionId: string
  solutionRevision: number
  solutionTitle: string
  archived: boolean
  reason: string
  actor: string
  recordedAt: string
  targetChanged: boolean
  artifactChanged: boolean
  stockChanged: boolean
  componentChanged: boolean
}

export interface MaterialRequirementVersion extends MaterialRequirement {
  stock: RequirementStockAllocation[]
  components: RequirementComponentAllocation[]
}

export interface RequirementShoppingState {
  projectId: string
  requirementId: string
  materialId: string | null
  syncedRevision: number
  currentRevision: number
  materialMissing: boolean
  sourceOutdated: boolean
  shoppingEdited: boolean
  sourceStale: boolean
}

type Row = Record<string, any>

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

const textNumber = (value: unknown) => value === null || value === undefined ? '0' : String(value)

function stockItem(row: Row): StockItem {
  return {
    id: row.stock_id ?? row.id,
    projectId: row.project_id,
    revision: row.revision,
    name: row.name,
    specification: row.specification ?? '',
    quantity: textNumber(row.quantity),
    unit: row.unit,
    status: row.status,
    areaId: row.area_id ?? null,
    areaTitle: row.area_title ?? '',
    notes: row.notes ?? '',
    archived: Boolean(row.archived),
    reason: row.change_note,
    actor: row.actor_label,
    recordedAt: row.recorded_at,
  }
}

function requirement(row: Row): MaterialRequirement {
  return {
    id: row.requirement_id ?? row.id,
    projectId: row.project_id,
    revision: row.revision,
    name: row.name,
    category: row.category,
    areaId: row.area_id ?? null,
    areaTitle: row.area_title ?? '',
    taskId: row.task_id ?? null,
    taskTitle: row.task_title ?? '',
    unit: row.unit,
    requiredQuantity: textNumber(row.required_quantity),
    wastePercent: textNumber(row.waste_percent),
    purchaseIncrement: textNumber(row.purchase_increment),
    requiredWithWaste: textNumber(row.required_with_waste),
    stockQuantity: textNumber(row.stock_quantity),
    componentQuantity: textNumber(row.component_quantity),
    purchaseQuantity: textNumber(row.purchase_quantity),
    sourceKind: row.source_kind,
    methodKey: row.method_key,
    methodVersion: row.method_version,
    basis: row.basis,
    assumptions: row.assumptions ?? '',
    artifactId: row.artifact_id ?? null,
    artifactRevision: row.artifact_revision ?? null,
    artifactTitle: row.artifact_title ?? '',
    targetRevision: row.target_revision,
    solutionId: row.solution_id,
    solutionRevision: row.solution_revision,
    solutionTitle: row.solution_title,
    archived: Boolean(row.archived),
    reason: row.change_note,
    actor: row.actor_label,
    recordedAt: row.recorded_at,
    targetChanged: Boolean(row.target_changed),
    artifactChanged: Boolean(row.artifact_changed),
    stockChanged: Boolean(row.stock_changed),
    componentChanged: Boolean(row.component_changed),
  }
}

export function createMaterialPlanning(
  client: SupabaseClient<any, any, any> | null,
  capture: (id: string) => () => void,
) {
  function connection(projectId: string) {
    const guard = capture(projectId)
    guard()
    if (!client) throw new Error('This demo does not save material planning. Open a connected project.')
    return { db: client, guard }
  }

  function scoped<T extends Row>(rows: T[], projectId: string): T[] {
    if (rows.some(row => row.project_id !== projectId)) throw new Error('Material planning project mismatch.')
    return rows
  }

  async function stockVersion(projectId: string, id: string, revision: number): Promise<StockItem> {
    const { db, guard } = connection(projectId)
    const row = checked(await db.from('stock_revisions').select('*')
      .eq('project_id', projectId).eq('stock_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!row) throw new Error('Stock version unavailable. Reload to check access.')
    scoped([row], projectId)
    return stockItem(row)
  }

  async function requirementVersion(projectId: string, id: string, revision: number): Promise<MaterialRequirementVersion> {
    const { db, guard } = connection(projectId)
    const row = checked(await db.from('material_requirement_revisions').select('*')
      .eq('project_id', projectId).eq('requirement_id', id).eq('revision', revision).single()) as Row
    guard()
    if (!row) throw new Error('Material requirement version unavailable. Reload to check access.')
    scoped([row], projectId)
    const [stockRows, componentRows] = await Promise.all([
      db.from('material_requirement_stock_details').select('*')
        .eq('project_id', projectId).eq('requirement_id', id).eq('requirement_revision', revision)
        .order('stock_id'),
      db.from('material_requirement_component_details').select('*')
        .eq('project_id', projectId).eq('requirement_id', id).eq('requirement_revision', revision)
        .order('component_id'),
    ])
    const stock = checked(stockRows) as Row[]
    const components = checked(componentRows) as Row[]
    guard()
    return {
      ...requirement(row),
      stock: scoped(stock, projectId).map(item => ({
        id: item.stock_id,
        revision: item.stock_revision,
        quantity: textNumber(item.quantity),
        name: item.name,
        specification: item.specification ?? '',
        unit: item.unit,
        status: item.status,
        areaTitle: item.area_title ?? '',
        latestRevision: item.latest_revision,
        currentQuantity: textNumber(item.current_quantity),
        currentStatus: item.current_status,
        archived: Boolean(item.currently_archived),
      })),
      components: scoped(components, projectId).map(item => ({
        id: item.component_id,
        revision: item.component_revision,
        quantity: Number(item.quantity),
        name: item.name,
        kind: item.kind,
        specification: item.specification ?? '',
        intent: item.intent,
        latestRevision: item.latest_revision,
        currentQuantity: item.current_quantity === null ? null : Number(item.current_quantity),
        currentIntent: item.current_intent,
        archived: Boolean(item.currently_archived),
      })),
    }
  }

  return {
    stockVersion,
    requirementVersion,
    async stock(projectId: string, archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('current_stock_items').select('*')
        .eq('project_id', projectId).eq('archived', archived)
        .order('recorded_at', { ascending: false }).order('id')
        .range(offset, offset + 24)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 24), projectId).map(stockItem), hasMore: rows.length > 24 }
    },
    async stockHistory(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('stock_revisions').select('*')
        .eq('project_id', projectId).eq('stock_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId).map(stockItem), hasMore: rows.length > 12 }
    },
    async editStock(
      projectId: string,
      action: 'create' | 'revise' | 'archive' | 'restore',
      id: string,
      expected: number,
      data: Record<string, unknown> = {},
    ) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('stock_command', {
        p_project: projectId,
        p_action: action,
        p_stock: id,
        p_expected: expected,
        p_data: data,
      })) as Row
      guard()
      return stockVersion(projectId, id, saved.revision)
    },
    async requirements(projectId: string, areaId = '', archived = false, offset = 0) {
      const { db, guard } = connection(projectId)
      let query = db.from('current_material_requirements').select('*')
        .eq('project_id', projectId).eq('archived', archived)
      if (areaId) query = query.eq('area_id', areaId)
      const rows = checked(await query.order('recorded_at', { ascending: false }).order('id')
        .range(offset, offset + 24)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 24), projectId).map(requirement), hasMore: rows.length > 24 }
    },
    async requirementHistory(projectId: string, id: string, offset = 0) {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('material_requirement_revisions').select('*')
        .eq('project_id', projectId).eq('requirement_id', id)
        .order('revision', { ascending: false }).range(offset, offset + 12)) as Row[]
      guard()
      return { items: scoped(rows.slice(0, 12), projectId).map(requirement), hasMore: rows.length > 12 }
    },
    async editRequirement(
      projectId: string,
      action: 'create' | 'revise' | 'archive' | 'restore',
      id: string,
      expected: number,
      data: Record<string, unknown> = {},
    ) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('material_requirement_command', {
        p_project: projectId,
        p_action: action,
        p_requirement: id,
        p_expected: expected,
        p_data: data,
      })) as Row
      guard()
      return requirementVersion(projectId, id, saved.revision)
    },
    async editDeterministicRequirement(
      projectId: string,
      action: 'create' | 'revise',
      id: string,
      expected: number,
      data: Record<string, unknown> = {},
    ) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('material_requirement_geometry_command', {
        p_project: projectId, p_action: action, p_requirement: id, p_expected: expected, p_data: data,
      })) as Row
      guard()
      return requirementVersion(projectId, id, saved.revision)
    },
    async publish(projectId: string, id: string, expected: number) {
      const { db, guard } = connection(projectId)
      const saved = checked(await db.rpc('material_requirement_command', {
        p_project: projectId,
        p_action: 'publish',
        p_requirement: id,
        p_expected: expected,
        p_data: {},
      })) as Row
      guard()
      return { materialId: saved.material_id as string, revision: saved.revision as number }
    },
    async shopping(projectId: string): Promise<RequirementShoppingState[]> {
      const { db, guard } = connection(projectId)
      const rows = checked(await db.from('material_requirement_shopping_state').select('*')
        .eq('project_id', projectId).order('requirement_id')) as Row[]
      guard()
      return scoped(rows, projectId).map(row => ({
        projectId: row.project_id,
        requirementId: row.requirement_id,
        materialId: row.material_id ?? null,
        syncedRevision: row.synced_requirement_revision,
        currentRevision: row.current_revision,
        materialMissing: Boolean(row.material_missing),
        sourceOutdated: Boolean(row.source_outdated),
        shoppingEdited: Boolean(row.shopping_edited),
        sourceStale: Boolean(row.source_stale),
      }))
    },
  }
}
