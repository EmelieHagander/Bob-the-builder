import { ZoomableImage } from './ZoomableImage'

/** Build-guide notes saved with a drawing version (manifest.build_guide, 2026-10-30). */
export type BuildGuideNotes = {
  version: number; status: 'generated' | 'not_generated' | 'failed'; reason?: string
  construction?: { artifact_id: string; revision: number }
  fasteners?: { rule_version: string; complete: boolean } | null
  pages?: { key: string; kind: string; step?: number; repeat?: number }[]
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

/** IKEA-style pages made with the drawing, in order. Absent notes mean the
 * guide was switched off when this version was made: nothing is shown. */
export function CadBuildGuide({ guide, files, title, sourceChanged }: {
  guide: BuildGuideNotes | null | undefined; files: Record<string, string>; title: string; sourceChanged?: boolean
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
    {pages.map(page => {
      const label = pageLabel(page), encoded = files[page.key]
      if (typeof encoded !== 'string') return <p key={page.key} role="alert" className="solution-attention">{label}: this page is missing from the saved version.</p>
      const src = `data:image/svg+xml;base64,${encoded}`
      return <figure key={page.key} className="cad-sheet">
        <figcaption><strong>{label}</strong> · <a download={`${page.key}.svg`} href={src}>download page</a></figcaption>
        <ZoomableImage src={src} alt={`${title} — build guide, ${label}`} label={label} fit="width" />
      </figure>
    })}
  </details>
}
