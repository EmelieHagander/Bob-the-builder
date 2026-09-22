from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from bob_cad_worker import ContractError, run

MAX_REQUEST_BYTES = 256 * 1024


def render_payload(raw, token: str | None, authorization: str | None):
    if not token or not authorization or not authorization.startswith("Bearer ") or not hmac.compare_digest(authorization[7:], token):
        return 401, {"ok": False, "error": "unauthorized"}
    try:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            manifest = run(raw, output)
            return 200, {
                "ok": True,
                "manifest": manifest,
                "step_base64": base64.b64encode((output / manifest["files"]["step"]).read_bytes()).decode("ascii"),
                "views": {name: (output / filename).read_text(encoding="utf-8") for name, filename in manifest["files"]["views"].items()},
            }
    except ContractError as error:
        return 400, {"ok": False, "error": "invalid_contract", "detail": str(error)}
    except Exception:
        return 500, {"ok": False, "error": "render_failed"}


class Handler(BaseHTTPRequestHandler):
    server_version = "bob-cad-worker/1"

    def log_message(self, format, *args):
        return

    def _json(self, status, body):
        payload = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/healthz":
            return self._json(200, {"ok": True, "engine": "build123d"})
        return self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/render":
            return self._json(404, {"ok": False, "error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json(400, {"ok": False, "error": "bad_request"})
        if length <= 0 or length > MAX_REQUEST_BYTES:
            return self._json(413 if length > MAX_REQUEST_BYTES else 400, {"ok": False, "error": "bad_request"})
        try:
            raw = json.loads(self.rfile.read(length))
        except Exception:
            return self._json(400, {"ok": False, "error": "bad_request"})
        status, body = render_payload(raw, os.environ.get("BOB_CAD_WORKER_TOKEN"), self.headers.get("Authorization"))
        return self._json(status, body)


def main() -> int:
    parser = argparse.ArgumentParser(description="Internal Bob CAD worker HTTP adapter")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    if not os.environ.get("BOB_CAD_WORKER_TOKEN"):
        raise SystemExit("BOB_CAD_WORKER_TOKEN is required")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
