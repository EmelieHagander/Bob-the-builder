import * as db from '../data/database'
import type { Material } from '../data/types'
import type { StockGroup } from '../domain/stockCount'

/** Boards and sheets are counted from a construction; a ticked one becomes a real
 * shopping row (one shared truth), found again by its material name. */
export const STOCK_CATEGORY = 'Boards and sheets'

export const stockRowFor = (materials: Material[], group: StockGroup) =>
  materials.find(m => m.category === STOCK_CATEGORY && m.name === group.name)

/** Ticks or unticks a board/sheet row; `qty` is the count the list shows now. */
export async function tickStock(materials: Material[], group: StockGroup, qty: string, next: boolean) {
  const linked = stockRowFor(materials, group)
  if (!linked) {
    if (next) await db.createMaterial({ name: group.name, qty, area: '', supplier: '', cost: '', category: STOCK_CATEGORY, status: 'delivered' })
    return
  }
  if (next && linked.qty !== qty) await db.updateMaterial(linked.id, { name: linked.name, qty, area: linked.area, supplier: linked.supplier, cost: linked.cost, category: linked.category })
  await db.setMaterialStatus(linked.id, next ? 'delivered' : 'needed')
}
