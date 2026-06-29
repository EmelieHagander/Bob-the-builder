import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'

export function NotFound() {
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12, paddingTop: 80 }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="tree-evergreen" weight="fill" size={34} color="var(--accent)" />
      </div>
      <h1 className="page-title">Lost in the woods</h1>
      <p className="page-sub" style={{ maxWidth: 360 }}>That page isn't part of the build. Let's get you back to the dashboard.</p>
      <Link to="/" className="btn btn-primary"><Icon name="house" weight="fill" size={15} /> Back to dashboard</Link>
    </div>
  )
}
