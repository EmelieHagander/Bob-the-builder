import { useBobSurface } from '../lib/bobSurface'
import { useState } from 'react'
import * as db from '../data/database'
import { Avatar, EmptyState, Icon, List, ListItem, Loading, SummaryRow, skillDotColor, useAsync } from '../components/ui'
import { InviteModal } from '../components/InviteModal'
import { PersonModal } from '../components/editors'
import { ProjectSharingCard } from '../components/SharingCards'
import { FormError } from '../components/form'
import type { Person, SkillLevel } from '../data/types'

const dietWarn = /allerg|gluten|vegan|dairy/i

const SKILL_LABEL: Record<SkillLevel, string> = { novice: 'novice', intermediate: 'intermediate', expert: 'expert' }

export function People() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'people' }, 'People')
  const [version, setVersion] = useState(0)
  const { data: people, loading, error } = useAsync(() => db.getPeople(), [version])
  const { data: projects } = useAsync(() => db.getProjects(), [])
  const { data: project } = useAsync(() => db.getProject(), [])
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [query, setQuery] = useState('')

  const filtered = (people ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.role.toLowerCase().includes(query.toLowerCase()) ||
      p.skills.some((s) => s.name.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">People</h1>
          <p className="page-sub">Everyone on the build, their skills and what they can't eat.</p>
        </div>
        <button className="btn btn-primary no-print" onClick={() => setInviting(true)} disabled={!project}>
          <Icon name="paper-plane-tilt" size={15} /> Invite people
        </button>
      </div>

      {project && <details className="sharing-disclosure no-print">
        <summary>Household sharing &amp; friend invitations</summary>
        <ProjectSharingCard key={project.id} projectId={project.id} version={version} onChanged={() => setVersion(value => value + 1)} />
      </details>}

      <div className="ui-search no-print">
        <Icon name="magnifying-glass" size={16} color="var(--ink-faint)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, role or skill…"
          aria-label="Search people"
        />
      </div>

      {error ? <div role="alert" style={{ marginTop: 'var(--section-gap)' }}><FormError>{error.message}</FormError><button className="btn" onClick={() => setVersion(value => value + 1)}>Try again</button></div> : loading || !people ? (
        <Loading />
      ) : (
        <List aria-label="Project crew">
          {filtered.length === 0 && <EmptyState icon="users-three" title="No people found" hint="Try a different name, role or skill." />}
          {filtered.map((p) => {
            const warn = dietWarn.test(p.diet)
            return (
              <ListItem key={p.id}>
                <SummaryRow leading={<Avatar person={p} size={28} />} trailing={
                  <button
                    className="ui-icon-button no-print"
                    title={`Edit ${p.name.split(' ')[0]}`}
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    <Icon name="pencil-simple" size={16} />
                  </button>
                }><div className="ui-row-title">{p.name}</div><div className="ui-row-meta">{p.role}</div></SummaryRow>

                <div className="ui-row-actions">
                  {p.skills.map((s) => (
                    <span key={s.name} className="pill" title={SKILL_LABEL[s.level]} style={{ color: 'var(--ink)', background: 'var(--surface-2)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: skillDotColor(s.level), flex: '0 0 auto' }} />
                      {s.name}
                    </span>
                  ))}
                </div>

                <div className="ui-row-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={warn ? 'warning' : 'fork-knife'} weight={warn ? 'fill' : 'regular'} size={15} color={warn ? 'var(--clay)' : 'var(--ink-faint)'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: warn ? 'var(--clay)' : 'var(--ink-soft)' }}>{p.diet}</span>
                </div>
              </ListItem>
            )
          })}
        </List>
      )}

      {editing && (
        <PersonModal
          person={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            setVersion((v) => v + 1)
          }}
        />
      )}

      {inviting && (
        <InviteModal
          projects={projects ?? []}
          defaultProjectId={project?.id ?? ''}
          onClose={() => {
            setInviting(false)
            setVersion((v) => v + 1)
          }}
          onInvited={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  )
}
