import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
/** Decorative identity; private originals use the existing authorised download seam. */
export function ProjectThumbnail({ projectId, mediaId }: { projectId?: string; mediaId?: string | null }) {
  const container = useRef<HTMLSpanElement>(null)
  const key = `${projectId ?? ''}:${mediaId ?? ''}`
  const [loaded, setLoaded] = useState({ key: '', url: '' })
  const url = loaded.key === key ? loaded.url : ''
  useEffect(() => {
    let active = true, objectUrl = ''
    setLoaded({ key, url: '' })
    const download = () => {
      if (!projectId || !mediaId) return
      void db.downloadOverviewImage(projectId, mediaId).then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob); setLoaded({ key, url: objectUrl })
      }).catch(() => { /* A missing/revoked image falls back without blocking project access. */ })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); download() }
    }, { rootMargin: '120px' })
    if (observer && container.current) observer.observe(container.current)
    else download()
    return () => { active = false; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [projectId, mediaId, key])
  return <span ref={container} className="ui-thumbnail" aria-hidden="true"><img src={url || import.meta.env.BASE_URL + 'images/building-illustration.jpg'} alt="" onError={() => { if (url) setLoaded({ key, url: '' }) }} /></span>
}
