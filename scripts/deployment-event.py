#!/usr/bin/env python3
"""GitHub deployment events; no GitHub Environment or Cloudflare credentials required."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

DEMO = 'https://happy-learners-demo.lfmendoza-alvarez.workers.dev'


def api(path, payload):
    result = subprocess.run(['gh', 'api', '--method', 'POST', path, '--input', '-'],
                            input=json.dumps(payload), text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f'GitHub deployment API failed: {result.stderr.strip()}')
    return json.loads(result.stdout)


def event(mode, env, request=api):
    if env['GITHUB_EVENT_NAME'] not in ('push', 'workflow_dispatch') or env['GITHUB_REF'] != 'refs/heads/main':
        raise ValueError('Deployment events only run on main')
    sha = env['GITHUB_SHA']
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid deployment SHA')
    repo = env['GITHUB_REPOSITORY']
    log = f'https://github.com/{repo}/actions/runs/{env["GITHUB_RUN_ID"]}'
    if mode == 'start':
        deployment = request(f'repos/{repo}/deployments', {
            'ref': sha, 'auto_merge': False, 'required_contexts': [],
            'environment': 'demo', 'production_environment': False,
            'description': 'Verified artifact delivery', 'payload': {'workflow_run': env['GITHUB_RUN_ID']},
        })
        identifier = str(deployment['id'])
        with Path(env['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'id={identifier}\n')
        state = 'in_progress'
    elif mode == 'finish':
        identifier = env['DEPLOYMENT_ID']
        state = 'success' if env['DEPLOY_OUTCOME'] == 'success' else 'failure'
    else:
        raise ValueError('Unknown deployment operation')
    if not identifier.isdigit():
        raise ValueError('Invalid deployment ID')
    request(f'repos/{repo}/deployments/{identifier}/statuses', {
        'state': state, 'log_url': log, 'environment_url': DEMO,
        'auto_inactive': state == 'success',
    })


if __name__ == '__main__':
    event(sys.argv[1], os.environ)
