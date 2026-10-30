"""Verify a deployed worker using synthetic geometry, without logging secrets."""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import importlib.util
from pathlib import Path

import modal


# Plain-language view titles, read without importing the CAD kernel.
_spec = importlib.util.spec_from_file_location("cad_annotations", Path(__file__).parent / "bob_cad/annotations.py")
_annotations = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_annotations)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    url = modal.Function.from_name("bob-cad", "render", environment_name="main").get_web_url()
    if not url or urllib.parse.urlparse(url).scheme != "https":
        raise RuntimeError("Modal did not return an HTTPS endpoint")
    endpoint = url.rstrip("/") + "/render"
    recipe = {
        "contract_version": 1, "units": "mm", "assembly_id": "deployment.smoke",
        "definitions": [{"id": "block", "primitive": "box", "material_ref": None,
                         "x_mm": 45, "y_mm": 70, "z_mm": 900}],
        "instances": [{"id": "block.one", "definition_id": "block", "placement":
                       {"x": 0, "y": 0, "z": 0, "rx": 0, "ry": 0, "rz": 0}}],
        "views": ["front", "right", "top", "isometric"],
    }
    opener = urllib.request.build_opener(NoRedirect)

    def request(body, token, path='/render'):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(url.rstrip('/')+path, data=json.dumps(body).encode(), headers=headers, method="POST")
        # Matches the existing Edge transport's deadline, including cold start.
        with opener.open(req, timeout=45) as response:
            data = response.read(6 * 1024 * 1024 + 1)
            if len(data) > 6 * 1024 * 1024:
                raise RuntimeError("CAD response exceeds the Edge transport limit")
            return json.loads(data)

    started = time.monotonic()
    source = {"artifact_id": "11111111-1111-4111-8111-111111111111", "revision": 3}
    packet = request({"recipe": recipe, "drawing_source": source}, os.environ["BOB_CAD_TOKEN"])
    elapsed = time.monotonic() - started
    if elapsed >= 45:
        raise RuntimeError("CAD render exceeded the Edge transport deadline")
    manifest = packet["manifest"]
    if (manifest["assembly_id"] != recipe["assembly_id"]
            or manifest["engine"] != {"name": "build123d", "version": "0.13.0", "units": "mm"}
            or manifest["definitions"] != recipe["definitions"]
            or manifest["bounding_box_mm"]["size"] != [45, 70, 900]):
        raise RuntimeError("CAD geometry or engine identity mismatch")
    if manifest.get('drawing_source') != source or manifest.get('annotations', {}).get('coverage') != 'complete':
        raise RuntimeError('Missing exact construction revision or annotations')
    expected = {"step", *recipe["views"]}
    if set(packet["files"]) != expected or set(manifest["exports"]) != expected:
        raise RuntimeError("Missing CAD exports")
    for key in expected:
        raw = base64.b64decode(packet["files"][key], validate=True)
        if hashlib.sha256(raw).hexdigest() != manifest["exports"][key]["sha256"]:
            raise RuntimeError("CAD export hash mismatch")
        if (b"ISO-10303-21" if key == "step" else b"<svg") not in raw:
            raise RuntimeError("Invalid CAD file format")
        if key != 'step' and (b'Construction version 3' not in raw or b'measurements in mm' not in raw or b'P1' not in raw):
            raise RuntimeError('Saved SVG lacks source revision, dimensions or part labels')
        if key != 'step':
            texts=[e.text or '' for e in ET.fromstring(raw).iter() if e.tag.endswith('}text')]
            if _annotations.VIEW_TITLES[key] not in texts or any(recipe['assembly_id'] in t for t in texts):
                raise RuntimeError('Visible CAD heading uses a stable identity instead of a neutral label')
    if set(packet.get("previews",{})) != set(recipe["views"]):
        raise RuntimeError("Missing CAD PNG previews")
    for view in recipe["views"]:
        raw=base64.b64decode(packet["previews"][view],validate=True)
        preview=manifest["previews"][view]
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or hashlib.sha256(raw).hexdigest()!=preview["sha256"] or preview["source_sha256"]!=manifest["exports"][view]["sha256"]:
            raise RuntimeError("Preview is not bound to its exported SVG")
        from io import BytesIO
        from PIL import Image
        with Image.open(BytesIO(raw)) as image:
            if sum(image.convert('L').histogram()[:200]) < 16:
                raise RuntimeError("CAD returned an unreadable preview")
    if manifest['annotations'].get('version') != 1 or 'fasteners' in manifest['annotations']:
        raise RuntimeError('A drawing without a fastener schedule must keep annotations version 1')
    # The construction's fastener schedule (2026-10-26) is drawn and echoed as annotations version 2.
    fasteners = {'rule_version': 'fastener-rules-v1', 'complete': True, 'glue_packages': 0,
                 'joints': [{'joint_id': 'smoke', 'method': 'screwed_butt', 'source': 'rule', 'kind': 'screw', 'diameter_mm': 5.0,
                             'length_mm': 120, 'count': 2, 'spacing_mm': 45, 'through_instance_id': 'block.one', 'through_mm': 45,
                             'embed_mm': 800, 'contact_length_mm': 95, 'contact_width_mm': 45, 'proposal': None, 'gaps': []}],
                 'totals': [{'kind': 'screw', 'diameter_mm': 5.0, 'length_mm': 120, 'count': 2, 'joint_ids': ['smoke']}]}
    scheduled = request({'recipe': {**recipe, 'views': ['front']}, 'drawing_source': source, 'fasteners': fasteners}, os.environ['BOB_CAD_TOKEN'])
    if scheduled['manifest']['annotations'].get('version') != 2 or scheduled['manifest']['annotations'].get('fasteners') != fasteners:
        raise RuntimeError('Fastener schedule was not echoed as annotations version 2')
    if b'Fasteners - proposal from rules of thumb' not in base64.b64decode(scheduled['files']['front'], validate=True):
        raise RuntimeError('Fastener schedule is missing from the drawing sheet')
    # Exercise the old failure boundary and actual sheet pagination in production.
    large={**recipe,'assembly_id':'deployment.paged','views':['front'],
           'definitions':[{'id':'block','primitive':'box','material_ref':None,'x_mm':10,'y_mm':20,'z_mm':30}],
           'instances':[{'id':f'part{i:03}','definition_id':'block','placement':{'x':(i%16)*20,'y':0,'z':(i//16)*50,'rx':0,'ry':0,'rz':0}} for i in range(128)]}
    large_started=time.monotonic()
    paged=request({'recipe':large,'drawing_source':source},os.environ['BOB_CAD_TOKEN'])
    large_elapsed=time.monotonic()-large_started
    notes=paged['manifest']['annotations']['views']['front']
    if (paged['manifest'].get('drawing_source')!=source or notes.get('coverage')!='complete'
        or [p['instance_id'] for p in notes['parts']]!=[i['id'] for i in large['instances']]):
        raise RuntimeError('Large drawing dropped or changed saved parts')
    page_keys={'front','front.sheet2','front.sheet3','front.sheet4'}
    if set(paged['previews'])!=page_keys or set(paged['manifest']['previews'])!=page_keys:
        raise RuntimeError('Large drawing omitted review sheets')
    large_svg=base64.b64decode(paged['files']['front'],validate=True)
    large_hash=hashlib.sha256(large_svg).hexdigest()
    if large_hash!=paged['manifest']['exports']['front']['sha256']:
        raise RuntimeError('Large SVG hash mismatch')
    if len([e for e in ET.fromstring(large_svg) if e.get('id','').startswith('DrawingPage')])!=4:
        raise RuntimeError('Large SVG omitted numbered sheets')
    for key in page_keys:
        raw=base64.b64decode(paged['previews'][key],validate=True)
        metadata=paged['manifest']['previews'][key]
        if hashlib.sha256(raw).hexdigest()!=metadata['sha256'] or metadata['source_sha256']!=large_hash:
            raise RuntimeError('Review sheet is not bound to the full saved SVG')
        with Image.open(BytesIO(raw)) as image:
            if max(image.size)!=1024 or sum(image.convert('L').histogram()[:200])<100:
                raise RuntimeError('Review sheet is not visible at full preview resolution')
    for body, token, status in [({}, "", 401), ({}, "invalid-smoke-token", 401),
                                ({}, os.environ["BOB_CAD_TOKEN"], 422)]:
        try:
            request(body, token)
        except urllib.error.HTTPError as exc:
            if exc.code != status:
                raise RuntimeError("Unexpected CAD rejection status") from None
        else:
            raise RuntimeError("CAD accepted an unauthorized or invalid request")
    source_hash=hashlib.sha256(json.dumps(dict(profile='kernel-edges-v1',recipe=recipe),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    wireframe=request(dict(recipe=recipe,source_hash=source_hash),os.environ['BOB_CAD_TOKEN'],'/wireframe')
    if (wireframe.get('profile')!='kernel-edges-v1' or wireframe.get('source_hash')!=source_hash
        or wireframe.get('engine')!='build123d-0.13.0' or wireframe.get('instances')!=recipe['instances']
        or wireframe.get('bounds')!={'min':[0,0,0],'max':[45,70,900]}
        or len(wireframe.get('definitions',[{}])[0].get('positions',[]))!=72):
        raise RuntimeError('Live wireframe does not contain the 12 native box edges')
    for token,status in [('',401),('invalid-smoke-token',401),(os.environ['BOB_CAD_TOKEN'],422)]:
        try: request({},token,'/wireframe')
        except urllib.error.HTTPError as exc:
            if exc.code!=status: raise RuntimeError('Unexpected wireframe rejection status') from None
        else: raise RuntimeError('Wireframe accepted an unauthorized or invalid request')
    summary = (f"CAD smoke test passed: STEP + four SVGs + four source-bound PNG previews, fastener schedule (annotations v2), native wireframe edges, hashes, dimensions and authorization.\n\n"
               f"First authenticated request: {elapsed:.2f} seconds.\n\n"
               f"128-part drawing: four full-resolution source-bound sheets in {large_elapsed:.2f} seconds.\n\n"
               f"Set Supabase Edge secret `BOB_CAD_URL` to `{endpoint}`.\n"
               "Set `BOB_CAD_TOKEN` to the same runtime secret stored in GitHub.\n"
               "This does not yet verify Bob's authenticated project-save journey.\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(summary)


if __name__ == "__main__":
    main()
