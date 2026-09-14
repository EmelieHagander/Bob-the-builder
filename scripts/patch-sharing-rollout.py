from pathlib import Path

path = Path('scripts/check-live-foundations.mjs')
text = path.read_text()
old_import = "import { verifyBuildingContext } from './check-live-building-context.mjs'\n"
new_import = old_import + "import { verifyVolunteerAccess } from './check-live-volunteers.mjs'\n"
if old_import not in text or "verifyVolunteerAccess" in text:
    raise SystemExit('unexpected foundation verifier import state')
text = text.replace(old_import, new_import, 1)
old_call = "  await verifyBuildingContext(client, anonymous, project.id, areaId, facts)\n"
new_call = old_call + "  await verifyVolunteerAccess(client, anonymous, url, key, project.id, areaId, taskId, imageId, png)\n"
if old_call not in text:
    raise SystemExit('foundation verifier call seam not found')
text = text.replace(old_call, new_call, 1)
path.write_text(text)
print('Sharing volunteer live proof composed into foundation verifier')
