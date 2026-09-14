from pathlib import Path

migration = Path('supabase/migrations/20260914084207_deterministic_material_quantities.sql')
text = migration.read_text()
text = text.replace(
    "  artifact bob.artifact_revisions;\n  generation bob.artifact_generations;\n",
    "  artifact_title text;\n  artifact_status text;\n",
)
text = text.replace(
    "  select ar.*,g.* into artifact,generation\n",
    "  select ar.title,ar.status into artifact_title,artifact_status\n",
)
text = text.replace(
    "  select ar,g into artifact,generation\n",
    "  select ar.title,ar.status into artifact_title,artifact_status\n",
)
text = text.replace('    artifact.title, artifact_revision,', '    artifact_title, artifact_revision,')
text = text.replace('    net_area_m2, normalized_area_m2, artifact.status,', '    net_area_m2, normalized_area_m2, artifact_status,')
if 'artifact bob.artifact_revisions' in text or 'into artifact,generation' in text:
    raise SystemExit('composite record fix did not apply')
migration.write_text(text)

browser = Path('scripts/material-planning-browser.mjs')
text = browser.read_text()
text = text.replace(
    "await modal.getByLabel('Generated drawing', { exact: true }).selectOption({ label: /Stud wall elevation · Version 2/ })",
    "await modal.getByLabel('Generated drawing', { exact: true }).selectOption({ index: 0 })",
)
browser.write_text(text)
print('4B2b follow-up fixes applied')
