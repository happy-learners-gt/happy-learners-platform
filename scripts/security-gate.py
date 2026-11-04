#!/usr/bin/env python3
"""ST-189: nothing reaches production unless its pull request passed the three security scanners.

GitHub's branch protection is not available for this private repository on the free plan, so the deploy job checks
it instead: the commit being deployed must come from a merged pull request, and the latest «Security scanners» run of
that pull request's head must have finished successfully (secrets, dependencies and code). Otherwise the deploy stops.
"""

import json
import os
import sys
import time
import urllib.request

API = "https://api.github.com"
WORKFLOW = "security.yml"


def get(path):
    request = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def decide(pulls, runs_for):
    """The verdict for a commit: (ok, reason). `runs_for(sha)` lists the scanner runs of a head commit, newest first."""
    merged = [pull for pull in pulls if pull.get("merged_at") and pull.get("base", {}).get("ref") == "main"]
    if not merged:
        return False, "el commit no viene de un pull request integrado en main"
    head = merged[0]["head"]["sha"]
    runs = runs_for(head)
    if not runs:
        return False, f"el pull request #{merged[0]['number']} no tiene ejecución de los escáneres"
    latest = runs[0]
    if latest.get("status") != "completed":
        return None, f"los escáneres del pull request #{merged[0]['number']} siguen en curso"
    if latest.get("conclusion") != "success":
        return False, f"los escáneres del pull request #{merged[0]['number']} terminaron en «{latest.get('conclusion')}»"
    return True, f"escáneres del pull request #{merged[0]['number']} en verde ({latest['html_url']})"


def main():
    repo, sha = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]
    pulls = get(f"/repos/{repo}/commits/{sha}/pulls")
    runs_for = lambda head: get(f"/repos/{repo}/actions/workflows/{WORKFLOW}/runs?head_sha={head}&per_page=5").get("workflow_runs", [])
    for _ in range(40):
        ok, reason = decide(pulls, runs_for)
        if ok is not None:
            print(("Puerta de seguridad: " if ok else "Despliegue detenido: ") + reason)
            sys.exit(0 if ok else 1)
        print("Esperando: " + reason)
        time.sleep(30)
    print("Despliegue detenido: los escáneres no terminaron en 20 minutos")
    sys.exit(1)


if __name__ == "__main__":
    main()
