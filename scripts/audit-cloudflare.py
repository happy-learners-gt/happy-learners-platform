#!/usr/bin/env python3
"""Read-only Happy Learners Worker evidence; never serialize API response bodies."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read(path):
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ValueError("Account identity invalid")
    request = Request(f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/happy-learners-demo/{path}",
                      headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]})
    for attempt in range(3):
        try:
            with build_opener(NoRedirect()).open(request, timeout=30) as response:
                data = json.load(response)
                if data.get("success") is not True:
                    raise ValueError("Cloudflare response unsuccessful")
                return data["result"]
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise ValueError("Cloudflare HTTP " + str(error.code)) from None
        except OSError:
            if attempt == 2:
                raise ValueError("Cloudflare unavailable") from None
        time.sleep(2**attempt)


def main():
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY") != "happy-learners-gt/happy-learners-platform"
            or os.environ.get("GITHUB_REF") != "refs/heads/main"):
        raise ValueError("Hosted main required")
    deployments = read("deployments")
    settings = read("settings")
    records = deployments.get("deployments", [])
    data = {"schema": 1, "worker": "happy-learners-demo", "observed_at": datetime.now(timezone.utc).isoformat(),
            "run_id": os.environ["GITHUB_RUN_ID"], "repository_sha": os.environ["GITHUB_SHA"],
            "deployments": [{k: d.get(k) for k in ("id", "created_on", "source", "strategy", "versions")}
                            for d in records],
            "settings": {"compatibility_date": settings.get("compatibility_date"),
                         "compatibility_flags": settings.get("compatibility_flags"),
                         "observability": settings.get("observability"),
                         "bindings": [{"name": b.get("name"), "type": b.get("type")}
                                      for b in settings.get("bindings", [])]},
            "external_writes": False}
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    for name in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
        if os.environ[name] in raw:
            raise ValueError("Credential material rejected")
    digest = hashlib.sha256(raw.encode()).hexdigest()
    folder = Path(".recovery-evidence")
    folder.mkdir(exist_ok=True)
    (folder / ("CF-" + digest + ".json")).write_text(json.dumps({"id": "CF-" + digest, "sha256": digest, "data": data}, indent=2) + "\n")
    print(json.dumps({"snapshot": "CF-" + digest, "deployments": len(records), "external_writes": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"status":"cloudflare_audit_unavailable","diagnostic":"sanitized"}')
        raise SystemExit(1)
