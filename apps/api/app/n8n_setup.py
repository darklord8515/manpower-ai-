"""`make n8n-setup`: connect the app to n8n in one step.

It creates the webhook key credential in n8n from N8N_HMAC_SECRET (the same value the API sends),
imports the "send an email" workflow wired to the SMTP credential you saved in n8n, publishes it
and restarts n8n. Safe to run again. The key and the mail password are never printed, and every
temporary file is removed.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from app.config import REPO_ROOT, get_settings

WORKFLOW = REPO_ROOT / "infra" / "n8n" / "hamra-send-email.json"
COMPOSE = ["docker", "compose", "--env-file", str(REPO_ROOT / ".env"), "-f",
           str(REPO_ROOT / "infra" / "docker-compose.yml")]  # fmt: skip
WORKFLOW_ID = "hamraSendEmail01"


def run(*args: str, root: bool = False) -> str:
    done = subprocess.run(args, capture_output=True, text=True, check=False)  # noqa: S603
    if done.returncode != 0:
        raise SystemExit(
            f"{' '.join(args[:4])} failed: {done.stderr.strip() or done.stdout.strip()}"
        )
    return done.stdout


def container() -> str:
    found = run(*COMPOSE, "ps", "-q", "n8n").strip()
    if not found:
        raise SystemExit(
            "n8n is not running. Start it with `make dev` or `docker compose up -d n8n`."
        )
    return found


def exec_in(box: str, *args: str, root: bool = False) -> str:
    return run("docker", "exec", *(["-u", "root"] if root else []), box, *args)


def import_file(box: str, kind: str, payload: object) -> None:
    """Copy a JSON file into n8n, import it, and remove every copy of it."""
    with tempfile.TemporaryDirectory() as folder:
        local = Path(folder) / f"{kind}.json"
        local.write_text(json.dumps(payload), encoding="utf-8")
        run("docker", "cp", str(local), f"{box}:/tmp/{kind}.json")
    try:
        exec_in(box, "chmod", "644", f"/tmp/{kind}.json", root=True)  # noqa: S108
        exec_in(box, "n8n", f"import:{kind}", f"--input=/tmp/{kind}.json")
    finally:
        exec_in(box, "rm", "-f", f"/tmp/{kind}.json", root=True)  # noqa: S108


def main() -> int:
    key = get_settings().n8n_hmac_secret
    if not key:
        print("N8N_HMAC_SECRET is empty in .env. Run `make env` or set it, then try again.")  # noqa: T201
        return 1
    box = container()
    listing = exec_in(box, "n8n", "export:credentials", "--all")
    credentials = json.loads(next(line for line in listing.splitlines() if line.startswith("[")))
    smtp = next((c for c in credentials if c["type"] == "smtp"), None)
    if smtp is None:
        print("There is no SMTP credential in n8n yet. Create one (SMTP) and run this again.")  # noqa: T201
        return 1

    import_file(box, "credentials", [{
        "id": "hamraHeaderAuth01", "name": "HAMRA AI webhook key", "type": "httpHeaderAuth",
        "data": {"name": "X-Hamra-Key", "value": key},
    }])  # fmt: skip
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8").replace("__SMTP_ID__", smtp["id"]))
    import_file(box, "workflow", [workflow])
    exec_in(box, "n8n", "publish:workflow", f"--id={WORKFLOW_ID}")
    run("docker", "restart", box)
    print("Restarting n8n...")  # noqa: T201
    for _ in range(40):
        time.sleep(3)
        health = subprocess.run(  # noqa: S603
            ["docker", "inspect", "-f", "{{.State.Health.Status}}", box],  # noqa: S607
            capture_output=True, text=True, check=False,
        )  # fmt: skip
        if health.stdout.strip() == "healthy":
            print("Done. The email workflow is published and the app can use it.")  # noqa: T201
            return 0
    print("n8n did not become healthy in two minutes. Check `docker logs` for it.")  # noqa: T201
    return 1


if __name__ == "__main__":
    sys.exit(main())
