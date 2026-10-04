import { useBobSurface } from '../lib/bobSurface'
import type { ComponentProps } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BuildingContextSurface } from '../components/BuildingContextSurface'
import { Icon } from '../components/ui'

type SurfaceProps = ComponentProps<typeof BuildingContextSurface>

export function BuildingContext(props: SurfaceProps) {
  useBobSurface(props.projectId, { surface: 'building' }, 'Building & spaces')
  const [params] = useSearchParams()
  const building = params.get('building') ?? undefined
  return <div className="page building-context-page">
    <Link className="btn" to={props.projectId ? '/' : '/account'}><Icon name="arrow-left" size={15} /> {props.projectId ? 'Dashboard' : 'Account & projects'}</Link>
    <div className="page-head" style={{ marginTop: 'var(--section-gap)' }}>
      <div>
        <h1 className="page-title">Building & spaces</h1>
        <p className="page-sub">
          Your buildings, rooms and the information you have about them.
        </p>
      </div>
    </div>

    <div style={{ marginTop: 'var(--section-gap)' }}><BuildingContextSurface key={`${props.projectId}:${building ?? ""}`} {...props} initialBuildingId={building} /></div>
  </div>
}
