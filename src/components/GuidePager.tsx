import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from './ui'

/** Paging is read-only. A checkbox is the explicit completion action. */
export function GuidePager({previous, next, label, children}: {previous?: string; next?: string; label: string; children: ReactNode}) {
  const {key, state} = useLocation()
  const counter = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (state?.guidePage === true) counter.current?.focus({preventScroll:true})
  }, [key,state])
  if (!previous && !next) return <div className="guide-counter" tabIndex={-1} ref={counter}>{children}</div>
  return <nav className="guide-pager" aria-label={label}>
    {previous ? <Link className="btn" to={previous} state={{guidePage:true}} aria-label="Previous" title="Previous"><Icon name="arrow-left" size={18} /></Link>
      : <span className="btn" aria-hidden="true"><Icon name="arrow-left" size={18} /></span>}
    <div className="guide-counter" tabIndex={-1} ref={counter}>{children}</div>
    {next ? <Link className="btn" to={next} state={{guidePage:true}} aria-label="Next">Next <Icon name="arrow-right" size={17} /></Link>
      : <span className="btn" aria-hidden="true"><Icon name="arrow-right" size={17} /></span>}
  </nav>
}
