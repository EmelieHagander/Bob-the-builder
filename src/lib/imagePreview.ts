import { createSharedRead } from './sharedRead'

/** Bounded, memory-only decoded previews. Callers reauthorize before every hit. */
export function createImagePreviewCache(maxBytes = 8 * 1024 * 1024, maxEntries = 24, ttlMs = 15 * 60_000) {
  const entries = new Map<string, { blob: Blob; expires: number }>()
  const reads = createSharedRead()
  let bytes = 0, epoch = 0
  function remove(key: string) {
    const value = entries.get(key)
    if (value) { bytes -= value.blob.size; entries.delete(key) }
  }
  return {
    clear() { epoch++; entries.clear(); bytes = 0; reads.clear() },
    async read(key: string, load: () => Promise<Blob>): Promise<Blob> {
      const hit = entries.get(key)
      if (hit && hit.expires > Date.now()) {
        entries.delete(key); entries.set(key, hit)
        return hit.blob
      }
      remove(key)
      const captured = epoch
      return reads.run(key, async () => {
        const blob = await load()
        if (captured !== epoch) throw new Error('Image context changed. Try loading it again.')
        if (blob.size <= maxBytes) {
          while (entries.size && (bytes + blob.size > maxBytes || entries.size >= maxEntries)) remove(entries.keys().next().value!)
          entries.set(key, { blob, expires: Date.now() + ttlMs }); bytes += blob.size
        }
        return blob
      })
    },
  }
}

/** Storage's hosted transformations need a paid plan. Keep the private original
 * unchanged, downsample once locally and retain only the small preview in RAM.
 * The first visible preview still downloads its original; repeat views do not. */
export async function imagePreview(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not display the image preview.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Could not display the image preview.')), 'image/webp', 0.8))
  } finally { bitmap.close() }
}
