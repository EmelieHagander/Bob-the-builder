/** Chat carries immutable project image identities, never bytes or storage URLs. */
export const BOB_IMAGE_LIMIT = 4
export const BOB_IMAGE_BYTES_LIMIT = 16 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseBobImageIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > BOB_IMAGE_LIMIT || value.some(id => typeof id !== 'string' || !uuid.test(id))) throw new Error('invalid_images')
  const ids = value.map(id => id.toLowerCase())
  if (new Set(ids).size !== ids.length) throw new Error('invalid_images')
  return ids
}
