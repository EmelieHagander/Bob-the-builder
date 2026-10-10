import type { ProjectContext } from './dispatcher.ts'

/** Attachments must be prepared before the first model call, without depending
 * on Bob discovering an image title or deciding to issue an opening tool call. */
export async function prepareChatImages(context: ProjectContext, imageIds: string[]) {
  if (!imageIds.length) return
  const opened = await context.execute('open_project_item', { refs: imageIds.map(id => 'image:' + id) })
  if (opened.status !== 'ok' || !('items' in opened) || !Array.isArray(opened.items) || opened.items.length !== imageIds.length
    || opened.items.some(item => item.status !== 'prepared')) throw new Error('image_unavailable')
}
