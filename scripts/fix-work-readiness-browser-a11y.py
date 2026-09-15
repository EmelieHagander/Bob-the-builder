from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} matches, found {actual}: {old[:120]!r}')
    p.write_text(text.replace(old, new, count))


panel = 'src/components/TaskReadinessPanel.tsx'
replace(panel,
    "{!tools.length ? <p>No required tool recorded.</p> : tools.map(need => <label key={need.id} className=\"foundation-check\" style={{ marginTop: 8 }}><input type=\"checkbox\" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span><button type=\"button\" className=\"btn\" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></label>)}",
    "{!tools.length ? <p>No required tool recorded.</p> : tools.map(need => <div key={need.id} className=\"foundation-actions\" style={{ justifyContent: 'space-between', marginTop: 8 }}><label className=\"foundation-check\" style={{ flex: 1 }}><input aria-label={`Available: ${need.label}`} type=\"checkbox\" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span></label><button type=\"button\" className=\"btn\" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></div>)}")
replace(panel,
    "{!information.length ? <p>No explicit information check recorded.</p> : information.map(need => <label key={need.id} className=\"foundation-check\" style={{ marginTop: 8 }}><input type=\"checkbox\" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span><button type=\"button\" className=\"btn\" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></label>)}",
    "{!information.length ? <p>No explicit information check recorded.</p> : information.map(need => <div key={need.id} className=\"foundation-actions\" style={{ justifyContent: 'space-between', marginTop: 8 }}><label className=\"foundation-check\" style={{ flex: 1 }}><input aria-label={`Confirmed: ${need.label}`} type=\"checkbox\" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span></label><button type=\"button\" className=\"btn\" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></div>)}")

browser = 'scripts/check-project-phases-browser.mjs'
replace(browser,
    "await page.getByLabel('Circular saw', { exact: true }).check()",
    "await page.getByLabel('Available: Circular saw', { exact: true }).click()")

print('Readiness browser/a11y fix applied.')
