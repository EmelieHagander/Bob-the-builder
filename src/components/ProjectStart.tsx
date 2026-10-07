import { useState } from 'react'
import { Link } from 'react-router-dom'
import { openBobWithDraft } from '../lib/bobSurface'
import { inputStyle } from './form'
import { Icon } from './ui'

/** First screen of an empty project: say the idea in plain words and let Bob draft the plan. */
export function ProjectStart() {
  const [idea, setIdea] = useState('')
  const openImages = () => {
    const images = document.getElementById('project-images') as HTMLDetailsElement | null
    if (!images) return
    images.open = true
    images.scrollIntoView({ block: 'start' })
  }
  return <section className="card project-start" aria-labelledby="project-start-title">
    <h2 id="project-start-title">What do you want to build?</h2>
    <p className="foundation-hint">Describe it in your own words. You don’t need building terms or exact sizes. Bob drafts a plan you can change.</p>
    <label className="project-start-label" htmlFor="project-start-idea">Your idea</label>
    <textarea id="project-start-idea" style={inputStyle} rows={4} maxLength={4000} value={idea} onChange={event => setIdea(event.target.value)}
      placeholder="A bunk bed for two kids, about 90 × 200 cm, in a room with a sloping ceiling…" />
    <button type="button" className="btn btn-primary" disabled={!idea.trim()} onClick={() => openBobWithDraft(`Help me plan this project: ${idea.trim()}`)}>
      <Icon name="tree-evergreen" size={16} /> Ask Bob to plan it
    </button>
    <ol className="project-start-steps">
      <li><button type="button" className="project-start-link" onClick={openImages}>Add photos of the space</button><span className="foundation-hint">so Bob can see what is there today</span></li>
      <li><Link to="/facts">Note the measurements you know</Link><span className="foundation-hint">unknown ones can be measured later</span></li>
      <li><Link to="/areas">Split the work into Areas</Link><span className="foundation-hint">only if the project is big</span></li>
      <li><Link to="/events">Plan a build day</Link><span className="foundation-hint">when you want help from others</span></li>
    </ol>
  </section>
}
