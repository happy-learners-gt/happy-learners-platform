import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('deployment', Path(__file__).resolve().parents[1] / 'scripts/deployment-event.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.env = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': 'a' * 40,
                    'GITHUB_REPOSITORY': 'org/repo', 'GITHUB_RUN_ID': '42'}

    def request(self, path, payload):
        self.calls.append((path, payload))
        return {'id': 7}

    def test_start_has_exact_sha_and_no_auto_merge(self):
        with tempfile.TemporaryDirectory() as folder:
            self.env['GITHUB_OUTPUT'] = str(Path(folder) / 'output')
            module.event('start', self.env, self.request)
            self.assertEqual(Path(self.env['GITHUB_OUTPUT']).read_text(), 'id=7\n')
        create = self.calls[0][1]
        self.assertEqual(create['ref'], 'a' * 40)
        self.assertEqual(create['environment'], 'demo')
        self.assertFalse(create['auto_merge'])
        self.assertFalse(create['production_environment'])
        self.assertEqual(self.calls[1][1]['state'], 'in_progress')

    def test_never_runs_for_pr(self):
        self.env['GITHUB_EVENT_NAME'] = 'pull_request'
        with self.assertRaises(ValueError):
            module.event('start', self.env, self.request)
        self.assertEqual(self.calls, [])

    def test_success_failure_cancelled_and_skipped(self):
        for outcome in ['success', 'failure', 'cancelled', 'skipped']:
            self.env.update(DEPLOYMENT_ID='7', DEPLOY_OUTCOME=outcome)
            module.event('finish', self.env, self.request)
            self.assertEqual(self.calls[-1][1]['state'], 'success' if outcome == 'success' else 'failure')
            self.assertEqual(self.calls[-1][1]['environment_url'], module.DEMO)

    def test_invalid_sha_or_id_prevents_requests(self):
        self.env['GITHUB_SHA'] = 'main'
        with self.assertRaises(ValueError):
            module.event('start', self.env, self.request)
        self.assertEqual(self.calls, [])
