import { Link, useLocation } from 'react-router-dom'
import { Icon } from './ui'
/** Shared workspace doors remain visible throughout project tools and collaboration. */
export function ProjectWorkspaceNav() {
  const { pathname } = useLocation()
  const reference = ['/facts', '/solutions', '/artifacts', '/material-plan', '/building'].some(route => pathname.startsWith(route))
  const together = ['/people', '/events', '/food', '/shopping', '/announcements'].some(route => pathname.startsWith(route))
  return <nav className="project-workbench-nav" aria-label="Project workspace">
    <Link to="/project" aria-current={!reference && !together ? 'page' : undefined}><Icon name="list-checks" size={17} />Plan</Link>
    <Link to="/facts" aria-current={reference ? 'page' : undefined}><Icon name="ruler" size={17} />Reference</Link>
    <Link to="/people" aria-current={together ? 'page' : undefined}><Icon name="users-three" size={17} />Together</Link>
  </nav>
}
