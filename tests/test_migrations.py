import pathlib
import sqlite3
import unittest


class UpgradeTests(unittest.TestCase):
    def migrated(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        for path in sorted(pathlib.Path("database/migrations").glob("*.sql")):
            db.executescript(path.read_text())
        return db

    def test_course_mapping_preserves_every_published_byte(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        for path in migrations[:6]:
            db.executescript(path.read_text())
        before = db.execute("SELECT id,content,published_content,revision FROM lessons ORDER BY id").fetchall()
        resources = db.execute("SELECT * FROM resources ORDER BY id").fetchall()
        db.executescript(migrations[6].read_text())
        self.assertEqual(before, db.execute("SELECT id,content,published_content,revision FROM lessons ORDER BY id").fetchall())
        self.assertEqual(resources, db.execute("SELECT * FROM resources ORDER BY id").fetchall())
        self.assertEqual(db.execute("SELECT count(*) FROM lessons WHERE course_unit_id IS NULL").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT id,title FROM courses").fetchall(), [("course-exploradores", "Exploradores")])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_course_classification_cannot_cross_organization(self):
        db = self.migrated()
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_terms VALUES (?,?,?)", ("course-exploradores", "discipline-org-other-science", "org-demo"))
        self.assertEqual(db.execute("SELECT count(*) FROM course_terms").fetchone()[0], 0)

    def test_generic_material_has_no_english_fields_and_keeps_archived_reference(self):
        db = self.migrated()
        db.execute("INSERT INTO materials(id,course_id,organization_id,title,description,kind,content,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", ("material-light", "course-exploradores", "org-demo", "Luz", "Observar sombras", "text", "Compara dos sombras.", "draft", "2026-09-29T00:00:00Z"))
        db.execute("INSERT INTO material_terms VALUES (?,?,?)", ("material-light", "discipline-org-demo-science", "org-demo"))
        db.execute("UPDATE taxonomy_terms SET status='archived' WHERE id='discipline-org-demo-science'")
        self.assertEqual(db.execute("SELECT count(*) FROM material_terms").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM taxonomy_terms WHERE id='discipline-org-demo-science'")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_attendance_is_course_scoped_and_demo_roster_is_synthetic(self):
        db = self.migrated()
        names = db.execute("SELECT display_name FROM group_learners WHERE group_id='group-demo-class' ORDER BY display_name").fetchall()
        self.assertEqual(len(names), 5)
        self.assertTrue(all(name[0].startswith("Participante de demostración ") for name in names))
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_groups(id,course_id,organization_id,name,created_at) VALUES(?,?,?,?,?)", ("foreign-group", "course-exploradores", "org-other", "Grupo inválido", "2026-09-29T00:00:00Z"))

    def test_office_files_are_private_course_scoped_and_bounded(self):
        db = self.migrated()
        values = ("file-docx", "org-demo", "course-exploradores", "123e4567-e89b-12d3-a456-426614174000", "org-demo/course-exploradores/file-docx", "Guia.docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 128, "a" * 64, "ready", "user-educator", "2026-09-29T00:00:00Z", "2026-09-29T00:00:00Z")
        db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", values)
        self.assertEqual(db.execute("SELECT status,object_key FROM course_files WHERE id='file-docx'").fetchone(), ("ready", "org-demo/course-exploradores/file-docx"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-cross-org", "org-other", "course-exploradores", "123e4567-e89b-12d3-a456-426614174001", "org-other/course/file", "Guia.docx", "docx", values[7], 128, "b" * 64, "ready", "user-educator-demo", values[12], values[13]))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-too-large", *values[1:8], 15 * 1024 * 1024 + 1, *values[9:]))
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

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

    def test_legacy_e2e_records_are_removed_and_curated_content_kept(self):
        """Reproduces the production contamination (HL-44) and applies 0010 on top of 0001-0009."""
        db = sqlite3.connect(":memory:")
        # Same limit as Durable Object SQLite: longer LIKE/GLOB patterns fail at runtime.
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        cleanup = [path for path in migrations if path.name.startswith("0010_")][0]
        for path in migrations:
            if path != cleanup:
                db.executescript(path.read_text())
        suffix = {"desktop": "desktop-1790700257067", "mobile": "mobile-1790700278802"}
        for key, tail in suffix.items():
            db.execute("INSERT INTO levels VALUES (?,?,?,?,?,?,?)", (f"level-{key}", "org-demo", f"Beginner {tail}", "x", 1, "active", "t"))
            db.execute("INSERT INTO units VALUES (?,?,?,?,?,?,?)", (f"unit-{key}", f"level-{key}", f"Greetings {tail}", "x", 0, "active", "t"))
            db.execute("INSERT INTO learning_units(id,course_id,legacy_unit_id,name,objective,position,status,updated_at) VALUES (?,?,?,?,?,?,?,?)", (f"course-exploradores--unit-{key}", "course-exploradores", f"unit-{key}", f"Greetings {tail}", "x", 5, "active", "t"))
            content = '{"title":"Greetings %s","activities":[{"resourceId":"resource-%s"}]}' % (tail, key)
            db.execute("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,published_content,revision) VALUES (?,?,?,?,?,?,?,?)", (f"lesson-{key}", "exploradores", "published", content, f"unit-{key}", f"course-exploradores--unit-{key}", content, 2))
            db.execute("INSERT INTO lesson_completions VALUES (?,?,?)", (f"completion-{key}", f"lesson-{key}", 1))
            db.execute("INSERT INTO resources(id,organization_id,title,description,level,skill,topic,tags,content,status) VALUES (?,?,?,?,?,?,?,?,?,?)", (f"resource-{key}", "org-demo", f"Hello {tail}", "x", "B", "lectura", "t", "[]", "x", "draft"))
        # Human content that merely contains digits must survive.
        db.execute("INSERT INTO resources(id,organization_id,title,description,level,skill,topic,tags,content,status) VALUES (?,?,?,?,?,?,?,?,?,?)", ("resource-human", "org-demo", "Agenda 2026 desktop", "x", "B", "lectura", "t", "[]", "x", "draft"))
        before = db.execute("SELECT id,content,published_content FROM lessons WHERE id IN ('greetings-and-introductions','colores-en-equipo') ORDER BY id").fetchall()
        db.executescript(cleanup.read_text())
        for table, column in [("levels", "name"), ("units", "name"), ("learning_units", "name"), ("resources", "title"), ("lessons", "json_extract(content,'$.title')")]:
            self.assertEqual(db.execute(f"SELECT count(*) FROM {table} WHERE {column} LIKE '% desktop-%' OR {column} LIKE '% mobile-%'").fetchone()[0], 0, table)
        self.assertEqual(db.execute("SELECT count(*) FROM lesson_completions WHERE id LIKE 'completion-%'").fetchone()[0], 0)
        self.assertEqual(before, db.execute("SELECT id,content,published_content FROM lessons WHERE id IN ('greetings-and-introductions','colores-en-equipo') ORDER BY id").fetchall())
        self.assertEqual(db.execute("SELECT count(*) FROM resources WHERE id='resource-human'").fetchone()[0], 1)
        self.assertEqual(db.execute("SELECT name,position FROM learning_units WHERE course_id='course-exploradores' ORDER BY position").fetchall(), [("Greetings", 0)])
        self.assertEqual(db.execute("SELECT name FROM levels WHERE organization_id='org-demo'").fetchall(), [("Beginner",)])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_pdf_and_video_files_keep_existing_rows(self):
        """0011 rebuilds course_files: earlier rows survive byte for byte and PDF/video are accepted."""
        db = sqlite3.connect(":memory:")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        rebuild = [path for path in migrations if path.name.startswith("0011_")][0]
        for path in migrations[:migrations.index(rebuild)]:
            db.executescript(path.read_text())
        office = ("file-docx", "org-demo", "course-exploradores", "123e4567-e89b-12d3-a456-426614174000", "org-demo/course-exploradores/file-docx", "Guia.docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 128, "a" * 64, "ready", "user-1", "t", "t")
        db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", office)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("early-pdf", *office[1:3], "123e4567-e89b-12d3-a456-426614174009", "k-early", "Guia.pdf", "pdf", "application/pdf", 128, "b" * 64, "ready", "user-1", "t", "t"))
        db.executescript(rebuild.read_text())
        self.assertEqual(db.execute("SELECT * FROM course_files").fetchall(), [office])
        db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-pdf", *office[1:3], "123e4567-e89b-12d3-a456-426614174001", "k-pdf", "Guia.pdf", "pdf", "application/pdf", 25 * 1024 * 1024, "c" * 64, "ready", "user-1", "t", "t"))
        db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-mp4", *office[1:3], "123e4567-e89b-12d3-a456-426614174002", "k-mp4", "Clase.mp4", "mp4", "video/mp4", 100 * 1024 * 1024, "d" * 64, "ready", "user-1", "t", "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-big", *office[1:3], "123e4567-e89b-12d3-a456-426614174003", "k-big", "Clase.webm", "webm", "video/webm", 100 * 1024 * 1024 + 1, "e" * 64, "ready", "user-1", "t", "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("file-exe", *office[1:3], "123e4567-e89b-12d3-a456-426614174004", "k-exe", "x.exe", "exe", "application/octet-stream", 10, "f" * 64, "ready", "user-1", "t", "t"))
        self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='course_files' AND name='course_files_course'").fetchall(), [("course_files_course",)])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

