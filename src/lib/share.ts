/** Getting an image or a list out of bob and into a chat, mail or note.
 * Uses the phone's own share sheet when the browser offers one; otherwise the
 * image is saved as a file and text is copied. Drawings are SVG, which most
 * chat apps refuse, so they are shared as PNG. */

export type ShareOutcome = 'shared' | 'saved' | 'copied' | 'cancelled' | 'failed'

const safeName = (name: string) => name.trim().replace(/[^\p{L}\p{N}._ -]+/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'bob'

/** Longest side of a shared drawing: readable when zoomed on a phone, small enough for chat apps. */
const RASTER_MAX = 2400
const RASTER_FALLBACK = 1600

async function svgToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('image')); image.src = url })
    const w = image.naturalWidth || RASTER_FALLBACK, h = image.naturalHeight || Math.round(RASTER_FALLBACK * 0.7)
    const scale = Math.min(4, RASTER_MAX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(png => png ? resolve(png) : reject(new Error('png')), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** The image as a file chat apps accept: SVG becomes PNG, photos keep their format. */
export async function shareableImageFile(src: string, name: string): Promise<File> {
  const response = await fetch(src)
  if (!response.ok) throw new Error('fetch')
  let blob = await response.blob()
  if (blob.type.includes('svg') || src.startsWith('data:image/svg')) blob = await svgToPng(new Blob([blob], { type: 'image/svg+xml' }))
  const type = EXTENSIONS[blob.type] ? blob.type : 'image/png'
  return new File([blob], `${safeName(name)}.${EXTENSIONS[type]}`, { type })
}

function save(file: Blob, filename: string) {
  const url = URL.createObjectURL(file), a = document.createElement('a')
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

export async function shareImage(src: string, name: string): Promise<ShareOutcome> {
  let file: File
  try { file = await shareableImageFile(src, name) } catch { return 'failed' }
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared' } catch (error) { if (isAbort(error)) return 'cancelled' }
  }
  try { save(file, file.name); return 'saved' } catch { return 'failed' }
}

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text }); return 'shared' } catch (error) { if (isAbort(error)) return 'cancelled' }
  }
  try { await navigator.clipboard.writeText(text); return 'copied' } catch { /* fall through to a file */ }
  try { save(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeName(title)}.txt`); return 'saved' } catch { return 'failed' }
}

export type ListSection = { heading: string; items: { name: string; detail?: string; done: boolean }[] }

/** A plain-text list that reads well in any chat: still-needed items first in each section, ticked ones marked. */
export function listText(title: string, sections: ListSection[]): string {
  const lines = [title]
  for (const section of sections) {
    if (!section.items.length) continue
    const ordered = [...section.items.filter(item => !item.done), ...section.items.filter(item => item.done)]
    lines.push('', section.heading.toUpperCase())
    for (const item of ordered) lines.push(`${item.done ? '✓' : '☐'} ${item.name}${item.detail ? ` – ${item.detail}` : ''}`)
  }
  return lines.join('\n')
}
