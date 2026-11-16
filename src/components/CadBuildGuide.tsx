import { useEffect, useState } from 'react'
import { ZoomableImage } from './ZoomableImage'
import { CadGuidePrint } from './CadGuidePrint'
import { Icon } from './ui'

/** Build-guide notes saved with a drawing version (manifest.build_guide, 2026-10-30). */
export type BuildGuideNotes = {
  version: number; status: 'generated' | 'not_generated' | 'failed'; reason?: string
  /** 'pages': kept in their own store under guide_id (2026-11-09), read on demand. */
  store?: 'pages'; guide_id?: string
  construction?: { artifact_id: string; revision: number }
  fasteners?: { rule_version: string; complete: boolean } | null
  pages?: { key: string; kind: string; step?: number; repeat?: number; section?: string }[]
}

const NOT_MADE: Record<string, string> = {
  no_assembly_order: 'Bob did not propose a build order, so no build guide was made with this drawing version.',
  no_joints: 'This construction has no saved joints, so no build guide was made with this drawing version.',
}

export function pageLabel(page: NonNullable<BuildGuideNotes['pages']>[number]): string {
  if (page.kind === 'parts') return 'What is in the box'
  if (page.kind === 'done') return 'Done'
  return `Step ${page.step ?? ''}${page.repeat && page.repeat > 1 ? ` (build ${page.repeat}×)` : ''}`.trim()
}

/** Reads stored pages (SVG text by key); absent keys are missing pages. */
export type GuidePageLoader = (guideId: string, keys: string[]) => Promise<Record<string, string>>
type GuidePage = NonNullable<BuildGuideNotes['pages']>[number]

/** Guides from 2026-11-09 come in Bob's titled sections: each is its own expand. */
export function guideGroups(pages: GuidePage[]) {
  const groups: { section: string | null; pages: GuidePage[] }[] = []
  for (const page of pages) {
    const section = page.kind === 'step' ? page.section ?? null : null
    const last = groups.at(-1)
    if (last && last.section === section) last.pages.push(page)
    else groups.push({ section, pages: [page] })
  }
  return groups
}

/** The whole guide as one document you flip through (owner ask 2026-11-15):
 * every page is read together when the guide opens, one page shows at a time,
 * Previous/Next (or the arrow keys) turn the page and a section menu jumps. */
