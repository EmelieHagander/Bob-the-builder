import { useState } from 'react'
import * as db from '../data/database'
import { Avatar, Icon, Loading, skillDotColor, useAsync } from '../components/ui'
import { InviteModal } from '../components/InviteModal'
import { PersonModal } from '../components/editors'
import type { Person, SkillLevel } from '../data/types'

const dietWarn = /allerg|gluten|vegan|dairy/i

const SKILL_LABEL: Record<SkillLevel, string> = { novice: 'novice', intermediate: 'intermediate', expert: 'expert' }

export function People() {
  const [version, setVersion] = useState(0)
  const { data: people } = useAsync(() => db.getPeople(), [version])
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
        <button className="btn btn-primary no-print" onClick={() => setInviting(true)}>
          <Icon name="paper-plane-tilt" size={15} /> Invite people
        </button>
      </div>

      <div className="no-print" style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', maxWidth: 420 }}>
        <Icon name="magnifying-glass" size={16} color="var(--ink-faint)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, role or skill…"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: 'var(--ink)' }}
        />
      </div>

      {!people ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 18 }}>
          {filtered.map((p) => {
            const warn = dietWarn.test(p.diet)
            return (
              <div key={p.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar person={p} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{p.role}</div>
                  </div>
                  <button
                    className="no-print"
                    title={`Edit ${p.name.split(' ')[0]}`}
                    onClick={() => setEditing(p)}
                    style={{ background: 'none', border: 'none', padding: 4, display: 'flex', color: 'var(--ink-faint)', cursor: 'pointer' }}
                  >
                    <Icon name="pencil-simple" size={16} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 13 }}>
                  {p.skills.map((s) => (
                    <span key={s.name} title={SKILL_LABEL[s.level]} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '5px 10px' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: skillDotColor(s.level), flex: '0 0 auto' }} />
                      {s.name}
                    </span>
                  ))}
                </div>

                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={warn ? 'warning' : 'fork-knife'} weight={warn ? 'fill' : 'regular'} size={15} color={warn ? 'var(--clay)' : 'var(--ink-faint)'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: warn ? 'var(--clay)' : 'var(--ink-soft)' }}>{p.diet}</span>
                </div>
              </div>
            )
          })}
        </div>
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
