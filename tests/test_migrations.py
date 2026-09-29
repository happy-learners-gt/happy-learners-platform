import pathlib
import sqlite3
import unittest


class UpgradeTests(unittest.TestCase):
    def test_existing_content_survives_additive_migrations(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        for path in migrations[:2]:
            db.executescript(path.read_text())
        before = db.execute("SELECT id,content FROM lessons").fetchall()
        for path in migrations[2:]:
            db.executescript(path.read_text())
        for identifier, content in before:
            self.assertEqual(db.execute("SELECT content,published_content FROM lessons WHERE id=?", (identifier,)).fetchone(), (content, content))
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(db.execute("SELECT count(*) FROM resources WHERE organization_id='org-demo'").fetchone()[0], 3)
        self.assertEqual(db.execute("SELECT count(*) FROM users WHERE username='educador-demo'").fetchone()[0], 1)
        self.assertEqual(db.execute("SELECT revision FROM lessons WHERE id='greetings-and-introductions'").fetchone()[0], 1)
