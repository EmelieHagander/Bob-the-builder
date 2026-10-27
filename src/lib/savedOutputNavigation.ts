const uuid = (value: string | null): value is string => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const revision = (value: string | null) => value && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : null

/** URL pointers select an exact saved version; the data owner still enforces project access. */
export function savedOutputPointer(params: URLSearchParams, key: 'requirement' | 'cut_plan') {
  const id = params.get(key), rev = revision(params.get('revision'))
  return uuid(id) && rev ? { id, revision: rev } : null
}

export function savedOutputUrl(kind: 'requirements' | 'cut_plans', id: string, rev: number,
  source: { id: string; revision: number; areaId?: string | null }) {
  const params = new URLSearchParams({ [kind === 'requirements' ? 'requirement' : 'cut_plan']: id, revision: String(rev) })
  if (source.areaId) params.set('area', source.areaId)
  params.set('construction', source.id)
  params.set('source_revision', String(source.revision))
  return (kind === 'requirements' ? '/material-plan?' : '/build-lists?') + params
}

export function savedOutputSourcePointer(params: URLSearchParams) {
  const id = params.get('construction'), rev = revision(params.get('source_revision'))
  return uuid(id) && rev ? { id, revision: rev } : null
}
