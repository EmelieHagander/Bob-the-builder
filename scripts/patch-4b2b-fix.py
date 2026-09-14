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
text = text.replace('    artifact.title, artifact_revision,', '    artifact_title, v_artifact_revision,')
text = text.replace('    net_area_m2, normalized_area_m2, artifact.status,', '    net_area_m2, normalized_area_m2, artifact_status,')
text = text.replace('  artifact_id uuid;\n  artifact_revision integer;\n', '  v_artifact_id uuid;\n  v_artifact_revision integer;\n')
text = text.replace("  artifact_id := nullif(p_data->>'artifact_id','')::uuid;\n  artifact_revision := nullif(p_data->>'artifact_revision','')::integer;\n  if artifact_id is null or artifact_revision is null then", "  v_artifact_id := nullif(p_data->>'artifact_id','')::uuid;\n  v_artifact_revision := nullif(p_data->>'artifact_revision','')::integer;\n  if v_artifact_id is null or v_artifact_revision is null then")
text = text.replace('  where ah.id=artifact_id and ah.project_id=p_project and ah.current_revision=artifact_revision\n', '  where ah.id=v_artifact_id and ah.project_id=p_project and ah.current_revision=v_artifact_revision\n')
text = text.replace('  where i.project_id=p_project and i.artifact_id=artifact_id and i.artifact_revision=artifact_revision;\n', '  where i.project_id=p_project and i.artifact_id=v_artifact_id and i.artifact_revision=v_artifact_revision;\n')
text = text.replace('  basis text;\n', '  v_basis text;\n')
text = text.replace('  basis := format(\n', '  v_basis := format(\n')
text = text.replace("    'basis',basis,\n", "    'basis',v_basis,\n")
text = text.replace('      basis=basis\n', '      basis=v_basis\n')
if 'artifact bob.artifact_revisions' in text or 'into artifact,generation' in text or '  artifact_id uuid;' in text or '  basis text;' in text or 'basis=basis' in text:
    raise SystemExit('4B2b SQL variable fixes did not apply')
migration.write_text(text)

browser = Path('scripts/material-planning-browser.mjs')
text = browser.read_text()
text = text.replace(
    "await modal.getByLabel('Generated drawing', { exact: true }).selectOption({ label: /Stud wall elevation · Version 2/ })",
    "await modal.getByLabel('Generated drawing', { exact: true }).selectOption({ index: 0 })",
)
browser.write_text(text)
print('4B2b follow-up fixes applied')
