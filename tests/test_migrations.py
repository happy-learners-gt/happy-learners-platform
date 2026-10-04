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
        self.assertEqual(db.execute("SELECT count(*) FROM material_terms WHERE material_id=?", ("material-light",)).fetchone()[0], 1)
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

    def test_lesson_assignments_are_group_scoped_and_keep_their_publication(self):
        db = self.migrated()
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        # Demo assignments point to a published lesson of the group's own course.
        rows = db.execute("SELECT a.assigned_revision,l.revision,u.course_id,a.course_id FROM lesson_assignments a JOIN lessons l ON l.id=a.lesson_id JOIN learning_units u ON u.id=l.course_unit_id").fetchall()
        self.assertGreater(len(rows), 0)
        self.assertTrue(all(assigned == revision and unit_course == course for assigned, revision, unit_course, course in rows))
        group = db.execute("SELECT id,course_id FROM course_groups WHERE id='group-demo-class'").fetchone()
        lesson = db.execute("SELECT id FROM lessons LIMIT 1").fetchone()[0]
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO lesson_assignments(id,organization_id,course_id,group_id,lesson_id,starts_on,assigned_revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", ("a-cross", "org-other", group[1], group[0], lesson, "2026-10-01", 1, "user-0", "t", "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO lesson_assignments(id,organization_id,course_id,group_id,lesson_id,starts_on,ends_on,assigned_revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", ("a-dates", "org-demo", group[1], group[0], lesson, "2026-10-10", "2026-10-01", 1, "user-0", "t", "t"))

    def test_demo_class_receives_a_published_lesson_once(self):
        db = self.migrated()
        rows = db.execute("SELECT a.group_id,a.assigned_revision,l.revision,l.archived FROM lesson_assignments a JOIN lessons l ON l.id=a.lesson_id WHERE a.id='seed-assignment-demo-class'").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "group-demo-class")
        self.assertEqual(rows[0][1], rows[0][2])
        self.assertEqual(rows[0][3], 0)
        # The demo lesson can be opened by students through its share code.
        self.assertIsNotNone(db.execute("SELECT json_extract(l.published_content,'$.shareCode') FROM lesson_assignments a JOIN lessons l ON l.id=a.lesson_id WHERE a.id='seed-assignment-demo-class'").fetchone()[0])
        # Re-applying the cumulative migration never duplicates the active assignment.
        db.executescript(pathlib.Path("database/migrations/0017_demo_class_assignment.sql").read_text())
        self.assertEqual(db.execute("SELECT count(*) FROM lesson_assignments WHERE group_id='group-demo-class' AND status='active'").fetchone()[0], 1)

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

    def test_curricular_framework_is_course_scoped_and_leaves_lessons_unchanged(self):
        """0012 adds competencies, outcomes and unit planning; lesson bytes stay identical."""
        db = sqlite3.connect(":memory:")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        framework = [path for path in migrations if path.name.startswith("0012_")][0]
        for path in migrations[:migrations.index(framework)]:
            db.executescript(path.read_text())
        before = db.execute("SELECT id,content,published_content,draft_version,revision FROM lessons ORDER BY id").fetchall()
        db.executescript(framework.read_text())
        self.assertEqual(before, db.execute("SELECT id,content,published_content,draft_version,revision FROM lessons ORDER BY id").fetchall())
        self.assertEqual(db.execute("SELECT count(*) FROM course_competencies WHERE course_id='course-exploradores'").fetchone()[0], 2)
        self.assertEqual(db.execute("SELECT id FROM course_outcomes ORDER BY position").fetchall(), [("outcome-exploradores-introduce",), ("outcome-exploradores-understand",), ("outcome-exploradores-colors",)])
        self.assertEqual(db.execute("SELECT count(*) FROM unit_outcomes").fetchone()[0], 2)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_outcomes(id,course_id,organization_id,statement,level,position,updated_at) VALUES(?,?,?,?,?,?,?)", ("outcome-foreign", "course-exploradores", "org-other", "Otra organización", "apply", 3, "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO course_outcomes(id,course_id,organization_id,statement,level,position,updated_at) VALUES(?,?,?,?,?,?,?)", ("outcome-bad-level", "course-exploradores", "org-demo", "Nivel inválido", "memorize", 3, "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO unit_outcomes VALUES(?,?,?)", ("course-exploradores--unit-org-demo", "outcome-missing", "course-exploradores"))
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_academic_model_translates_profiles_and_keeps_behaviour(self):
        """0013 maps each former profile to ISCED dimensions, keeps today's behaviour and scopes programs."""
        db = sqlite3.connect(":memory:")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        academic = [path for path in migrations if path.name.startswith("0013_")][0]
        for path in migrations[:migrations.index(academic)]:
            db.executescript(path.read_text())
        for profile, label in [("university", "Semanas"), ("workshop", "Prácticas"), ("preschool", "Experiencias")]:
            db.execute("INSERT INTO programs(id,organization_id,title) VALUES(?,?,?)", (f"p-{profile}", "org-demo", profile))
            db.execute("INSERT INTO courses(id,organization_id,legacy_program_id,title,profile,unit_label,updated_at) VALUES(?,?,?,?,?,?,?)", (f"course-{profile}", "org-demo", f"p-{profile}", profile, profile, label, "t"))
        db.execute("INSERT INTO course_terms VALUES(?,?,?)", ("course-workshop", "discipline-org-demo-arts", "org-demo"))
        lessons = db.execute("SELECT id,content,published_content FROM lessons ORDER BY id").fetchall()
        db.executescript(academic.read_text())
        rows = {row[0]: row[1:] for row in db.execute("SELECT id,education_type,level,format,modality,pacing,area,settings FROM courses")}
        self.assertEqual(rows["course-exploradores"], ("non-formal", "unspecified", "open-course", "online", "self-paced", "023", '{"attendance":true}'))
        self.assertEqual(rows["course-university"], ("formal", "bachelor", "subject", "hybrid", "scheduled", None, '{"outcomesRequired":false,"assessmentRequired":false,"moduleLabel":"weeks"}'))
        self.assertEqual(rows["course-workshop"], ("non-formal", "unspecified", "workshop", "in-person", "scheduled", "021", "{}"))
        self.assertEqual(rows["course-preschool"][:2], ("formal", "pre-primary"))
        self.assertEqual(lessons, db.execute("SELECT id,content,published_content FROM lessons ORDER BY id").fetchall())
        db.execute("INSERT INTO study_programs(id,organization_id,name,name_key,education_type,level,format,modality,pacing,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", ("program-a", "org-demo", "Primaria", "primaria", "formal", "primary", "subject", "in-person", "scheduled", "t"))
        db.execute("UPDATE courses SET program_id='program-a' WHERE id='course-preschool'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO study_programs(id,organization_id,name,name_key,education_type,level,format,modality,pacing,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", ("program-b", "org-demo", "Sin nivel", "sin nivel", "formal", "unspecified", "subject", "online", "scheduled", "t"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE courses SET settings='not json' WHERE id='course-workshop'")
        orgs = [row[0] for row in db.execute("SELECT id FROM organizations")]
        if len(orgs) > 1:
            other = [org for org in orgs if org != "org-demo"][0]
            db.execute("INSERT INTO study_programs(id,organization_id,name,name_key,education_type,level,format,modality,pacing,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", ("program-other", other, "Ajeno", "ajeno", "non-formal", "unspecified", "open-course", "online", "self-paced", "t"))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE courses SET program_id='program-other' WHERE id='course-workshop'")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def scoped(self, scope):
        """Applies migrations the way each organization's Durable Object does: 0001, then keep only its scope."""
        db = sqlite3.connect(":memory:")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        db.executescript(migrations[0].read_text())
        db.execute("DELETE FROM lessons WHERE program_id IN (SELECT id FROM programs WHERE organization_id<>?)", (scope,))
        db.execute("DELETE FROM programs WHERE organization_id<>?", (scope,))
        db.execute("DELETE FROM memberships WHERE organization_id<>?", (scope,))
        db.execute("DELETE FROM users WHERE id NOT IN (SELECT user_id FROM memberships)")
        db.execute("DELETE FROM organizations WHERE id<>?", (scope,))
        for path in migrations[1:]:
            db.executescript(path.read_text())
        return db

    def test_demo_seed_is_complete_in_the_demo_store_and_absent_elsewhere(self):
        """0014 adds teams and the activity log; 0015 seeds the demo organization only."""
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertGreaterEqual(demo.execute("SELECT count(*) FROM courses WHERE status='active'").fetchone()[0], 6)
        self.assertEqual(demo.execute("SELECT count(*) FROM memberships WHERE role='instructor' AND user_id LIKE 'seed-user-%'").fetchone()[0], 5)
        self.assertEqual(demo.execute("SELECT count(*) FROM courses c WHERE c.status='active' AND NOT EXISTS(SELECT 1 FROM course_members m WHERE m.course_id=c.id AND m.role='lead')").fetchone()[0], 0)
        self.assertGreater(demo.execute("SELECT count(*) FROM attendance_marks").fetchone()[0], 500)
        self.assertGreater(demo.execute("SELECT count(DISTINCT actor_id) FROM activity_events").fetchone()[0], 5)
        # Existing content is untouched: the original demo lessons keep their bytes.
        self.assertEqual(demo.execute("SELECT count(*) FROM lessons WHERE id IN ('colores-en-equipo','greetings-and-introductions')").fetchone()[0], 2)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO course_members VALUES('seed-course-arte','org-demo','seed-user-ana','lead','t')")
        other = self.scoped("org-other")
        self.assertEqual(other.execute("PRAGMA foreign_key_check").fetchall(), [])
        for table in ("study_programs", "course_members", "activity_events", "course_groups"):
            self.assertEqual(other.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0, table)
        self.assertEqual(other.execute("SELECT count(*) FROM users WHERE id LIKE 'seed-%'").fetchone()[0], 0)
