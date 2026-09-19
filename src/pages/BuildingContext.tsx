import type { ComponentProps } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BuildingContextSurface } from '../components/BuildingContextSurface'
import { Icon } from '../components/ui'

type SurfaceProps = ComponentProps<typeof BuildingContextSurface>

export function BuildingContext(props: SurfaceProps) {
  const [params] = useSearchParams()
  const building = params.get('building') ?? undefined
  return <div className="page building-context-page">
    <Link className="btn" to={props.projectId ? '/' : '/account'}><Icon name="arrow-left" size={15} /> {props.projectId ? 'Dashboard' : 'Account & projects'}</Link>
    <div className="page-head" style={{ marginTop: 18 }}>
      <div>
        <p className="foundation-hint" style={{ marginBottom: 4 }}>Persistent physical context</p>
        <h1 className="page-title">Building & spaces</h1>
        <p className="page-sub">
          Record only what you know about the place. A single room is enough to start; the model can grow across future projects.
        </p>
      </div>
    </div>

    <div className="card foundation-section" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="info" size={20} color="var(--accent-2)" />
        <div>
          <strong>Physical truth is separate from project plans.</strong>
          <p className="foundation-hint" style={{ margin: '4px 0 0' }}>
            Areas still organise project work. Buildings, spaces and elements describe the place itself and may be reused by later projects. Proposed remodel changes do not replace accepted current state until they are explicitly accepted.
          </p>
        </div>
      </div>
    </div>

    <div style={{ marginTop: 18 }}><BuildingContextSurface key={`${props.projectId}:${building ?? ""}`} {...props} initialBuildingId={building} /></div>
  </div>
}
