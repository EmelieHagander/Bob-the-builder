"""On-demand hosting for the existing bounded CAD HTTP server."""
import os
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent
token = os.environ.get("BOB_CAD_TOKEN", "")
if len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
    raise RuntimeError("BOB_CAD_TOKEN must be at least 32 ASCII characters without whitespace")

image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("libgl1", "libglu1-mesa", "libgomp1", "libcairo2")
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .run_commands("useradd --uid 10001 --create-home cad")
    .add_local_dir(ROOT / "bob_cad", "/app/bob_cad", copy=True, ignore=["**/__pycache__/**", "**/*.pyc"])
    .workdir("/app")
)

app = modal.App("bob-cad")


@app.function(
    image=image,
    secrets=[modal.Secret.from_local_environ(["BOB_CAD_TOKEN"])],
    cpu=1,
    memory=2048,
    min_containers=0,
    buffer_containers=0,
    scaledown_window=60,
    timeout=60,
    startup_timeout=60,
)
@modal.web_server(8080, startup_timeout=30)
def render():
    import subprocess
    import sys

    # Modal's runtime runs as root. The HTTP/geometry subprocess does not;
    # it receives only its own bearer secret, never deployment credentials.
    subprocess.Popen(
        [sys.executable, "-m", "bob_cad.server"],
        cwd="/app",
        user=10001,
        group=10001,
        extra_groups=[],
        env={
            "PATH": os.environ["PATH"],
            "HOME": "/home/cad",
            "PORT": "8080",
            "BOB_CAD_TOKEN": os.environ["BOB_CAD_TOKEN"],
        },
    )
