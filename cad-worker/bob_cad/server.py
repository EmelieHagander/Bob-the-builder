"""Private, bounded CAD transport. Run behind HTTPS; no model-selected paths/code."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
import base64
import hmac
import json
import multiprocessing
import os

# A 1,024-joint fastener schedule plus a 512-instance recipe stays below 1 MiB.
MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 6 * 1024 * 1024

def render_to_pipe(recipe, connection):
    try:
        from .worker import render_assembly
        source=fasteners=None
        # A bare recipe, {recipe, drawing_source}, or that envelope with the
        # construction revision's fastener schedule (annotations version 2).
        if isinstance(recipe,dict) and set(recipe) in ({'recipe','drawing_source'},{'recipe','drawing_source','fasteners'}):
            recipe,source,fasteners=recipe['recipe'],recipe['drawing_source'],recipe.get('fasteners')
        with TemporaryDirectory() as directory:
            manifest = render_assembly(recipe, directory, source, fasteners)
            files = {}
            for key, export in manifest['exports'].items():
                path = Path(directory) / export['file']
                if path.stat().st_size > 3 * 1024 * 1024:
                    raise ValueError('output_too_large')
                files[key] = base64.b64encode(path.read_bytes()).decode('ascii')
            previews = {}
            for key, preview in manifest['previews'].items():
                raw = (Path(directory) / preview['file']).read_bytes()
                if len(raw) > 512 * 1024:
                    raise ValueError('preview_too_large')
                previews[key] = base64.b64encode(raw).decode('ascii')
            body = json.dumps({'manifest': manifest, 'files': files, 'previews': previews}).encode()
            if len(body) > MAX_RESPONSE:
                raise ValueError('output_too_large')
            connection.send_bytes(body)
    except Exception:
        connection.send_bytes(b'')
    finally:
        connection.close()

def wireframe_to_pipe(request, connection):
    try:
        from .wireframe import render_wireframe
        body = json.dumps(render_wireframe(request), separators=(',', ':')).encode()
        if len(body) > 4 * 1024 * 1024:
            raise ValueError('wireframe_output_too_large')
        connection.send_bytes(body)
    except Exception:
        connection.send_bytes(b'')
    finally:
        connection.close()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No auth headers, project recipes or private file data in access logs.

    def do_POST(self):
        token = os.environ.get('BOB_CAD_TOKEN', '')
        if not token or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            self.send_error(401)
            return
        if self.path not in ('/render', '/wireframe'):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_REQUEST:
                raise ValueError()
            self.connection.settimeout(10)
            recipe = json.loads(self.rfile.read(length))
        except (ValueError, TimeoutError):
            self.send_error(400)
            return
        context = multiprocessing.get_context('spawn')
        receive, send = context.Pipe(duplex=False)
        worker = context.Process(target=wireframe_to_pipe if self.path == '/wireframe' else render_to_pipe, args=(recipe, send))
        worker.start()
        send.close()
        try:
            if not receive.poll(40):
                self.send_error(504)
                return
            body = receive.recv_bytes(MAX_RESPONSE)
            if not body:
                self.send_error(422)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            if worker.is_alive():
                worker.terminate()
            worker.join(timeout=2)
            receive.close()

if __name__ == '__main__':
    if len(os.environ.get('BOB_CAD_TOKEN', '')) < 32:
        raise SystemExit('BOB_CAD_TOKEN must contain at least 32 characters')
    HTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8080'))), Handler).serve_forever()
