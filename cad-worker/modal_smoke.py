"""Verify a deployed worker using synthetic geometry, without logging secrets."""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import modal


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

    def request(body, token):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers, method="POST")
        # Matches the existing Edge transport's deadline, including cold start.
        with opener.open(req, timeout=45) as response:
            data = response.read(6 * 1024 * 1024 + 1)
            if len(data) > 6 * 1024 * 1024:
                raise RuntimeError("CAD response exceeds the Edge transport limit")
            return json.loads(data)

    started = time.monotonic()
    packet = request(recipe, os.environ["BOB_CAD_TOKEN"])
    elapsed = time.monotonic() - started
    if elapsed >= 45:
        raise RuntimeError("CAD render exceeded the Edge transport deadline")
    manifest = packet["manifest"]
    if (manifest["assembly_id"] != recipe["assembly_id"]
            or manifest["engine"] != {"name": "build123d", "version": "0.13.0", "units": "mm"}
            or manifest["definitions"] != recipe["definitions"]
            or manifest["bounding_box_mm"]["size"] != [45, 70, 900]):
        raise RuntimeError("CAD geometry or engine identity mismatch")
    expected = {"step", *recipe["views"]}
    if set(packet["files"]) != expected or set(manifest["exports"]) != expected:
        raise RuntimeError("Missing CAD exports")
    for key in expected:
        raw = base64.b64decode(packet["files"][key], validate=True)
        if hashlib.sha256(raw).hexdigest() != manifest["exports"][key]["sha256"]:
            raise RuntimeError("CAD export hash mismatch")
        if (b"ISO-10303-21" if key == "step" else b"<svg") not in raw:
            raise RuntimeError("Invalid CAD file format")
    if set(packet.get("previews",{})) != set(recipe["views"]):
        raise RuntimeError("Missing CAD PNG previews")
    for view in recipe["views"]:
        raw=base64.b64decode(packet["previews"][view],validate=True)
        preview=manifest["previews"][view]
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or hashlib.sha256(raw).hexdigest()!=preview["sha256"] or preview["source_sha256"]!=manifest["exports"][view]["sha256"]:
            raise RuntimeError("Preview is not bound to its exported SVG")
    for body, token, status in [({}, "", 401), ({}, "invalid-smoke-token", 401),
                                ({}, os.environ["BOB_CAD_TOKEN"], 422)]:
        try:
            request(body, token)
        except urllib.error.HTTPError as exc:
            if exc.code != status:
                raise RuntimeError("Unexpected CAD rejection status") from None
        else:
            raise RuntimeError("CAD accepted an unauthorized or invalid request")
    summary = (f"CAD smoke test passed: STEP + four SVGs + four source-bound PNG previews, hashes, dimensions and authorization.\n\n"
               f"First authenticated request: {elapsed:.2f} seconds.\n\n"
               f"Set Supabase Edge secret `BOB_CAD_URL` to `{endpoint}`.\n"
               "Set `BOB_CAD_TOKEN` to the same runtime secret stored in GitHub.\n"
               "This does not yet verify Bob's authenticated project-save journey.\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(summary)


if __name__ == "__main__":
    main()
