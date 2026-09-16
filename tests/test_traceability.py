import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "traceability", Path(__file__).resolve().parents[1] / "scripts/check-traceability.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TraceabilityTests(unittest.TestCase):
    def pr(self):
        return {
            "head": {"ref": "feat/HL-99-delivery"},
            "title": "HL-99 ST-049: entrega",
            "body": "Jira: HL-99\nSource ID: ST-049\nRelease: REL-001\nCriterios: aceptación verificable\nEvidencia: pruebas verificadas",
            "labels": [],
            "user": {"login": "developer"},
        }

    def test_valid(self):
        module.validate(self.pr(), ["HL-99: implementar"])

    def test_missing_key_in_each_commit(self):
        with self.assertRaises(ValueError):
            module.validate(self.pr(), ["HL-99: implementar", "missing key"])

    def test_mismatched_branch(self):
        pr = self.pr()
        pr["head"]["ref"] = "feat/HL-990-wrong"
        with self.assertRaises(ValueError):
            module.validate(pr, ["HL-99: implementar"])

    def test_old_title_format_rejected(self):
        pr = self.pr()
        pr["title"] = "[HL-99][ST-049] entrega"
        with self.assertRaises(ValueError):
            module.validate(pr, ["HL-99: implementar"])

    def test_dependabot_requires_real_author(self):
        pr = self.pr()
        pr["head"]["ref"] = "dependabot/npm/foo"
        pr["title"] = "Bump foo"
        with self.assertRaises(ValueError):
            module.validate(pr, ["Bump foo"])
        pr["user"]["login"] = "dependabot[bot]"
        module.validate(pr, ["Bump foo"])

    def test_maintenance_requires_all_conditions(self):
        pr = self.pr()
        pr.update(title="maintenance: templates", body="Sin Jira: reparación de metadatos del repositorio")
        pr["head"]["ref"] = "maintenance/templates"
        with self.assertRaises(ValueError):
            module.validate(pr, ["maintenance: templates"])
        pr["labels"] = [{"name": "type:maintenance"}]
        module.validate(pr, ["maintenance: templates"])

    def test_body_requires_evidence(self):
        pr = self.pr()
        pr["body"] = pr["body"].split("Evidencia:")[0]
        with self.assertRaises(ValueError):
            module.validate(pr, ["HL-99: implementar"])

    def test_template_comments_do_not_count_as_evidence(self):
        pr = self.pr()
        pr["body"] = pr["body"].split("Evidencia:")[0] + "Evidencia: <!-- pruebas pendientes -->"
        with self.assertRaises(ValueError):
            module.validate(pr, ["HL-99: implementar"])