export function GuideViewer({ pages, guide, files, title, loadPages, progress }: { pages: GuidePage[]; guide: BuildGuideNotes; files: Record<string, string>; title: string; loadPages?: GuidePageLoader
  /** Build mode (2026-11-15): pages are ticked off as the crew builds; the guide opens at the first page not done. */
  progress?: { done: ReadonlySet<string>; onToggle: (key: string, on: boolean) => void } }) {
  const stored = guide.store === 'pages'
  const keys = pages.map(page => page.key).join(',')
  const [loaded, setLoaded] = useState<{ keys: string; pages: Record<string, string> } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [index, setIndex] = useState(() => {
    const first = progress ? pages.findIndex(page => !progress.done.has(page.key)) : 0
    return first < 0 ? pages.length - 1 : first
  })
  useEffect(() => {
    if (!stored || !guide.guide_id || !loadPages) return
    let live = true
    setFailed(false)
    // At most 30 pages per read (the volunteer reader's bound), all reads together.
    const all = keys.split(','), guideId = guide.guide_id
    const chunks = Array.from({ length: Math.ceil(all.length / 30) }, (_, i) => all.slice(i * 30, i * 30 + 30))
    Promise.all(chunks.map(chunk => loadPages(guideId, chunk))).then(reads => { if (live) setLoaded({ keys, pages: Object.assign({}, ...reads) }) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [stored, guide.guide_id, loadPages, keys, attempt])
  if (stored && !loadPages) return <p role="status" className="foundation-hint">These pages are not available here.</p>
  if (stored && failed) return <div role="alert" className="solution-attention"><p>The guide pages could not be read.</p>
    <button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
  if (stored && loaded?.keys !== keys) return <p role="status" className="foundation-hint">Loading {pages.length} pages…</p>
  const at = Math.min(index, pages.length - 1), page = pages[at], label = pageLabel(page)
  const sections = guideGroups(pages).reduce<{ title: string; first: number }[]>((list, group, n, groups) => {
    const first = groups.slice(0, n).reduce((sum, g) => sum + g.pages.length, 0)
    return [...list, { title: group.section ?? (n === 0 ? 'What is in the box' : group.pages[0].kind === 'done' ? 'Done' : 'Steps'), first }]
  }, [])
  const svg = stored ? loaded?.pages[page.key] : undefined, encoded = stored ? undefined : files[page.key]
  const src = typeof svg === 'string' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : typeof encoded === 'string' ? `data:image/svg+xml;base64,${encoded}` : null
  const go = (next: number) => setIndex(Math.max(0, Math.min(pages.length - 1, next)))
  return <div className="cad-guide-viewer" role="group" aria-label={`${title} build guide pages`}
    onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); go(at + 1) } else if (event.key === 'ArrowLeft') { event.preventDefault(); go(at - 1) } }}>
    <div className="foundation-actions cad-guide-nav">
      <button type="button" className="btn" onClick={() => go(at - 1)} disabled={at === 0}>Previous</button>
      <span aria-live="polite">Page {at + 1} of {pages.length}</span>
      <button type="button" className="btn" onClick={() => go(at + 1)} disabled={at === pages.length - 1}>Next</button>
    </div>
    {sections.length > 1 && <label className="cad-guide-jump"><span>Go to</span>
      <select aria-label="Go to section" value={sections.filter(sec => sec.first <= at).at(-1)?.first ?? 0} onChange={event => go(Number(event.target.value))}>
        {sections.map(sec => <option key={sec.first} value={sec.first}>{sec.title}</option>)}
      </select></label>}
    {progress && (progress.done.has(page.key)
      ? <button type="button" className="btn cad-guide-done" aria-pressed="true" onClick={() => progress.onToggle(page.key, false)}><Icon name="check" size={18} /> Done</button>
      : <button type="button" className="btn btn-primary cad-guide-done" onClick={() => { progress.onToggle(page.key, true); go(at + 1) }}>
        <Icon name="check" size={18} /> {at === pages.length - 1 ? 'Done' : 'Done, next page'}</button>)}
    <figure className="cad-sheet">
      <figcaption><strong>{page.section ? `${page.section} · ` : ''}{label}</strong>{src && <> · <a download={`${page.key}.svg`} href={src}>download page</a></>}</figcaption>
      {src ? <ZoomableImage key={page.key} src={src} alt={`${title} — build guide, ${label}`} label={label} fit="contain" />
        : <p role="alert" className="solution-attention">{label}: this page is missing from the saved version.</p>}
    </figure>
  </div>
}

/** IKEA-style pages made with the drawing, in order. Absent notes mean the
 * guide was switched off when this version was made: nothing is shown. */
export function CadBuildGuide({ guide, files, title, sourceChanged, loadPages, projectId }: {
  guide: BuildGuideNotes | null | undefined; files: Record<string, string>; title: string; sourceChanged?: boolean; loadPages?: GuidePageLoader
  /** Members only: the print adds the pinned construction's shopping and cut lists. */
  projectId?: string
}) {
  if (!guide || typeof guide !== 'object') return null
  if (guide.status !== 'generated') {
    const text = guide.status === 'failed'
      ? 'The build guide could not be made for this version. The drawing itself is complete.'
      : NOT_MADE[guide.reason ?? ''] ?? 'No build guide was made with this drawing version.'
    return <section className="cad-build-guide" aria-label={`${title} build guide`}><h3>Build guide</h3><p className="foundation-hint">{text}</p></section>
  }
  const pages = Array.isArray(guide.pages) ? guide.pages : []
  return <details className="cad-build-guide" open>
    <summary>Build guide · {pages.length} {pages.length === 1 ? 'page' : 'pages'}</summary>
    <p className="foundation-hint">Step-by-step pages from the saved construction and Bob's proposed order. Not reviewed; fastener counts are rule-of-thumb proposals, not a strength check.</p>
    {sourceChanged && <p role="alert" className="solution-attention">The construction has changed since this guide was made. It still shows its recorded version.</p>}
    {pages.length > 0 && <CadGuidePrint guide={guide} files={files} title={title} pageLabel={pageLabel} loadPages={loadPages} projectId={projectId} />}
    {pages.length > 0 && <GuideViewer pages={pages} guide={guide} files={files} title={title} loadPages={loadPages} />}
  </details>
}
