import type { SupabaseClient } from '@supabase/supabase-js'
import type { MediaAsset, MediaPage, MediaPurpose, MediaTarget, TaskDetail, TaskStep, TaskStatus, SkillLevel } from './types'

export const IMAGE_LIMIT = 6 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEMO_MESSAGE = 'This demo does not save images or instructions. Open a connected project to use this feature.'
type AssertCurrent = () => void
type Row = Record<string, any> // PostgREST's ungenerated schema boundary; mapped before reaching UI.

function value<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('The record is unavailable. Your access may have changed.')
  return result.data
}
function mapImage(row: Row): MediaAsset {
  return {
    id: row.id, projectId: row.project_id, bucket: row.bucket_id, path: row.object_path,
    title: row.title, originalName: row.original_name, purpose: row.purpose,
    contentType: row.content_type, byteSize: row.byte_size, width: row.width, height: row.height,
    state: row.state, createdAt: row.created_at,
    links: (row.media_links ?? []).map((l: Row) => ({
      id: l.id, kind: l.step_id ? 'step' : l.task_id ? 'task' : 'area',
      targetId: l.step_id ?? l.task_id ?? l.area_id,
    })),
  }
}
function mapStep(row: Row): TaskStep {
  return {
    id: row.id, taskId: row.task_id, title: row.title, instructions: row.instructions,
    position: row.position, isCheckpoint: row.is_checkpoint, required: row.required,
    completedAt: row.completed_at, revision: row.revision,
  }
}

/** Every call captures the project/auth generation; storage is never handed to UI. */
export function createProjectFiles(client: SupabaseClient<any, any, any> | null, capture: (projectId: string) => AssertCurrent, changed: () => void = () => {}) {
  function connection(projectId: string) {
    const assertCurrent = capture(projectId)
    assertCurrent()
    if (!client) throw new Error(DEMO_MESSAGE)
    return { db: client, assertCurrent }
  }
  async function command(projectId: string, action: string, mediaId: string, data: Row = {}) {
    const { db, assertCurrent } = connection(projectId)
    const result = value(await db.rpc('media_command', { p_project: projectId, p_action: action, p_media: mediaId, p_data: data }))
    assertCurrent()
    changed()
    return result as Row
  }
  async function getMedia(projectId: string, target: MediaTarget, offset = 0): Promise<MediaPage> {
    if (!client) return { items: [], hasMore: false }
    const { db, assertCurrent } = connection(projectId)
    if (target.kind === 'project' && target.id !== projectId) throw new Error('Project changed.')
    const relation = target.kind === 'project' ? '' : ',target:media_links!inner(area_id,task_id,step_id)'
    let query = db.from('media_assets').select('*,media_links(id,area_id,task_id,step_id)' + relation).eq('project_id', projectId)
    if (target.kind !== 'project') query = query.eq('target.' + target.kind + '_id', target.id)
    const rows = value(await query.order('created_at', { ascending: false }).order('id').range(offset, offset + 12)) as unknown as Row[]
    assertCurrent()
    if (rows.some(row => row.project_id !== projectId)) throw new Error('Image project mismatch.')
    return { items: rows.slice(0, 12).map(mapImage), hasMore: rows.length > 12 }
  }
  async function getImage(projectId: string, mediaId: string) {
    const { db, assertCurrent } = connection(projectId)
    const row = value(await db.from('media_assets').select('*,media_links(id,area_id,task_id,step_id)')
      .eq('project_id', projectId).eq('id', mediaId).single()) as Row
    assertCurrent()
    if (row.project_id !== projectId) throw new Error('Image project mismatch.')
    return mapImage(row)
  }
  return {
    getMedia,
    async uploadImage(projectId: string, target: MediaTarget, file: File, purpose: MediaPurpose, title: string): Promise<void> {
      const { db, assertCurrent } = connection(projectId)
      if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image. Export HEIC images as JPEG first.')
      if (!file.size || file.size > IMAGE_LIMIT) throw new Error('Choose an image smaller than 6 MiB.')
      if (!title.trim() || title.trim().length > 200) throw new Error('Give the image a title of up to 200 characters.')
      let bitmap: ImageBitmap
      try { bitmap = await createImageBitmap(file) } catch { throw new Error('This file could not be opened as an image. Choose another file.') }
      const { width, height } = bitmap
      bitmap.close()
      if (!width || !height || width > 20000 || height > 20000 || width * height > 48000000) throw new Error('Choose an image up to 48 megapixels.')
      assertCurrent()
      const id = crypto.randomUUID()
      const row = await command(projectId, 'reserve', id, {
        original_name: file.name.slice(0, 255), title: title.trim(), purpose, content_type: file.type,
        byte_size: file.size, width, height, target_kind: target.kind, target_id: target.id,
      })
      assertCurrent()
      const upload = await db.storage.from(row.bucket_id).upload(row.object_path, file, { contentType: file.type, upsert: false, cacheControl: '0' })
      assertCurrent()
      if (upload.error) throw new Error('Upload interrupted. The pending image is saved below; check it or remove it and choose the file again.')
      await command(projectId, 'finalize', id)
    },
    async downloadImage(projectId: string, mediaId: string): Promise<Blob> {
      const { db, assertCurrent } = connection(projectId)
      const image = await getImage(projectId, mediaId)
      if (image.state !== 'ready') throw new Error('This image is not ready to open.')
      const blob = value(await db.storage.from(image.bucket).download(image.path))
      assertCurrent()
      return blob
    },
    finalizeImage: (projectId: string, mediaId: string) => command(projectId, 'finalize', mediaId),
    async removeImage(projectId: string, mediaId: string): Promise<void> {
      const { db, assertCurrent } = connection(projectId)
      const row = await command(projectId, 'begin_delete', mediaId)
      const removed = await db.storage.from(row.bucket_id).remove([row.object_path])
      assertCurrent()
      if (removed.error) throw new Error('Image removal was interrupted. Retry removing it to finish.')
      await command(projectId, 'finish_delete', mediaId)
    },
    attachImage: (projectId: string, mediaId: string, target: MediaTarget) =>
      command(projectId, 'link', mediaId, { target_kind: target.kind, target_id: target.id }),
    unlinkImage: (projectId: string, mediaId: string, linkId: string) =>
      command(projectId, 'unlink', mediaId, { link_id: linkId }),
    async getTaskDetail(projectId: string, taskId: string): Promise<TaskDetail> {
      const { db, assertCurrent } = connection(projectId)
      const row = value(await db.from('tasks')
        .select('*,task_assignees(person_id),areas!inner(project_id)')
        .eq('id', taskId).eq('areas.project_id', projectId).single()) as Row
      const steps = value(await db.from('task_steps').select('*').eq('project_id', projectId).eq('task_id', taskId).order('position')) as Row[]
      assertCurrent()
      return {
        task: { id: row.id, areaId: row.area_id, name: row.name, skill: row.skill as SkillLevel,
          hours: row.hours, status: row.status as TaskStatus, materials: row.materials,
          assigneeIds: row.task_assignees.map((p: Row) => p.person_id) },
        instructions: row.instructions, updatedAt: row.updated_at, steps: steps.map(mapStep),
      }
    },
    async editTaskSteps(projectId: string, taskId: string, action: string, stepId: string | null, data: Row): Promise<void> {
      const { db, assertCurrent } = connection(projectId)
      value(await db.rpc('task_steps_command', { p_project: projectId, p_task: taskId, p_action: action, p_step: stepId, p_data: data }))
      assertCurrent()
    },
  }
}
