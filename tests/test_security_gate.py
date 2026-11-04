import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("security_gate", pathlib.Path("scripts/security-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SecurityGateTests(unittest.TestCase):
    """ST-189: the deploy stops unless the pull request behind the commit passed the three scanners."""

    pull = {"number": 7, "merged_at": "2026-11-04T00:00:00Z", "base": {"ref": "main"}, "head": {"sha": "abc"}}

    def test_a_merged_pull_request_with_green_scanners_deploys(self):
        ok, reason = gate.decide([self.pull], lambda head: [{"status": "completed", "conclusion": "success", "html_url": "u"}] if head == "abc" else [])
        self.assertTrue(ok)
        self.assertIn("#7", reason)

    def test_failed_running_or_missing_scanners_stop_or_wait(self):
        self.assertFalse(gate.decide([self.pull], lambda head: [{"status": "completed", "conclusion": "failure"}])[0])
        self.assertIsNone(gate.decide([self.pull], lambda head: [{"status": "in_progress"}])[0])
        self.assertFalse(gate.decide([self.pull], lambda head: [])[0])

    def test_a_commit_without_a_merged_pull_request_into_main_stops(self):
        self.assertFalse(gate.decide([], lambda head: [])[0])
        self.assertFalse(gate.decide([{**self.pull, "merged_at": None}], lambda head: [])[0])
        self.assertFalse(gate.decide([{**self.pull, "base": {"ref": "otra"}}], lambda head: [])[0])


if __name__ == "__main__":
    unittest.main()
