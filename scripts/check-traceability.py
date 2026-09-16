#!/usr/bin/env python3
"""Validate PR metadata and introduced commits; never interpolate PR text into a shell."""

import json
import os
import re
import subprocess
from pathlib import Path


def validate(pr, commits):
    branch, title = pr["head"]["ref"], pr["title"]
    body = re.sub(r"<!--.*?-->", "", pr.get("body") or "", flags=re.S)
    labels = {item["name"] for item in pr.get("labels", [])}
    if pr["user"]["login"] == "dependabot[bot]" and branch.startswith("dependabot/"):
        return
    if (
        "type:maintenance" in labels
        and branch.startswith("maintenance/")
        and title.startswith("maintenance: ")
        and re.search(r"^Sin Jira: \S.{15,}", body, re.M)
    ):
        return
    key = re.match(r"^(HL-[1-9][0-9]*)\b", title)
    if not key:
        raise ValueError("El título debe comenzar por HL-N")
    token = key.group(1)
    if not re.search(r"(?<![A-Za-z0-9])" + token + r"(?![0-9])", branch):
        raise ValueError("La rama debe incluir la misma Jira key del título")
    if not commits or any(not re.search(r"\bHL-[1-9][0-9]*\b", message) for message in commits):
        raise ValueError("Cada commit nuevo debe incluir HL-N")
    for expression, name in [
        (r"^Jira:.*\b" + token + r"\b", "Jira key"),
        (r"^Source ID:\s*ST-[0-9]{3}\b", "Source ID"),
        (r"^Release:\s*REL-[0-9]{3}\b", "release"),
        (r"^Criterios:\s*\S.{10,}", "criterios"),
        (r"^Evidencia:\s*\S.{10,}", "evidencia"),
    ]:
        if not re.search(expression, body, re.M):
            raise ValueError("El cuerpo requiere " + name)


def main():
    pr = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())["pull_request"]
    base, head = pr["base"]["sha"], pr["head"]["sha"]
    if not all(re.fullmatch(r"[0-9a-f]{40}", value) for value in [base, head]):
        raise ValueError("SHA de PR inválido")
    messages = subprocess.check_output(["git", "log", "--format=%B%x00", base + ".." + head], text=True)
    validate(pr, [message.strip() for message in messages.split("\0") if message.strip()])
    print("Trazabilidad del PR verificada")


if __name__ == "__main__":
    main()
