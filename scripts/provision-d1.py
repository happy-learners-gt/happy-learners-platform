"""Reconcile the single free D1 resource authorized for HL-9/HL-10."""
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

NAME = "happy-learners-sprint-one"


def call(method, suffix="", data=None):
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database{suffix}",
        method=method,
        data=json.dumps(data).encode() if data else None,
        headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"],
                 "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        if not result.get("success"):
            raise RuntimeError("D1 operation unsuccessful")
        return result["result"]
    except HTTPError as error:
        raise RuntimeError(f"D1 HTTP {error.code}; verify existing token D1 permission") from None


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise RuntimeError("Trusted main required")
    matches = [db for db in call("GET", "?per_page=100") if db["name"] == NAME]
    if len(matches) > 1:
        raise RuntimeError("Ambiguous D1 identity")
    db = matches[0] if matches else call("POST", data={"name": NAME})
    evidence = {"database_name": NAME, "database_id": db["uuid"],
                "created": not bool(matches), "run_id": os.environ["GITHUB_RUN_ID"]}
    folder = Path(".recovery-evidence")
    folder.mkdir(exist_ok=True)
    (folder / "d1-provision.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))


if __name__ == "__main__":
    main()
