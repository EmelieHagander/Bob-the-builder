import { useEffect, useState, type ReactNode } from 'react'
import { ZoomableImage } from './ZoomableImage'
import { CadGuidePrint } from './CadGuidePrint'

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

function pageLabel(page: NonNullable<BuildGuideNotes['pages']>[number]): string {
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

/** Page images: from the drawing's files, or loaded from the page store when shown. */
function GuidePages({ pages, guide, files, title, loadPages }: { pages: GuidePage[]; guide: BuildGuideNotes; files: Record<string, string>; title: string; loadPages?: GuidePageLoader }) {
  const stored = guide.store === 'pages'
  const keys = pages.map(page => page.key).join(',')
  const [loaded, setLoaded] = useState<{ keys: string; pages: Record<string, string> } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!stored || !guide.guide_id || !loadPages) return
    let live = true
    setFailed(false)
    // At most 30 pages per read (the volunteer reader's bound).
    const all = keys.split(','), guideId = guide.guide_id
    const chunks = Array.from({ length: Math.ceil(all.length / 30) }, (_, i) => all.slice(i * 30, i * 30 + 30))
    Promise.all(chunks.map(chunk => loadPages(guideId, chunk))).then(reads => { if (live) setLoaded({ keys, pages: Object.assign({}, ...reads) }) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [stored, guide.guide_id, loadPages, keys])
  if (stored && !loadPages) return <p role="status" className="foundation-hint">These pages are not available here.</p>
  if (stored && failed) return <p role="alert" className="solution-attention">The guide pages could not be read. Reload to try again.</p>
  if (stored && loaded?.keys !== keys) return <p role="status" className="foundation-hint">Loading pages…</p>
  return <>{pages.map(page => {
    const label = pageLabel(page)
    const svg = stored ? loaded?.pages[page.key] : undefined, encoded = stored ? undefined : files[page.key]
    if (typeof svg !== 'string' && typeof encoded !== 'string') return <p key={page.key} role="alert" className="solution-attention">{label}: this page is missing from the saved version.</p>
    const src = typeof svg === 'string' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : `data:image/svg+xml;base64,${encoded}`
    return <figure key={page.key} className="cad-sheet">
      <figcaption><strong>{label}</strong> · <a download={`${page.key}.svg`} href={src}>download page</a></figcaption>
      <ZoomableImage src={src} alt={`${title} — build guide, ${label}`} label={label} fit="width" />
    </figure>
  })}</>
}

function GuideSection({ section, children }: { section: string; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details className="cad-build-guide-section" onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>{section}</summary>
    {open && children(open)}
  </details>
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
    {guideGroups(pages).map((group, index) => group.section === null
      ? <GuidePages key={'pages-' + index} pages={group.pages} guide={guide} files={files} title={title} loadPages={loadPages} />
      : <GuideSection key={'section-' + index} section={`${group.section} · ${group.pages.length} ${group.pages.length === 1 ? 'step' : 'steps'}`}>
        {() => <GuidePages pages={group.pages} guide={guide} files={files} title={title} loadPages={loadPages} />}
      </GuideSection>)}
  </details>
}
