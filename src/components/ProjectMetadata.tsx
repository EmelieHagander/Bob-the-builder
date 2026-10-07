import { formatEventDay } from '../lib/eventDay'
import { AvatarStack, Icon } from './ui'
import type { ProjectOverview } from '../data/projectOverview'
/** No empty metadata placeholders; the same contract serves Home and Project. */
export function ProjectMetadata({ overview }: { overview?: ProjectOverview | null }) {
  if (!overview || (!overview.participants.length && !overview.event && !overview.taskEstimate)) return null
  return <span className="project-metadata">
    {overview.participants.length > 0 && <span title={overview.participants.map(person => person.name).join(', ')}><AvatarStack people={overview.participants} size={20} max={3} /><span>{overview.participants.length} {overview.participants.length === 1 ? 'participant' : 'participants'}</span></span>}
    {overview.event && <span><Icon name="calendar-dots" size={14} /><span>{[overview.event.title, formatEventDay(overview.event.day), overview.event.time].filter(Boolean).join(' · ')}</span></span>}
    {overview.taskEstimate && <span title="Total estimate for the saved tasks"><Icon name="clock" size={14} /><span>{overview.taskEstimate} · task estimate</span></span>}
  </span>
}
