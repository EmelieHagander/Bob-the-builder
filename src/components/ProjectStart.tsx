import { useState } from 'react'
import { Link } from 'react-router-dom'
import { openBobWithDraft } from '../lib/bobSurface'
import { inputStyle } from './form'
import { Icon } from './ui'

/** First screen of an empty project: say the idea in plain words and let Bob draft the plan. */
export function ProjectStart({ photoUrl }: { photoUrl?: string } = {}) {
  const [idea, setIdea] = useState('')
  const openImages = () => {
    const images = document.getElementById('project-images') as HTMLDetailsElement | null
    if (!images) return
    const information = document.getElementById('project-information') as HTMLDetailsElement | null
    if (information) information.open = true
    images.open = true
    images.scrollIntoView({ block: 'start' })
  }
  return <section className="card project-start" aria-labelledby="project-start-title">
    <h2 id="project-start-title">What do you want to build?</h2>

    <textarea id="project-start-idea" aria-label="Your idea" style={inputStyle} rows={4} maxLength={4000} value={idea} onChange={event => setIdea(event.target.value)}
      placeholder="A bunk bed for two kids…" />
    <button type="button" className="btn btn-primary" disabled={!idea.trim()} onClick={() => openBobWithDraft(`Help me plan this project: ${idea.trim()}`)}>
      <Icon name="tree-evergreen" size={16} /> Ask Bob to plan it
    </button>
    <details><summary>Other ways to start</summary><ol className="project-start-steps">
      <li>{photoUrl ? <Link to={photoUrl}>Add photos of the space</Link> : <button type="button" className="project-start-link" onClick={openImages}>Add photos of the space</button>}<span className="foundation-hint">so Bob can see what is there today</span></li>
      <li><Link to="/facts">Note the measurements you know</Link><span className="foundation-hint">unknown ones can be measured later</span></li>
      <li><Link to="/areas">Split the work into Areas</Link><span className="foundation-hint">only if the project is big</span></li>
      <li><Link to="/events">Plan a build day</Link><span className="foundation-hint">when you want help from others</span></li>
    </ol></details>
  </section>
}
