import { Link, useLocation } from 'react-router-dom'
import { Icon } from './ui'
/** Shared workspace doors remain visible throughout project tools and collaboration. */
export function ProjectWorkspaceNav() {
  const { pathname, search } = useLocation()
  const area = new URLSearchParams(search).get('area')
  const scope = area ? `?area=${encodeURIComponent(area)}` : ''
  const reference = ['/facts', '/solutions', '/artifacts', '/material-plan', '/building'].some(route => pathname.startsWith(route))
  const together = ['/people', '/events', '/food', '/shopping', '/announcements'].some(route => pathname.startsWith(route))
  return <><nav className="project-workbench-nav" aria-label="Project workspace">
    <Link to="/project" aria-current={!reference && !together ? 'page' : undefined}><Icon name="list-checks" size={17} />Plan</Link>
    <Link to={'/facts'+scope} aria-current={reference ? 'page' : undefined}><Icon name="ruler" size={17} />Reference</Link>
    <Link to="/people" aria-current={together ? 'page' : undefined}><Icon name="users-three" size={17} />Together</Link>
  </nav>
    {reference && <nav className="reference-tools" aria-label="Reference tools">
      {[['/facts','Measurements & parts'],['/artifacts','Drawings'],['/material-plan','Material plan'],['/solutions','Solutions & target']].map(([path,label]) =>
        <Link key={path} to={path+scope} aria-current={pathname === path ? 'page' : undefined}>{label}</Link>)}
    </nav>}
  </>
}
