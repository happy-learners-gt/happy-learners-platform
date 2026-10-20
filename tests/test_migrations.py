import json
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
        for path in migrations[2:28]:
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
            db.execute("INSERT INTO lesson_completions(id,lesson_id,completed_at) VALUES (?,?,?)", (f"completion-{key}", f"lesson-{key}", 1))
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

    def scoped(self, scope, until=None):
        """Applies migrations the way each organization's Durable Object does: 0001, then keep only its scope.
        `until` stops after that migration number, for checks written against the store of that release."""
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
        db.execute("INSERT OR IGNORE INTO organizations(id,name,configured) VALUES (?,NULL,0)", (scope,))
        for path in migrations[1:until]:
            db.executescript(path.read_text())
        return db

    def test_demo_seed_is_complete_in_the_demo_store_and_absent_elsewhere(self):
        """0014 adds teams and the activity log; 0015 seeds the demo organization only."""
        demo = self.scoped("org-demo", until=28)
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

    def test_class_planning_backfills_taught_classes_and_plans_the_demo(self):
        """0018: classes with marks become taught, the demo gets upcoming classes with lessons and resources."""
        demo = self.scoped("org-demo", until=28)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions s WHERE EXISTS(SELECT 1 FROM attendance_marks m WHERE m.session_id=s.id) AND (s.status<>'completed' OR s.taught_by IS NULL OR s.completed_at IS NULL)").fetchone()[0], 0)
        planned = demo.execute("SELECT count(*), min(session_date), count(starts_at), count(lesson_id) FROM class_sessions WHERE status='planned'").fetchone()
        self.assertGreater(planned[0], 50)
        self.assertGreaterEqual(demo.execute("SELECT min(session_date) FROM class_sessions WHERE id LIKE 'seed-plan-%'").fetchone()[0], "2026-10-09")
        self.assertEqual(planned[0], planned[2])
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions s WHERE status='planned' AND NOT EXISTS(SELECT 1 FROM class_session_resources r WHERE r.session_id=s.id)").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM course_groups WHERE status='active' AND access_code IS NULL").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT access_code FROM course_groups WHERE id='seed-group-mat-3a'").fetchone()[0], "DG-MATE-3A")
        self.assertEqual(demo.execute("SELECT name FROM organizations").fetchone()[0], "Colegio Horizonte (demostración)")
        self.assertIsNone(demo.execute("SELECT name FROM sqlite_master WHERE name='demo_schedule'").fetchone())
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE class_sessions SET status='done' WHERE id=(SELECT id FROM class_sessions LIMIT 1)")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE course_groups SET access_code='DG-MATE-3A' WHERE id='seed-group-mat-3b'")
        other = self.scoped("org-other")
        self.assertEqual(other.execute("SELECT count(*) FROM class_sessions").fetchone()[0], 0)
        self.assertEqual(other.execute("SELECT count(*) FROM class_session_resources").fetchone()[0], 0)

    def test_section_schedule_comes_from_the_demo_classes_and_lessons_follow_content_order(self):
        """0019: each demo section gets the weekly schedule of its classes; their lessons follow the course content."""
        demo = self.scoped("org-demo", until=28)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(demo.execute("SELECT schedule_weekdays,schedule_starts_at,schedule_duration,schedule_from,schedule_until FROM course_groups WHERE id='seed-group-mat-3a'").fetchone(), ("1,3", "08:00", 45, "2026-10-12", "2026-11-25"))
        self.assertEqual(demo.execute("SELECT schedule_weekdays FROM course_groups WHERE id='seed-group-art-k2'").fetchone()[0], "1,3,5")
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions WHERE id LIKE 'seed-plan-%' AND origin<>'schedule'").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions WHERE id NOT LIKE 'seed-plan-%' AND origin<>'manual'").fetchone()[0], 0)
        ordered = [row[0] for row in demo.execute("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id='seed-course-matematicas' AND u.status='active' AND l.archived=0 AND l.revision>0 ORDER BY u.position,l.position,l.id")]
        given = [row[0] for row in demo.execute("SELECT lesson_id FROM class_sessions WHERE group_id='seed-group-mat-3a' AND origin='schedule' ORDER BY session_date")]
        self.assertEqual(given[:len(ordered)], ordered)
        self.assertTrue(all(lesson is None for lesson in given[len(ordered):]))
        # Every generated class still points at a lesson of its own course, and v0.8.3 tables stay for a rollback.
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions s JOIN lessons l ON l.id=s.lesson_id JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id<>s.course_id").fetchone()[0], 0)
        for table in ("lesson_assignments", "class_session_resources"):
            self.assertIsNotNone(demo.execute("SELECT name FROM sqlite_master WHERE name=?", (table,)).fetchone())
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE class_sessions SET origin='imported' WHERE id=(SELECT id FROM class_sessions LIMIT 1)")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE course_groups SET schedule_duration=2 WHERE id='seed-group-mat-3a'")
        other = self.scoped("org-other")
        self.assertEqual(other.execute("SELECT count(*) FROM course_groups WHERE schedule_weekdays IS NOT NULL").fetchone()[0], 0)

    def test_class_lessons_keep_each_planned_lesson_and_its_publication(self):
        """0020: every class with a lesson keeps it as its first lesson; a class can hold several, once each."""
        demo = self.scoped("org-demo", until=28)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions WHERE lesson_id IS NOT NULL").fetchone()[0], demo.execute("SELECT count(*) FROM class_session_lessons").fetchone()[0])
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions s LEFT JOIN class_session_lessons p ON p.session_id=s.id AND p.position=0 WHERE s.lesson_id IS NOT NULL AND (p.lesson_id IS NOT s.lesson_id OR p.revision IS NOT s.lesson_revision)").fetchone()[0], 0)
        session, first, second = demo.execute("SELECT s.id,p.lesson_id,(SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=s.course_id AND l.id<>p.lesson_id LIMIT 1) FROM class_sessions s JOIN class_session_lessons p ON p.session_id=s.id WHERE s.status='planned' LIMIT 1").fetchone()
        demo.execute("INSERT INTO class_session_lessons(session_id,lesson_id,position) VALUES (?,?,1)", (session, second))
        for row in ((session, first, 2), (session, "missing-lesson", 3)):
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute("INSERT INTO class_session_lessons(session_id,lesson_id,position) VALUES (?,?,?)", row)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO class_session_lessons(session_id,lesson_id,position) VALUES (?,?,6)", (session, "seed-lesson-x"))
        other = self.scoped("org-other")
        self.assertEqual(other.execute("SELECT count(*) FROM class_session_lessons").fetchone()[0], 0)

    def test_roles_keep_every_team_member_on_every_section_and_one_open_review(self):
        """0021: team members keep teaching every section of their course; a lesson has one pending review at most."""
        demo = self.scoped("org-demo", until=28)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        expected = demo.execute("SELECT g.id,m.user_id FROM course_groups g JOIN course_members m ON m.course_id=g.course_id ORDER BY 1,2").fetchall()
        self.assertTrue(expected)
        self.assertEqual(demo.execute("SELECT group_id,user_id FROM section_educators ORDER BY 1,2").fetchall(), expected)
        self.assertEqual({row[0] for row in demo.execute("SELECT user_id FROM section_educators WHERE group_id='seed-group-mat-3a'")}, {row[0] for row in demo.execute("SELECT user_id FROM course_members WHERE course_id='seed-course-matematicas'")})
        # Saving a team rewrites its rows in one transaction; only a section educator left off the team is rejected.
        group, user, course = demo.execute("SELECT group_id,user_id,course_id FROM section_educators LIMIT 1").fetchone()
        role, added = demo.execute("SELECT role,added_at FROM course_members WHERE course_id=? AND user_id=?", (course, user)).fetchone()
        demo.execute("DELETE FROM course_members WHERE course_id=? AND user_id=?", (course, user))
        demo.execute("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,?,?)", (course, "org-demo", user, role, added))
        demo.commit()
        demo.execute("DELETE FROM course_members WHERE course_id=? AND user_id=?", (course, user))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.commit()
        demo.rollback()
        lesson = demo.execute("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? LIMIT 1", (course,)).fetchone()[0]
        insert = "INSERT INTO lesson_reviews(id,lesson_id,course_id,organization_id,status,requested_by,requested_at) VALUES (?,?,?,?,?,?,?)"
        demo.execute(insert, ("review-1", lesson, course, "org-demo", "pending", user, "2026-10-05T00:00:00Z"))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute(insert, ("review-2", lesson, course, "org-demo", "pending", user, "2026-10-05T00:01:00Z"))
        demo.execute("UPDATE lesson_reviews SET status='returned' WHERE id='review-1'")
        demo.execute(insert, ("review-2", lesson, course, "org-demo", "pending", user, "2026-10-05T00:01:00Z"))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO lesson_reviews(id,lesson_id,course_id,organization_id,status,note,requested_by,requested_at) VALUES (?,?,?,?,?,?,?,?)", ("review-3", lesson, course, "org-demo", "returned", "x" * 601, user, "2026-10-05T00:02:00Z"))
        self.assertEqual(self.scoped("org-other").execute("SELECT count(*) FROM section_educators").fetchone()[0], 0)

    def test_section_activity_and_openings_belong_to_their_section(self):
        """0022: the activity of a section and of its classes is the section's own; openings start without a section."""
        demo = self.scoped("org-demo", until=28)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        scoped = demo.execute("SELECT count(*) FROM activity_events WHERE group_id IS NOT NULL").fetchone()[0]
        self.assertGreater(scoped, 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM activity_events e JOIN course_groups g ON g.id=e.target_id WHERE e.target_type='group' AND e.group_id IS NOT g.id").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM activity_events e JOIN class_sessions s ON s.id=e.target_id WHERE e.target_type='session' AND e.group_id IS NOT s.group_id").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM activity_events WHERE target_type NOT IN ('group','session') AND group_id IS NOT NULL").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM lesson_completions WHERE group_id IS NOT NULL").fetchone()[0], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO lesson_completions(id,lesson_id,completed_at,group_id) VALUES ('c-x',(SELECT id FROM lessons LIMIT 1),1,'missing-group')")
        self.assertEqual(self.scoped("org-other").execute("SELECT count(*) FROM activity_events WHERE group_id IS NOT NULL").fetchone()[0], 0)

    def test_class_planning_keeps_a_renamed_organization(self):
        db = sqlite3.connect(":memory:")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        for path in migrations:
            if path.name.startswith("0018_"):
                db.execute("UPDATE organizations SET name='Colegio Real' WHERE id='org-demo'")
            db.executescript(path.read_text())
        self.assertEqual(db.execute("SELECT name FROM organizations WHERE id='org-demo'").fetchone()[0], "Colegio Real")

    def test_finished_classes_covered_their_lessons_and_breaks_belong_to_the_organization(self):
        """0023: classes finished before DEC-026 completed every lesson; days without class need a valid range."""
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertGreater(demo.execute("SELECT count(*) FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.status='completed'").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.status='completed' AND p.outcome IS NOT 'completed'").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.status<>'completed' AND p.outcome IS NOT NULL").fetchone()[0], 0)
        insert = "INSERT INTO calendar_breaks(id,organization_id,group_id,title,starts_on,ends_on,created_at) VALUES (?,?,?,?,?,?,?)"
        demo.execute(insert, ("break-1", "org-demo", None, "Vacaciones", "2026-10-26", "2026-10-30", "2026-10-05T00:00:00Z"))
        for values in [("break-2", "org-demo", None, "Al revés", "2026-10-30", "2026-10-26", "x"), ("break-3", "org-demo", None, "", "2026-10-26", "2026-10-26", "x"), ("break-4", "org-demo", "missing-group", "Asueto", "2026-10-26", "2026-10-26", "x")]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE class_session_lessons SET outcome='skipped' WHERE rowid=(SELECT min(rowid) FROM class_session_lessons)")

    def test_courses_with_classes_keep_their_calendar_and_progress_belongs_to_a_student(self):
        """0024: a course or program that already holds classes is scheduled; progress needs a student and a lesson."""
        for scope in ["org-demo", "org-other"]:
            db = self.scoped(scope)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("SELECT count(*) FROM courses c LEFT JOIN study_programs p ON p.id=c.program_id WHERE COALESCE(p.pacing,c.pacing)='self-paced' AND EXISTS(SELECT 1 FROM class_sessions s WHERE s.course_id=c.id)").fetchone()[0], 0)
        demo = self.scoped("org-demo")
        learner, group, lesson = demo.execute("SELECT gl.id,gl.group_id,(SELECT l.id FROM lessons l LIMIT 1) FROM group_learners gl LIMIT 1").fetchone()
        insert = "INSERT INTO learner_progress(organization_id,group_id,learner_id,lesson_id,opened_at,completed_at) VALUES (?,?,?,?,?,?)"
        demo.execute(insert, ("org-demo", group, learner, lesson, "2026-10-05T10:00:00Z", "2026-10-05T10:20:00Z"))
        for values in [("org-demo", group, learner, lesson, "2026-10-05T10:00:00Z", None), ("org-demo", group, "missing", lesson, "2026-10-05T10:00:00Z", None), ("org-demo", group, learner, "missing", "t", None)]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE learner_progress SET completed_at='2026-10-04T00:00:00Z'")

    def test_work_groups_belong_to_a_section_and_have_distinct_names(self):
        """0025: a work group lives in a section, its members are students and activities point to existing groups."""
        demo = self.scoped("org-demo")
        group, course, learner = demo.execute("SELECT g.id,g.course_id,(SELECT id FROM group_learners WHERE group_id=g.id LIMIT 1) FROM course_groups g WHERE EXISTS(SELECT 1 FROM group_learners WHERE group_id=g.id) LIMIT 1").fetchone()
        lesson = demo.execute("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? LIMIT 1", (course,)).fetchone()[0]
        insert = "INSERT INTO work_groups(id,organization_id,course_id,group_id,name,created_at) VALUES (?,?,?,?,?,?)"
        demo.execute(insert, ("wg-1", "org-demo", course, group, "Equipo Azul", "2026-10-05T10:00:00Z"))
        demo.execute("INSERT INTO work_group_members VALUES (?,?)", ("wg-1", learner))
        demo.execute("INSERT INTO activity_work_groups VALUES (?,?,?,?,?)", ("org-demo", group, lesson, "activity-1", "wg-1"))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute(insert, ("wg-2", "org-demo", course, group, "equipo azul", "2026-10-05T10:00:00Z"))
        for statement, values in [("INSERT INTO work_group_members VALUES (?,?)", ("wg-1", "missing")), ("INSERT INTO activity_work_groups VALUES (?,?,?,?,?)", ("org-demo", group, lesson, "activity-1", "missing")), (insert, ("wg-3", "org-demo", course, "missing", "Equipo Rojo", "t"))]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(statement, values)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_a_course_cannot_require_itself_or_a_missing_course(self):
        """0026: prerequisites link two existing courses and never a course with itself."""
        demo = self.scoped("org-demo")
        first, second = [row[0] for row in demo.execute("SELECT id FROM courses ORDER BY id LIMIT 2").fetchall()]
        insert = "INSERT INTO course_prerequisites VALUES (?,?,?)"
        demo.execute(insert, ("org-demo", second, first))
        for values in [("org-demo", first, first), ("org-demo", first, "missing"), ("org-demo", second, first)]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, values)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_each_organization_has_its_own_administration(self):
        """0027 (DEC-032): Happy Learners starts with its administration and two educators; the external organization gets its administration."""
        hl = self.scoped("org-hl")
        self.assertEqual(hl.execute("SELECT name,timezone,configured FROM organizations").fetchall(), [("Happy Learners", "America/Guatemala", 1)])
        self.assertEqual(hl.execute("SELECT u.username,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id='org-hl' ORDER BY u.username").fetchall(),
                         [("admin-hl", "admin"), ("docente1-hl", "instructor"), ("docente2-hl", "instructor")])
        self.assertEqual(hl.execute("SELECT count(*) FROM courses").fetchone()[0], 0)
        self.assertEqual(hl.execute("SELECT count(*) FROM users WHERE id NOT LIKE 'hl-%'").fetchone()[0], 0)
        self.assertEqual(hl.execute("PRAGMA foreign_key_check").fetchall(), [])
        other = self.scoped("org-other")
        self.assertIn(("admin-externo", "admin"), other.execute("SELECT u.username,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id='org-other'").fetchall())
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("SELECT count(*) FROM users WHERE username IN ('admin-hl','docente1-hl','docente2-hl','admin-externo')").fetchone()[0], 0)

    def test_demo_programs_read_as_paths(self):
        """0028 (DEC-033): three demo programs whose courses each require the previous one; other organizations get none."""
        demo = self.scoped("org-demo")
        paths = demo.execute("SELECT c.program_id, count(*), count(p.course_id) FROM courses c LEFT JOIN course_prerequisites p ON p.course_id=c.id WHERE c.program_id IN ('seed-program-lectura','seed-program-programacion','seed-program-musica') GROUP BY c.program_id ORDER BY c.program_id").fetchall()
        self.assertEqual(paths, [("seed-program-lectura", 4, 3), ("seed-program-musica", 3, 2), ("seed-program-programacion", 4, 3)])
        self.assertEqual(demo.execute("SELECT count(*) FROM course_prerequisites p JOIN courses a ON a.id=p.course_id JOIN courses b ON b.id=p.required_course_id WHERE a.program_id IS NOT b.program_id").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM lessons WHERE program_id LIKE 'seed-course-%-_' AND status<>'published'").fetchone()[0], 0)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        for scope in ["org-other", "org-hl"]:
            self.assertEqual(self.scoped(scope).execute("SELECT count(*) FROM study_programs WHERE id LIKE 'seed-program-%'").fetchone()[0], 0)

    def test_lesson_time_follows_its_activities_and_conflicts_are_recorded(self):
        """0029 (DEC-035): a lesson whose duration differs from its activities takes their sum; the rest stay byte for byte."""
        demo = self.scoped("org-demo", until=28)
        before = dict(demo.execute("SELECT id,content FROM lessons").fetchall())
        demo.executescript(sorted(pathlib.Path("database/migrations").glob("*.sql"))[28].read_text())
        total = "(SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each({0},'$.activities') a)"
        self.assertEqual(demo.execute(f"SELECT count(*) FROM lessons WHERE {total.format('content')}>0 AND json_extract(content,'$.duration')<>{total.format('content')}").fetchone()[0], 0)
        self.assertEqual(demo.execute(f"SELECT count(*) FROM lessons WHERE published_content IS NOT NULL AND {total.format('published_content')}>0 AND json_extract(published_content,'$.duration')<>{total.format('published_content')}").fetchone()[0], 0)
        changed = [identifier for identifier, content in demo.execute("SELECT id,content FROM lessons").fetchall() if content != before[identifier]]
        self.assertEqual(sorted(changed), ["seed-les-art-5", "seed-les-cie-4", "seed-les-eng-2", "seed-les-rob-4"])
        self.assertEqual(demo.execute("SELECT json_extract(content,'$.duration') FROM lessons WHERE id='seed-les-lectura-1-1'").fetchone()[0], 35)
        insert = "INSERT INTO educator_conflict_overrides VALUES (?,?,?,?,?,?,?,?,?,?)"
        demo.execute(insert, ("c1", "org-demo", "seed-group-mat-3a", "seed-user-lucia", "seed-group-mat-3b", 3, "2026-10-12", "Comparten aula", "seed-user-marta", "2026-10-06T12:00:00Z"))
        for reason, overlaps in [("no", 1), ("Comparten aula", 0)]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, ("c2", "org-demo", "seed-group-mat-3a", "seed-user-lucia", "seed-group-mat-3b", overlaps, "2026-10-12", reason, "seed-user-marta", "2026-10-06T12:00:00Z"))
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_english_program_goes_from_a1_to_c2_with_scheduled_sections(self):
        """0030 (DEC-035): six English levels, each requiring the previous one, each with a scheduled and planned section."""
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])
        levels = demo.execute("SELECT c.id,(SELECT group_concat(p.required_course_id) FROM course_prerequisites p WHERE p.course_id=c.id) FROM courses c WHERE c.program_id='seed-program-ingles-mcer' ORDER BY c.id").fetchall()
        codes = ["a1", "a2", "b1", "b2", "c1", "c2"]
        self.assertEqual(levels, [(f"seed-course-ingles-{code}", f"seed-course-ingles-{codes[index - 1]}" if index else None) for index, code in enumerate(codes)])
        self.assertEqual(demo.execute("SELECT count(*) FROM course_groups WHERE course_id LIKE 'seed-course-ingles-%' AND schedule_weekdays IS NOT NULL").fetchone()[0], 6)
        self.assertEqual(demo.execute("SELECT count(*) FROM course_groups g WHERE g.course_id LIKE 'seed-course-ingles-%' AND NOT EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id)").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions WHERE group_id LIKE 'seed-group-ingles-%' AND (origin<>'schedule' OR status<>'planned' OR starts_at IS NULL OR duration_minutes IS NULL)").fetchone()[0], 0)
        first = demo.execute("SELECT s.duration_minutes,sum(json_extract(l.content,'$.duration')) FROM class_sessions s JOIN class_session_lessons cl ON cl.session_id=s.id JOIN lessons l ON l.id=cl.lesson_id WHERE s.id='seed-group-ingles-a1-s01'").fetchone()
        self.assertEqual(first, (60, 80))
        self.assertEqual(demo.execute("SELECT count(*) FROM users WHERE username='tomas.aguilar'").fetchone()[0], 1)
        for scope in ["org-other", "org-hl"]:
            self.assertEqual(self.scoped(scope).execute("SELECT count(*) FROM courses WHERE id LIKE 'seed-course-ingles-%'").fetchone()[0], 0)

    def test_team_accounts_keep_every_activity_event_and_accept_account_changes(self):
        """0031 (ST-093): existing accounts keep their password; the activity is rebuilt row for row and admits account events."""
        before = self.scoped("org-demo", until=30)
        events = before.execute("SELECT * FROM activity_events ORDER BY id").fetchall()
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events ORDER BY id").fetchall(), events)
        self.assertEqual(demo.execute("SELECT count(*) FROM users WHERE must_change_password<>0").fetchone()[0], 0)
        self.assertEqual(sorted(row[0] for row in demo.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity_events' AND sql IS NOT NULL")),
                         ["activity_events_actor", "activity_events_course", "activity_events_group", "activity_events_organization"])
        demo.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e-reset','org-demo','user-0','reset','account','user-1','Restableció la contraseña','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e-bad','org-demo','user-0','deleted','account','user-1','x','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE users SET must_change_password=2 WHERE id='user-1'")
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_departures_record_a_date_and_keep_every_account(self):
        """0035 (ST-123): a departure is its own row; users, memberships and activity stay as they were."""
        before = self.scoped("org-demo", until=-1)
        demo = self.scoped("org-demo")
        for table in ["users", "memberships", "activity_events", "course_members", "section_educators"]:
            self.assertEqual(demo.execute(f"SELECT count(*) FROM {table}").fetchone(), before.execute(f"SELECT count(*) FROM {table}").fetchone(), table)
        self.assertEqual(demo.execute("SELECT count(*) FROM departures").fetchone()[0], 0)
        demo.execute("INSERT INTO departures(id,organization_id,user_id,departed_on,reason,recorded_by,recorded_at) VALUES ('d1','org-demo','seed-user-diego','2026-09-30','','user-0','t')")
        for values in [("d2", "seed-user-diego", "30/09/2026", ""), ("d3", "seed-user-diego", "2026-09-30", "x" * 301), ("d4", "user-missing", "2026-09-30", "")]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute("INSERT INTO departures(id,organization_id,user_id,departed_on,reason,recorded_by,recorded_at) VALUES (?,'org-demo',?,?,?,'user-0','t')", values)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_access_matrix_never_stores_administration_permissions(self):
        """0036 (ST-128, ST-135): coordination scopes, security groups and their audit; groups only hold grantable permissions."""
        demo = self.scoped("org-demo")
        demo.execute("INSERT INTO coordination_scopes(user_id,organization_id,program_id,assigned_by,assigned_at) VALUES ('user-1','org-demo','seed-program-primaria','user-0','t')")
        demo.execute("INSERT INTO coordination_scopes(user_id,organization_id,program_id,assigned_by,assigned_at) VALUES ('user-1','org-demo','*','user-0','t')")
        demo.execute("INSERT INTO security_groups(id,organization_id,name,name_key,description,created_at,updated_at) VALUES ('g1','org-demo','Lectura','lectura','','t','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO security_groups(id,organization_id,name,name_key,description,created_at,updated_at) VALUES ('g2','org-demo','LECTURA','lectura','','t','t')")
        demo.execute("INSERT INTO security_group_grants(group_id,organization_id,permission,program_id) VALUES ('g1','org-demo','activity.view','*')")
        for permission in ["backup.manage", "accounts.manage", "access.manage", "legal.manage", "organization.configure", "anything"]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute("INSERT INTO security_group_grants(group_id,organization_id,permission,program_id) VALUES ('g1','org-demo',?,'*')", (permission,))
        demo.execute("INSERT INTO security_group_members(group_id,user_id,organization_id,added_by,added_at) VALUES ('g1','seed-user-tomas','org-demo','user-0','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO security_group_members(group_id,user_id,organization_id,added_by,added_at) VALUES ('g1','user-missing','org-demo','user-0','t')")
        demo.execute("INSERT INTO access_events(id,organization_id,actor_id,action,subject_type,subject_id,summary,occurred_at) VALUES ('a1','org-demo','user-0','created','group','g1','Creó el grupo','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO access_events(id,organization_id,actor_id,action,subject_type,subject_id,summary,occurred_at) VALUES ('a2','org-demo','user-0','created','account','g1','x','t')")
        demo.execute("DELETE FROM security_groups WHERE id='g1'")
        self.assertEqual(demo.execute("SELECT count(*) FROM security_group_grants").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM security_group_members").fetchone()[0], 0)
        self.assertEqual(demo.execute("SELECT count(*) FROM access_events").fetchone()[0], 1)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_later_activity_rebuilds_keep_account_events(self):
        """0031 admits account events and 0032 rebuilds the log again: an account event written in between survives."""
        db = self.scoped("org-demo", until=31)
        db.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e-reset','org-demo','user-0','reset','account','user-1','Restableció la contraseña','t')")
        for path in sorted(pathlib.Path("database/migrations").glob("*.sql"))[31:]:
            db.executescript(path.read_text())
        self.assertEqual(db.execute("SELECT action,target_type FROM activity_events WHERE id='e-reset'").fetchone(), ("reset", "account"))
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_legal_versions_and_acceptances_are_kept(self):
        """0032 (ST-126, ST-127): published versions never change, acceptances only record their withdrawal, the log keeps its rows."""
        db = self.migrated()
        self.assertEqual(db.execute("SELECT count(*) FROM legal_documents").fetchone()[0], 0)
        self.assertGreater(db.execute("SELECT count(*) FROM activity_events").fetchone()[0], 0)
        db.execute("INSERT INTO legal_documents(id,organization_id,kind,status,title,body,consent,updated_by,updated_at) VALUES ('p','org-demo','privacy','draft','Privacidad','Texto ficticio de la política.','Doy mi consentimiento.','user-0','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a0','org-demo','p','user-0','t')")
        db.execute("UPDATE legal_documents SET status='published',version=1,published_by='user-0',published_at='t' WHERE id='p'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE legal_documents SET title='Cambiada' WHERE id='p'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM legal_documents WHERE id='p'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO legal_documents(id,organization_id,kind,status,title,body,updated_by,updated_at) VALUES ('q','org-demo','privacy','draft','Sin consentimiento','Texto ficticio de la política.','user-0','t')")
        db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a1','org-demo','p','user-0','2026-10-01')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a2','org-demo','p','user-0','2026-10-02')")
        db.execute("UPDATE legal_acceptances SET withdrawn_at='2026-10-03' WHERE id='a1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE legal_acceptances SET withdrawn_at='2026-10-04' WHERE id='a1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM legal_acceptances WHERE id='a1'")
        db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a3','org-demo','p','user-0','2026-10-05')")
        db.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e','org-demo','user-0','withdrawn','legal','p','Retiró su consentimiento','t')")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_signatures_rebuild_keeps_every_legal_row_and_trigger(self):
        """0038 (ST-151, ST-153): legal_documents admits 'volunteer' and is rebuilt with legal_acceptances; inside one
        transaction with foreign keys on, as a Durable Object applies it, every row stays byte-identical, the indexes
        and triggers are recreated as 0032 wrote them and published versions stay immutable; signatures are kept."""
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        position = [path.name[:4] for path in migrations].index("0038")
        db = self.scoped("org-demo", until=position)
        db.isolation_level = None
        insert = "INSERT INTO legal_documents(id,organization_id,kind,status,title,body,consent,updated_by,updated_at) VALUES (?,'org-demo',?,'draft',?,?,?,'user-0',?)"
        db.execute(insert, ("t1", "terms", "Términos ñ «uno»", "Texto ficticio de los términos.\n\nSegundo párrafo con acentos: áéíóú.", None, "2026-10-01T00:00:00.000Z"))
        db.execute(insert, ("p1", "privacy", "Privacidad", "Texto ficticio de la política de privacidad.", "Doy mi consentimiento informado.", "2026-10-01T00:00:01.000Z"))
        db.execute("UPDATE legal_documents SET status='published',version=1,published_by='user-0',published_at='2026-10-02T00:00:00.000Z' WHERE id IN ('t1','p1')")
        db.execute(insert, ("t2", "terms", "Borrador", "Borrador ficticio de los términos.", None, "2026-10-03T00:00:00.000Z"))
        db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a1','org-demo','t1','user-0','2026-10-04T00:00:00.000Z'),('a2','org-demo','p1','user-0','2026-10-04T00:00:00.000Z')")
        db.execute("UPDATE legal_acceptances SET withdrawn_at='2026-10-05T00:00:00.000Z' WHERE id='a2'")
        rows = lambda table: db.execute(f"SELECT hex(CAST(quote(id) AS BLOB)),* FROM {table} ORDER BY id").fetchall()
        schema = lambda: db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name IN ('legal_documents','legal_acceptances') ORDER BY name").fetchall()
        documents, acceptances, before = rows("legal_documents"), rows("legal_acceptances"), schema()
        dump = lambda table: [tuple(value.hex() if isinstance(value, bytes) else value for value in row) for row in db.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()]
        raw = {table: db.execute(f"SELECT group_concat(hex(CAST(id AS BLOB))||hex(CAST(organization_id AS BLOB))||hex(CAST(kind AS BLOB))||hex(CAST(title AS BLOB))||hex(CAST(body AS BLOB))||ifnull(hex(CAST(consent AS BLOB)),'-')||ifnull(published_at,'-'),'|') FROM (SELECT * FROM {table} ORDER BY id)").fetchone() for table in ["legal_documents"]}
        db.executescript("BEGIN;\n" + migrations[position].read_text() + "\nCOMMIT;")
        self.assertEqual(rows("legal_documents"), documents)
        self.assertEqual(rows("legal_acceptances"), acceptances)
        self.assertEqual(db.execute("SELECT group_concat(hex(CAST(id AS BLOB))||hex(CAST(organization_id AS BLOB))||hex(CAST(kind AS BLOB))||hex(CAST(title AS BLOB))||hex(CAST(body AS BLOB))||ifnull(hex(CAST(consent AS BLOB)),'-')||ifnull(published_at,'-'),'|') FROM (SELECT * FROM legal_documents ORDER BY id)").fetchone(), raw["legal_documents"])
        self.assertEqual(dump("legal_acceptances"), [tuple(row[1:]) for row in acceptances])
        self.assertEqual(schema(), before)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertIn('REFERENCES "legal_documents"(id)', db.execute("SELECT sql FROM sqlite_master WHERE name='legal_acceptances'").fetchone()[0])
        # Published versions and acceptances keep their protection.
        for statement in ["UPDATE legal_documents SET title='Cambiada' WHERE id='t1'", "DELETE FROM legal_documents WHERE id='t1'", "DELETE FROM legal_acceptances WHERE id='a1'",
                          "UPDATE legal_acceptances SET withdrawn_at='2026-10-06' WHERE id='a2'",
                          "INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a3','org-demo','t2','user-0','t')",
                          "INSERT INTO legal_documents(id,organization_id,kind,status,title,body,updated_by,updated_at) VALUES ('x','org-demo','other','draft','Otro','Texto ficticio de otro documento.','user-0','t')"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        db.execute("UPDATE legal_documents SET title='Borrador editado' WHERE id='t2'")
        db.execute(insert, ("v1", "volunteer", "Acuerdo de voluntariado", "Texto ficticio del acuerdo de voluntariado ad honorem.", None, "t"))
        db.execute("UPDATE legal_documents SET status='published',version=1,published_by='user-0',published_at='t' WHERE id='v1'")
        db.execute("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) VALUES ('a4','org-demo','v1','user-0','2026-10-07')")
        # A signature belongs to an acceptance of the terms or the agreement by the same person, and is never changed.
        sign = "INSERT INTO legal_signatures(id,organization_id,acceptance_id,document_id,user_id,username,signed_name,document_sha256,signature_sha256,signed_at) VALUES (?,'org-demo',?,?,?,'admin-demo','Nombre Ficticio',?,?,'2026-10-07')"
        db.execute(sign, ("s1", "a4", "v1", "user-0", "a" * 64, "b" * 64))
        for values in [("s2", "a2", "p1", "user-0", "a" * 64, "b" * 64), ("s3", "a1", "t1", "user-1", "a" * 64, "b" * 64), ("s4", "a1", "t1", "user-0", "a" * 63, "b" * 64), ("s5", "a4", "v1", "user-0", "a" * 64, "b" * 64)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=values[0]):
                db.execute(sign, values)
        for statement in ["UPDATE legal_signatures SET signed_name='Otro nombre' WHERE id='s1'", "DELETE FROM legal_signatures WHERE id='s1'"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_invitations_add_staff_email_outbox_and_keep_every_activity_event(self):
        """0034 (ST-121): users gain an optional, unique e-mail; invitations keep only token hashes; the outbox records
        deliveries; the activity is rebuilt row for row and admits invitation events."""
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        before = self.scoped("org-demo", until=[path.name[:4] for path in migrations].index("0034"))
        events = before.execute("SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events ORDER BY id").fetchall()
        demo = self.scoped("org-demo")
        self.assertEqual(demo.execute("SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events ORDER BY id").fetchall(), events)
        self.assertEqual(demo.execute("SELECT count(*) FROM users WHERE email IS NOT NULL").fetchone()[0], 0)
        demo.execute("UPDATE users SET email='ana@example.test' WHERE id='user-0'")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE users SET email='ana@example.test' WHERE id='user-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE users SET email='Mayus@Example.test' WHERE id='user-1'")
        insert = "INSERT INTO invitations(id,organization_id,email,display_name,role,token_hash,expires_at,status,invited_by,created_at) VALUES (?,'org-demo',?,'Paula','educator',?,'t','pending','user-0','t')"
        demo.execute(insert, ("i-1", "paula@example.test", "a" * 64))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute(insert, ("i-2", "paula@example.test", "b" * 64))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute(insert, ("i-3", "otra@example.test", "d_" + "c" * 64))
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE invitations SET status='accepted' WHERE id='i-1'")
        demo.execute("UPDATE invitations SET status='revoked' WHERE id='i-1'")
        demo.execute(insert, ("i-2", "paula@example.test", "b" * 64))
        demo.execute("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,created_at) VALUES ('m-1','org-demo','invitation','i-2','paula@example.test','Te invitaron a Happy Learners','not_configured','t')")
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at) VALUES ('m-2','org-demo','invitation','x@example.test','s','bounced','t')")
        for action in ["resent", "revoked", "accepted", "created"]:
            demo.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES (?,'org-demo','user-0',?,'invitation','i-2','Invitación','t')", (f"e-{action}", action))
        self.assertEqual(sorted(row[0] for row in demo.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity_events' AND sql IS NOT NULL")),
                         ["activity_events_actor", "activity_events_course", "activity_events_group", "activity_events_organization"])
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_profiles_and_staff_documents_keep_their_rules(self):
        """0037 (ST-149, ST-150): profile fields and staff documents are checked; withdrawing keeps the row."""
        demo = self.scoped("org-demo")
        demo.execute("INSERT INTO staff_profiles(user_id,organization_id,phone,contact_email,specialties,availability,updated_at) VALUES ('seed-user-carlos','org-demo','+502 5555-0149','c@ejemplo.org','[\"Álgebra\"]','[{\"day\":1,\"start\":\"08:00\",\"end\":\"10:00\"}]','t')")
        for values in [("seed-user-ana", "123", None, "[]", "[]"), ("seed-user-ana", None, "Mayus@Ejemplo.org", "[]", "[]"), ("seed-user-ana", None, None, "{}", "[]"), ("user-missing", None, None, "[]", "[]")]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute("INSERT INTO staff_profiles(user_id,organization_id,phone,contact_email,specialties,availability,updated_at) VALUES (?,'org-demo',?,?,?,?,'t')", values)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE staff_profiles SET photo_key='k' WHERE user_id='seed-user-carlos'")
        insert = "INSERT INTO staff_documents(id,organization_id,user_id,type,title,issued_on,expires_on,object_key,media_type,size_bytes,sha256,uploaded_by,uploaded_at) VALUES (?,'org-demo','seed-user-carlos',?,'T',?,?,?,?,?,?,'user-0','t')"
        demo.execute(insert, ("d1", "dpi", "2026-01-01", "2030-01-01", "k1", "application/pdf", 10, "a" * 64))
        for values in [("d2", "passport", "2026-01-01", None, "k2", "application/pdf", 10, "a" * 64), ("d3", "dpi", "2026-01-01", "2025-01-01", "k3", "application/pdf", 10, "a" * 64),
                       ("d4", "dpi", "2026-01-01", None, "k1", "application/pdf", 10, "a" * 64), ("d5", "cv", "2026-01-01", None, "k5", "application/zip", 10, "a" * 64), ("d6", "cv", "2026-01-01", None, "k6", "image/png", 10485761, "a" * 64)]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            demo.execute("UPDATE staff_documents SET withdrawn_at='t' WHERE id='d1'")
        demo.execute("UPDATE staff_documents SET withdrawn_at='t',withdrawn_by='user-0' WHERE id='d1'")
        self.assertEqual(demo.execute("SELECT count(*) FROM staff_documents").fetchone()[0], 1)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_notifications_rebuild_keeps_every_outbox_row(self):
        """0039 (ST-124): mail_outbox admits notifications and 'no_address'; inside one transaction with foreign keys on,
        as a Durable Object applies it, every existing row and its order stay byte-identical and the indexes return."""
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        position = [path.name[:4] for path in migrations].index("0039")
        db = self.scoped("org-demo", until=position)
        db.isolation_level = None
        insert = "INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id) VALUES (?,'org-demo','invitation',?,?,?,?,?,?,?,?,?)"
        db.execute(insert, ("mail-b", "invitation-1", "paula@example.test", "Te invitaron a Happy Learners", "sent", 2, None, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.000Z", "<id@brevo>"))
        db.execute(insert, ("mail-a", "invitation-2", "ñandú@example.test", "Asunto «ñ»", "failed", 1, "Brevo respondió 401", "2026-10-01T00:00:02.000Z", None, None))
        db.execute(insert, ("mail-c", None, "x@example.test", "S", "not_configured", 0, "El envío de correo no está configurado.", "2026-10-01T00:00:03.000Z", None, None))
        old = "id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id"
        rows = lambda: db.execute(f"SELECT rowid,{old},hex(CAST(recipient AS BLOB)),hex(CAST(subject AS BLOB)) FROM mail_outbox ORDER BY rowid").fetchall()
        before = rows()
        indexes = lambda: db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='mail_outbox' AND name IN ('mail_outbox_reference','mail_outbox_sent') ORDER BY name").fetchall()
        kept = indexes()
        db.executescript("BEGIN;\n" + migrations[position].read_text() + "\nCOMMIT;")
        self.assertEqual(rows(), before)
        self.assertEqual(indexes(), kept)
        self.assertEqual(db.execute("SELECT count(*) FROM mail_outbox WHERE user_id IS NULL AND notification_type IS NULL AND reason IS NULL AND mandatory=0").fetchone()[0], 3)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        note = "INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,created_at,user_id,notification_type,reason,mandatory) VALUES (?,'org-demo','notification','class_changed:c',?,'Asunto',?,'t',?,?,?,?)"
        db.execute(note, ("n1", "", "no_address", "user-0", "class_changed", "Cambió la clase", 1))
        db.execute(note, ("n2", "a@example.test", "not_configured", "user-0", "class_cancelled", "Se canceló la clase", 0))
        for values in [("n3", "", "sent", "user-0", "class_changed", "Motivo", 0), ("n4", "a@example.test", "sent", "user-0", "otro", "Motivo", 0), ("n5", "a@example.test", "sent", "user-0", "class_changed", None, 0), ("n6", "a@example.test", "sent", None, "class_changed", "Motivo", 0)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(note, values)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,notification_type) VALUES ('i9','org-demo','invitation','a@example.test','S','sent','t','class_changed')")
        db.execute("INSERT INTO notification_policies VALUES ('org-demo','class_changed',1,'user-0','t')")
        db.execute("INSERT INTO notification_preferences VALUES ('user-0','org-demo','review_returned',0,'t')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO notification_preferences VALUES ('user-0','org-demo','otro',0,'t')")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_hour_adjustments_need_a_reason_and_a_completed_class_reference(self):
        """0040 (ST-152): corrections keep minutes before and after, a person, a reason of 5 to 300 characters and who made them."""
        demo = self.scoped("org-demo")
        session = demo.execute("SELECT id FROM class_sessions WHERE status='completed' LIMIT 1").fetchone()[0]
        # Classes completed before this release have no real start: 0018 set started_at to their completion.
        self.assertEqual(demo.execute("SELECT count(*) FROM class_sessions WHERE status='completed' AND started_at<>completed_at").fetchone()[0], 0)
        insert = "INSERT INTO class_hour_adjustments(id,organization_id,session_id,minutes_before,minutes_after,educator_before,educator_after,reason,adjusted_by,adjusted_at) VALUES (?,'org-demo',?,?,?,?,?,?,'user-0','t')"
        demo.execute(insert, ("h1", session, 0, 90, None, "user-1", "Olvidó comenzar la clase"))
        for values in [("h2", session, 0, 90, None, "user-1", "    "), ("h3", session, 0, 721, None, "user-1", "Motivo válido"), ("h4", session, -1, 90, None, "user-1", "Motivo válido"),
                       ("h5", "class-missing", 0, 90, None, "user-1", "Motivo válido"), ("h6", session, 0, 90, None, "user-missing", "Motivo válido"), ("h7", session, 0, 90, None, "user-1", "x" * 301)]:
            with self.assertRaises(sqlite3.IntegrityError):
                demo.execute(insert, values)
        self.assertEqual(demo.execute("SELECT count(*) FROM class_hour_adjustments").fetchone()[0], 1)
        self.assertEqual(demo.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_professional_profile_keeps_profiles_and_activity_and_checks_publication_and_credentials(self):
        """0042 (ST-154 to ST-157): specialties become open teaching areas, the activity is rebuilt row for row inside one
        transaction with foreign keys on and admits profile and credential events; versions and credentials keep their rules."""
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        position = [path.name[:4] for path in migrations].index("0042")
        self.assertEqual(migrations[position].name, "0042_professional_profile.sql")
        db = self.scoped("org-demo", until=position)
        db.isolation_level = None
        db.execute("INSERT INTO staff_profiles(user_id,organization_id,phone,specialties,availability,updated_at) VALUES ('seed-user-carlos','org-demo','+502 5555-0149','[\"Álgebra\",\"Robótica «educativa»\"]','[]','t')")
        db.execute("INSERT INTO staff_profiles(user_id,organization_id,updated_at) VALUES ('seed-user-ana','org-demo','t')")
        events = lambda: db.execute("SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events ORDER BY id").fetchall()
        before, profiles = events(), db.execute("SELECT user_id,phone,specialties,availability,updated_at FROM staff_profiles ORDER BY user_id").fetchall()
        self.assertGreater(len(before), 0)
        db.executescript("BEGIN;\n" + migrations[position].read_text() + "\nCOMMIT;")
        self.assertEqual(events(), before)
        self.assertEqual(db.execute("SELECT user_id,phone,specialties,availability,updated_at FROM staff_profiles ORDER BY user_id").fetchall(), profiles)
        self.assertEqual(json.loads(db.execute("SELECT draft FROM staff_profiles WHERE user_id='seed-user-carlos'").fetchone()[0]), {"areas": [{"label": "Álgebra", "field": None}, {"label": "Robótica «educativa»", "field": None}]})
        self.assertEqual(db.execute("SELECT draft,visibility,status,draft_version,hidden_by FROM staff_profiles WHERE user_id='seed-user-ana'").fetchone(), ("{}", "{}", "draft", 0, None))
        self.assertEqual(db.execute("SELECT profile_review_required FROM organizations").fetchall(), [(1,)])
        self.assertEqual(sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity_events' AND sql IS NOT NULL")),
                         ["activity_events_actor", "activity_events_course", "activity_events_group", "activity_events_organization"])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        for action, target in [("submitted", "profile"), ("approved", "profile"), ("returned", "profile"), ("hidden", "profile"), ("verified", "credential"), ("rejected", "credential"), ("reset", "account"), ("revoked", "invitation")]:
            db.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES (?,'org-demo','user-0',?,?,'x','Resumen','t')", (f"e-{action}", action, target))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e-x','org-demo','user-0','liked','profile','x','Resumen','t')")
        for statement in ["UPDATE staff_profiles SET status='archived' WHERE user_id='seed-user-ana'", "UPDATE staff_profiles SET draft='[]' WHERE user_id='seed-user-ana'",
                          "UPDATE staff_profiles SET hidden_by='nobody' WHERE user_id='seed-user-ana'", "UPDATE organizations SET profile_review_required=2"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        version = "INSERT INTO staff_profile_versions(id,organization_id,user_id,version,draft_version,content,status,submitted_by,submitted_at,decided_by,decided_at,decision_note,published_at) VALUES (?,'org-demo','seed-user-carlos',?,1,'{}',?,'seed-user-carlos','t',?,?,?,?)"
        db.execute(version, ("v1", 1, "returned", "user-0", "t", "Agrega tu enfoque.", None))
        db.execute(version, ("v2", 2, "published", "user-0", "t", None, "t"))
        db.execute(version, ("v3", 3, "in_review", None, None, None, None))
        for values in [("v4", 4, "in_review", None, None, None, None), ("v5", 5, "published", "user-0", "t", None, "t"), ("v6", 6, "returned", "user-0", "t", None, None),
                       ("v7", 7, "published", "user-0", "t", None, None), ("v8", 3, "withdrawn", None, None, None, None), ("v9", 9, "draft", None, None, None, None), ("v10", 10, "returned", None, None, "Agrega tu enfoque.", None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=values[0]):
                db.execute(version, values)
        db.execute("UPDATE staff_profile_versions SET status='superseded' WHERE id='v2'")
        db.execute("UPDATE staff_profile_versions SET status='published',decided_by='user-0',decided_at='t',published_at='t' WHERE id='v3'")
        db.execute("INSERT INTO staff_documents(id,organization_id,user_id,type,title,issued_on,object_key,media_type,size_bytes,sha256,uploaded_by,uploaded_at) VALUES ('d-carlos','org-demo','seed-user-carlos','studies','T','2013-01-01','k1','application/pdf',10,?,'user-0','t')", ("a" * 64,))
        db.execute("INSERT INTO staff_documents(id,organization_id,user_id,type,title,issued_on,object_key,media_type,size_bytes,sha256,uploaded_by,uploaded_at) VALUES ('d-ana','org-demo','seed-user-ana','studies','T','2013-01-01','k2','application/pdf',10,?,'user-0','t')", ("a" * 64,))
        credential = "INSERT INTO staff_credentials(id,organization_id,user_id,type,name,issuer,country,issued_on,expires_on,verification_url,document_id,status,rejection_reason,submitted_at,decided_by,decided_at,created_at,updated_at) VALUES (?,'org-demo','seed-user-carlos',?,'Profesorado','Universidad',?,'2013-11-30',?,?,?,?,?,?,?,?,'t','t')"
        db.execute(credential, ("c1", "degree", "GT", None, "https://registro.example.edu/v", "d-carlos", "verified", None, "t", "user-0", "t"))
        db.execute(credential, ("c2", "teaching_license", None, "2030-01-01", None, None, "rejected", "El enlace no abre.", "t", "user-0", "t"))
        db.execute(credential, ("c3", "other", None, None, None, None, "draft", None, None, None, None))
        for values in [("c4", "passport", None, None, None, None, "draft", None, None, None, None), ("c5", "degree", "gt", None, None, None, "draft", None, None, None, None),
                       ("c6", "degree", None, "2012-01-01", None, None, "draft", None, None, None, None), ("c7", "degree", None, None, "http://x.org", None, "draft", None, None, None, None),
                       ("c8", "degree", None, None, None, "d-ana", "draft", None, None, None, None), ("c9", "degree", None, None, None, None, "rejected", None, "t", "user-0", "t"),
                       ("c10", "degree", None, None, None, None, "verified", None, "t", None, None), ("c11", "degree", None, None, None, None, "submitted", None, None, None, None),
                       ("c12", "degree", None, None, None, None, "expired", None, "t", "user-0", "t"), ("c13", "degree", None, None, None, None, "draft", "Motivo largo", None, None, None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=values[0]):
                db.execute(credential, values)
        self.assertEqual(db.execute("SELECT count(*) FROM staff_credentials").fetchone()[0], 3)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

class OnboardingMigrationTests(unittest.TestCase):
    def test_existing_accounts_count_as_onboarded_and_new_ones_start_pending(self):
        """0041 (ST-122): every account that exists when it runs is backfilled as onboarded; later accounts start empty."""
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        for path in sorted(pathlib.Path("database/migrations").glob("*.sql")):
            db.executescript(path.read_text())
        members = db.execute("SELECT count(*) FROM memberships").fetchone()[0]
        self.assertGreater(members, 0)
        self.assertEqual(db.execute("SELECT count(*) FROM onboarding WHERE completed_at IS NOT NULL AND completed_at >= started_at").fetchone()[0], members)
        self.assertEqual(db.execute("SELECT count(*) FROM onboarding o JOIN memberships m ON m.user_id=o.user_id AND m.organization_id=o.organization_id").fetchone()[0], members)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO onboarding(user_id,organization_id,started_at) VALUES ('nobody','org-demo','2026-10-15T00:00:00Z')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE onboarding SET completed_at='2000-01-01T00:00:00Z' WHERE user_id='user-0'")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


class AccountSettingsMigrationTests(unittest.TestCase):
    """0043 (ST-158, ST-159). Positions are looked up by number, so the tests hold with or without 0042 before it."""

    def before_and_script(self):
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        position = [path.name[:4] for path in migrations].index("0043")
        db = UpgradeTests.scoped(None, "org-demo", until=position)
        db.isolation_level = None
        return db, migrations[position].read_text()

    def test_sessions_and_outbox_are_rebuilt_row_for_row_and_old_inserts_keep_working(self):
        db, script = self.before_and_script()
        db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)", ("a" * 64, "user-0", 1792200000000))
        db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)", ("b" * 64, "user-0", 1792200001000))
        insert = "INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory) VALUES (?,'org-demo',?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        db.execute(insert, ("mail-b", "invitation", "invitation-1", "paula@example.test", "Te invitaron", "sent", 2, None, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.000Z", "<id>", None, None, None, 0))
        db.execute(insert, ("mail-a", "notification", "class_changed:c", "", "Cambió «ñ»", "no_address", 0, "Sin correo", "2026-10-01T00:00:02.000Z", None, None, "user-0", "class_changed", "Cambió la clase", 1))
        columns = "id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory"
        rows = lambda: db.execute(f"SELECT rowid,{columns},hex(CAST(subject AS BLOB)) FROM mail_outbox ORDER BY rowid").fetchall()
        before = rows()
        db.executescript("BEGIN;\n" + script + "\nCOMMIT;")
        self.assertEqual(rows(), before)
        sessions = db.execute("SELECT token_hash,user_id,expires_at,id,created_at,last_used_at,method,device,country FROM sessions ORDER BY expires_at").fetchall()
        self.assertEqual([row[:3] for row in sessions], [("a" * 64, "user-0", 1792200000000), ("b" * 64, "user-0", 1792200001000)])
        self.assertTrue(all(row[3].startswith("session-") and len(row[3]) == 40 for row in sessions))
        self.assertEqual(len({row[3] for row in sessions}), 2)
        self.assertEqual([(row[4], row[5], row[6], row[7], row[8]) for row in sessions], [(1792200000000 - 28800000,) * 2 + ("password", None, None), (1792200001000 - 28800000,) * 2 + ("password", None, None)])
        # An insert written before 0043 still opens a session, with an id and its start.
        db.execute("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)", ("c" * 64, "user-0", 1))
        self.assertRegex(db.execute("SELECT id FROM sessions WHERE token_hash=?", ("c" * 64,)).fetchone()[0], r"^session-[0-9a-f]{32}$")
        for statement in ["INSERT INTO sessions(token_hash,user_id,expires_at,country) VALUES ('d','user-0',1,'gt')", "INSERT INTO sessions(token_hash,user_id,expires_at,method) VALUES ('e','user-0',1,'sso')",
                          "INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_used_at) VALUES ('f','user-0',1,10,5)", "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ('g','user-missing',1)"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        self.assertEqual(sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('sessions','mail_outbox') AND sql IS NOT NULL")),
                         ["mail_outbox_kind", "mail_outbox_person", "mail_outbox_reference", "mail_outbox_sent", "sessions_expiry", "sessions_user"])
        account = "INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,created_at,user_id,reason,mandatory) VALUES (?,'org-demo','account','email-change-1',?,'Confirma',?,'t',?,?,?)"
        db.execute(account, ("m1", "nueva@example.test", "not_configured", "user-0", "Confirmación del nuevo correo", 1))
        db.execute(account, ("m2", "", "no_address", "user-0", "Pidió cerrar su cuenta", 1))
        for values in [("m3", "a@example.test", "sent", None, "R", 1), ("m4", "a@example.test", "sent", "user-0", None, 1), ("m5", "a@example.test", "sent", "user-0", "R", 0), ("m6", "", "sent", "user-0", "R", 1)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(account, values)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_email_changes_keep_one_pending_change_and_never_move_once_settled(self):
        db, script = self.before_and_script()
        db.executescript(script)
        insert = "INSERT INTO email_changes(id,organization_id,user_id,previous_email,new_email,token_hash,status,requested_at,expires_at) VALUES (?,'org-demo','user-0',?,?,?,'pending','2026-10-16T00:00:00Z','2026-10-17T00:00:00Z')"
        db.execute(insert, ("c1", None, "nueva@example.test", "a" * 64))
        # A second pending change, an address not in lowercase, the same address again, a token that is not a hash.
        for values in [("c2", None, "otra@example.test", "b" * 64), ("c3", None, "Mayus@example.test", "c" * 64), ("c4", "igual@example.test", "igual@example.test", "d" * 64), ("c5", None, "x@example.test", "d_" + "e" * 64)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE email_changes SET status='verified' WHERE id='c1'")
        db.execute("UPDATE email_changes SET status='verified',verified_at='2026-10-16T01:00:00Z' WHERE id='c1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE email_changes SET status='cancelled',verified_at=NULL,cancelled_at='2026-10-16T02:00:00Z' WHERE id='c1'")
        # Once the first one settled, a new pending change for the same person is accepted.
        db.execute(insert, ("c6", "nueva@example.test", "otra@example.test", "f" * 64))
        self.assertEqual(db.execute("SELECT count(*) FROM email_changes").fetchone()[0], 2)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_closure_requests_only_move_forward_and_completion_names_the_departure(self):
        db, script = self.before_and_script()
        db.executescript(script)
        insert = "INSERT INTO account_closures(id,organization_id,user_id,status,reason,requested_at) VALUES (?,'org-demo',?,'requested','','2026-10-16T00:00:00Z')"
        db.execute(insert, ("r1", "user-1"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(insert, ("r2", "user-1"))
        for statement in ["UPDATE account_closures SET status='in_progress' WHERE id='r1'", "UPDATE account_closures SET status='completed',completed_at='2026-10-16T01:00:00Z' WHERE id='r1'",
                          "UPDATE account_closures SET reason='otro' WHERE id='r1'", "DELETE FROM account_closures WHERE id='r1'"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        db.execute("UPDATE account_closures SET status='in_progress',started_at='2026-10-16T01:00:00Z',started_by='user-0' WHERE id='r1'")
        # Started requests are no longer cancelled, nor sent back.
        for statement in ["UPDATE account_closures SET status='cancelled',cancelled_at='2026-10-16T02:00:00Z' WHERE id='r1'", "UPDATE account_closures SET status='requested' WHERE id='r1'"]:
            with self.assertRaises(sqlite3.IntegrityError, msg=statement):
                db.execute(statement)
        db.execute("INSERT INTO departures(id,organization_id,user_id,departed_on,reason,recorded_by,recorded_at) VALUES ('departure-1','org-demo','user-1','2026-10-16','','user-0','2026-10-16T02:00:00Z')")
        db.execute("UPDATE account_closures SET status='completed',completed_at='2026-10-16T02:00:00Z',departure_id='departure-1' WHERE id='r1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE account_closures SET status='requested' WHERE id='r1'")
        # A new request after a completed one, cancelled before it starts.
        db.execute(insert, ("r3", "user-1"))
        db.execute("UPDATE account_closures SET status='cancelled',cancelled_at='2026-10-16T03:00:00Z' WHERE id='r3'")
        self.assertEqual(db.execute("SELECT id,status FROM account_closures ORDER BY id").fetchall(), [("r1", "completed"), ("r3", "cancelled")])
        db.execute("INSERT INTO sign_in_events(id,organization_id,user_id,outcome,method,device,country,occurred_at) VALUES ('s1','org-demo','user-0','failed','password','Chrome en Windows','GT','t')")
        for values in [("s2", "blocked", "password", "Chrome", "GT"), ("s3", "failed", "password", "", "GT"), ("s4", "failed", "password", "Chrome", "gt"), ("s5", "failed", "sso", "Chrome", None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute("INSERT INTO sign_in_events(id,organization_id,user_id,outcome,method,device,country,occurred_at) VALUES (?,'org-demo','user-0',?,?,?,?,'t')", values)


class PreferencesMigrationTests(unittest.TestCase):
    """0044 (ST-160, ST-161, DEC-045). The position is looked up by name, so it holds with or without 0042 and 0043."""

    def before_0044(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        position = [path.name[:4] for path in migrations].index("0044")
        for path in migrations[:position]:
            db.executescript(path.read_text())
        return db, migrations[position]

    def test_existing_choices_become_the_email_channel_and_the_outbox_keeps_every_row(self):
        db, migration = self.before_0044()
        db.isolation_level = None
        users = [row[0] for row in db.execute("SELECT user_id FROM memberships WHERE organization_id='org-demo' AND active=1 ORDER BY user_id LIMIT 2")]
        prefs = "INSERT INTO notification_preferences(user_id,organization_id,type,enabled,updated_at) VALUES (?,?,?,?,?)"
        db.execute(prefs, (users[0], "org-demo", "review_returned", 0, "2026-10-01T00:00:00.000Z"))
        db.execute(prefs, (users[1], "org-demo", "class_changed", 1, "2026-10-02T00:00:00.000Z"))
        db.execute(prefs, (users[0], "org-demo", "class_cancelled", 0, "2026-10-03T00:00:00.000Z"))
        before_prefs = db.execute("SELECT rowid,user_id,organization_id,type,enabled,updated_at FROM notification_preferences ORDER BY rowid").fetchall()
        db.execute("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id) VALUES ('mail-i','org-demo','invitation','invitation-1','ñandú@example.test','Asunto «ñ»','sent',2,NULL,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:01.000Z','<id@brevo>')")
        db.execute("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,created_at,user_id,notification_type,reason,mandatory) VALUES ('mail-n','org-demo','notification','class_changed:c','','Asunto','no_address','2026-10-02T00:00:00.000Z',?,'class_changed','Cambió la clase',1)", (users[0],))
        old = "id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory"
        outbox = lambda: db.execute(f"SELECT rowid,{old},hex(CAST(recipient AS BLOB)),hex(CAST(subject AS BLOB)) FROM mail_outbox ORDER BY rowid").fetchall()
        before_outbox = outbox()
        db.executescript("BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
        self.assertEqual(db.execute("SELECT rowid,user_id,organization_id,type,enabled,updated_at FROM notification_preferences ORDER BY rowid").fetchall(), before_prefs)
        self.assertEqual(db.execute("SELECT DISTINCT channel FROM notification_preferences").fetchall(), [("email",)])
        self.assertEqual(outbox(), before_outbox)
        self.assertEqual(db.execute("SELECT count(*) FROM mail_outbox WHERE deliver_after IS NULL AND path IS NULL AND digest_id IS NULL").fetchone()[0], 2)
        self.assertEqual(sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mail_outbox' AND name LIKE 'mail_outbox_%'")),
                         ["mail_outbox_due", "mail_outbox_kind", "mail_outbox_person", "mail_outbox_reference", "mail_outbox_sent"])
        self.assertEqual(set(row[0] for row in db.execute("SELECT locale FROM organizations")), {"es"})
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        # The same type may now carry one choice per channel.
        db.execute("INSERT INTO notification_preferences(user_id,organization_id,type,channel,enabled,updated_at) VALUES (?,'org-demo','review_returned','in_app',1,'t')", (users[0],))
        for values in [(users[0], "review_returned", "email"), (users[0], "review_returned", "sms"), (users[0], "account_security", "email")]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute("INSERT INTO notification_preferences(user_id,organization_id,type,channel,enabled,updated_at) VALUES (?,'org-demo',?,?,0,'t')", values)

    def test_preferences_settings_inbox_and_scheduled_mail_keep_their_rules(self):
        db, migration = self.before_0044()
        db.executescript(migration.read_text())
        user = db.execute("SELECT user_id FROM memberships WHERE organization_id='org-demo' AND active=1 LIMIT 1").fetchone()[0]
        db.execute("INSERT INTO user_preferences(user_id,organization_id,locale,timezone,week_start,hour_cycle,theme,text_scale,high_contrast,motion,density,home_page,updated_at) VALUES (?,'org-demo','es-MX','America/Mexico_City',7,'h12','dark',150,1,'reduce','compact','agenda','t')", (user,))
        self.assertEqual(db.execute("SELECT language,text_scale FROM user_preferences").fetchall(), [("es", 150)])
        for column, value in [("text_scale", 99), ("text_scale", 151), ("theme", "sepia"), ("week_start", 0), ("hour_cycle", "h24"), ("motion", "auto"), ("density", "tiny"), ("home_page", "admin"), ("locale", "es_MX"), ("language", "ES")]:
            with self.assertRaises(sqlite3.IntegrityError, msg=column):
                db.execute(f"UPDATE user_preferences SET {column}=? WHERE user_id=?", (value, user))
        settings = "INSERT INTO notification_settings(user_id,organization_id,email_frequency,digest_time,quiet_start,quiet_end,updated_at) VALUES (?,'org-demo',?,?,?,?,'t')"
        db.execute(settings, (user, "weekly", "18:30", "22:00", "07:00"))
        for values in [("hourly", "07:00", None, None), ("daily", "24:00", None, None), ("daily", "07:00", "22:00", None), ("daily", "07:00", "22:00", "22:00"), ("daily", "7:00", None, None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute("UPDATE notification_settings SET email_frequency=?,digest_time=?,quiet_start=?,quiet_end=? WHERE user_id=?", (*values, user))
        inbox = "INSERT INTO notification_inbox(id,organization_id,user_id,type,reason,path,mandatory,created_at) VALUES (?,'org-demo',?,?,?,?,0,'t')"
        db.execute(inbox, ("inbox-1", user, "account_security", "Se cambió tu contraseña", "/perfil"))
        for values in [("inbox-2", user, "Class", "R", "/x"), ("inbox-3", user, "class_changed", "", "/x"), ("inbox-4", user, "class_changed", "R", "https://x"), ("inbox-5", "user-missing", "class_changed", "R", "/x")]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(inbox, values)
        note = "INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,user_id,notification_type,reason,mandatory,deliver_after,digest_id) VALUES (?,'org-demo',?,'a@example.test','S',?,'t',?,?,?,0,?,?)"
        db.execute(note, ("n1", "notification", "scheduled", user, "class_changed", "Motivo", "2026-10-17T13:00:00.000Z", None))
        db.execute(note, ("d1", "digest", "sent", user, None, "Resumen diario con 2 avisos", None, None))
        db.execute(note, ("n2", "notification", "digested", user, "terms_updated", "Motivo", None, "d1"))
        for values in [("x1", "notification", "scheduled", user, "class_changed", "Motivo", None, None), ("x2", "notification", "digested", user, "class_changed", "Motivo", None, None),
                       ("x3", "digest", "sent", None, None, "Resumen", None, None), ("x4", "digest", "sent", user, "class_changed", "Resumen", None, None),
                       ("x5", "invitation", "scheduled", None, None, None, "2026-10-17T13:00:00.000Z", None), ("x6", "notification", "sent", user, "Class-Changed", "Motivo", None, None),
                       ("x7", "notification", "postponed", user, "class_changed", "Motivo", None, None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(note, values)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO mail_schedule_runs VALUES ('org-missing','t')")
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


class ReleaseOutboxMigrationTests(unittest.TestCase):
    """v1.1.1 releases 0042, 0043 and 0044 together. 0043 and 0044 both rebuild mail_outbox: after both, the outbox
    must admit the account's security notices of 0043 and the scheduled e-mail and digests of 0044, keep the rule of
    each, and keep every earlier row byte for byte. 0042 rebuilds activity_events, which neither 0043 nor 0044 touch."""

    columns = "id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory"

    def migrations(self):
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        return migrations, [path.name[:4] for path in migrations]

    def test_account_notices_and_scheduled_digests_coexist_after_0042_0043_0044(self):
        migrations, numbers = self.migrations()
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.isolation_level = None
        for path in migrations[:numbers.index("0042")]:
            db.executescript(path.read_text())
        user = db.execute("SELECT user_id FROM memberships WHERE organization_id='org-demo' AND active=1 ORDER BY user_id LIMIT 1").fetchone()[0]
        insert = f"INSERT INTO mail_outbox({self.columns}) VALUES (?,'org-demo',?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        # Rows written by v1.1.0 (0034 and 0039), before any of the three migrations.
        db.execute(insert, ("mail-i", "invitation", "invitation-1", "ñandú@example.test", "Te invitaron «ñ»", "sent", 2, None, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.000Z", "<id@brevo>", None, None, None, 0))
        db.execute(insert, ("mail-n", "notification", "class_changed:c", "", "Cambió la clase", "no_address", 0, "Sin correo", "2026-10-02T00:00:00.000Z", None, None, user, "class_changed", "Cambió la clase", 1))
        db.executescript("BEGIN;\n" + migrations[numbers.index("0042")].read_text() + "\nCOMMIT;")
        db.executescript("BEGIN;\n" + migrations[numbers.index("0043")].read_text() + "\nCOMMIT;")
        # A mandatory account notice written between 0043 and 0044 (a v1.1.1 store migrates all three at once, but an
        # account notice must survive 0044 either way).
        db.execute(insert, ("mail-a", "account", "email-change-1", "nueva@example.test", "Confirma tu correo", "not_configured", 0, "El envío de correo no está configurado.", "2026-10-03T00:00:00.000Z", None, None, user, None, "Confirmación del nuevo correo", 1))
        rows = lambda: db.execute(f"SELECT rowid,{self.columns},hex(CAST(recipient AS BLOB)),hex(CAST(subject AS BLOB)) FROM mail_outbox ORDER BY rowid").fetchall()
        before = rows()
        self.assertEqual(len(before), 3)
        db.executescript("BEGIN;\n" + migrations[numbers.index("0044")].read_text() + "\nCOMMIT;")
        self.assertEqual(rows(), before)
        self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'mail_outbox_v%'").fetchall(), [])
        self.assertEqual(sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mail_outbox' AND sql IS NOT NULL")),
                         ["mail_outbox_due", "mail_outbox_kind", "mail_outbox_person", "mail_outbox_reference", "mail_outbox_sent"])
        outbox = [row[1] for row in db.execute("PRAGMA table_info(mail_outbox)")]
        self.assertEqual(outbox, self.columns.split(",") + ["deliver_after", "path", "digest_id"])

        # After 0044: a new mandatory account notice (0043) and a scheduled notification gathered in a digest (0044).
        account = "INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,created_at,user_id,reason,mandatory) VALUES (?,'org-demo','account','password:x',?,'Tu contraseña cambió',?,'2026-10-04T00:00:00.000Z',?,?,?)"
        db.execute(account, ("mail-a2", "a@example.test", "sent", user, "Aviso de seguridad: cambió la contraseña de @persona", 1))
        db.execute(account, ("mail-a3", "", "no_address", user, "Pidió cerrar su cuenta", 1))
        note = "INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,user_id,notification_type,reason,mandatory,deliver_after,path,digest_id) VALUES (?,'org-demo',?,'a@example.test','S',?,'2026-10-04T00:00:00.000Z',?,?,?,0,?,?,?)"
        db.execute(note, ("mail-s", "notification", "scheduled", user, "class_changed", "Cambió la clase", "2026-10-05T13:00:00.000Z", "/agenda", None))
        db.execute(note, ("mail-d", "digest", "sent", user, None, "Resumen diario con 2 avisos", None, None, None))
        db.execute(note, ("mail-g", "notification", "digested", user, "review_returned", "Devolvieron la lección", None, "/cursos/x", "mail-d"))
        self.assertEqual(db.execute("SELECT kind,status,mandatory FROM mail_outbox ORDER BY rowid").fetchall(), [
            ("invitation", "sent", 0), ("notification", "no_address", 1), ("account", "not_configured", 1), ("account", "sent", 1), ("account", "no_address", 1),
            ("notification", "scheduled", 0), ("digest", "sent", 0), ("notification", "digested", 0)])
        self.assertEqual(db.execute("SELECT id FROM mail_outbox WHERE organization_id='org-demo' AND status='scheduled' AND deliver_after<='2026-10-06'").fetchall(), [("mail-s",)])

        # The rule of 0043 holds after 0044: an account notice names the person and the reason and is mandatory.
        for values in [("x1", "a@example.test", "sent", None, "R", 1), ("x2", "a@example.test", "sent", user, None, 1), ("x3", "a@example.test", "sent", user, "R", 0), ("x4", "", "sent", user, "R", 1)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(account, values)
        # And the rules of 0044: only notifications wait or join a digest; a digest is optional and names the person; the
        # kinds are the four the code writes.
        any_note = "INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,user_id,notification_type,reason,mandatory,deliver_after,digest_id) VALUES (?,'org-demo',?,'a@example.test','S',?,'t',?,?,?,?,?,?)"
        for values in [("y1", "account", "scheduled", user, None, "R", 1, "2026-10-05T13:00:00.000Z", None), ("y2", "digest", "sent", user, None, "R", 1, None, None),
                       ("y3", "notification", "digested", user, "class_changed", "R", 0, None, None), ("y4", "letter", "sent", user, None, "R", 0, None, None),
                       ("y5", "notification", "scheduled", user, "class_changed", "R", 0, None, None)]:
            with self.assertRaises(sqlite3.IntegrityError, msg=str(values)):
                db.execute(any_note, values)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,user_id,reason,mandatory) VALUES ('y6','org-demo','invitation','a@example.test','S','sent','t',?,NULL,0)", (user,))

        # The other tables these migrations rebuild keep their own additions: activity of 0042, sessions of 0043,
        # channels of 0044.
        db.execute("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) VALUES ('e1','org-demo',?,'verified','credential','c1','Verificó una credencial','t')", (user,))
        db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,1)", ("a" * 64, user))
        self.assertRegex(db.execute("SELECT id FROM sessions").fetchone()[0], r"^session-[0-9a-f]{32}$")
        db.execute("INSERT INTO notification_preferences(user_id,organization_id,type,channel,enabled,updated_at) VALUES (?,'org-demo','class_changed','in_app',0,'t')", (user,))
        self.assertEqual([row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB '*_v[0-9]*'")], [])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


class ContractsMigrationTests(unittest.TestCase):
    """DEC-046 (0045): the published volunteer agreement becomes a contract template and each signed agreement an
    active contract with the signature it already had; a sent contract is frozen and follows its life cycle."""

    def upgraded(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(pathlib.Path("database/migrations").glob("*.sql"))
        target = next(path for path in migrations if path.name.startswith("0045"))
        for path in migrations[:migrations.index(target)]:
            db.executescript(path.read_text())
        return db, target

    def test_volunteer_agreement_becomes_template_and_signed_contracts(self):
        db, target = self.upgraded()
        org = db.execute("SELECT id FROM organizations ORDER BY id LIMIT 1").fetchone()[0]
        admin = db.execute("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role='admin' ORDER BY u.id LIMIT 1").fetchone()[0]
        educator = db.execute("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role<>'admin' ORDER BY u.id LIMIT 1").fetchone()[0]
        body = "Primer párrafo del acuerdo.\nContinúa la línea.\n\nSegundo párrafo del acuerdo de voluntariado."
        db.execute("INSERT INTO legal_documents(id,organization_id,kind,status,version,title,body,consent,updated_by,updated_at,published_by,published_at) VALUES ('legal-v1',?,'volunteer','published',1,'Acuerdo de voluntariado',?,NULL,?,'2026-10-01T00:00:00Z',?,'2026-10-01T00:00:00Z')", (org, body, admin, admin))
        db.execute("INSERT INTO legal_acceptances VALUES ('acceptance-1',?,'legal-v1',?,'2026-10-02T10:00:00Z',NULL)", (org, educator))
        db.execute("INSERT INTO legal_signatures VALUES ('signature-1',?,'acceptance-1','legal-v1',?,'edu','Ana Educadora',?,?,'2026-10-02T10:00:00Z')", (org, educator, "a" * 64, "b" * 64))
        db.executescript(target.read_text())

        version = db.execute("SELECT template_id,version,body_json,body_text,effective_from FROM contract_template_versions WHERE id='ctv-legal-v1'").fetchone()
        self.assertEqual(version[0], f"ct-volunteer-{org}")
        self.assertEqual(version[1], 1)
        self.assertEqual([item["content"][0]["text"] for item in json.loads(version[2])["content"]], ["Primer párrafo del acuerdo. Continúa la línea.", "Segundo párrafo del acuerdo de voluntariado."])
        self.assertEqual(version[3], body)
        self.assertEqual(version[4], "2026-10-01")
        contract = db.execute("SELECT status,origin,user_id,start_date,document_sha256,member_signed_name,member_signature_sha256,org_signature_sha256 FROM contracts WHERE id='contract-signature-1'").fetchone()
        self.assertEqual(contract, ("active", "volunteer-agreement", educator, "2026-10-02", "a" * 64, "Ana Educadora", "b" * 64, None))
        self.assertEqual(db.execute("SELECT contract_required FROM organizations WHERE id=?", (org,)).fetchone()[0], 1)
        # The signature itself is kept as it was.
        self.assertEqual(db.execute("SELECT count(*) FROM legal_signatures").fetchone()[0], 1)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

        with self.assertRaisesRegex(sqlite3.IntegrityError, "never edited"):
            db.execute("UPDATE contracts SET terms_json='{}' WHERE id='contract-signature-1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "not allowed"):
            db.execute("UPDATE contracts SET status='sent' WHERE id='contract-signature-1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "only a draft"):
            db.execute("DELETE FROM contracts WHERE id='contract-signature-1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
            db.execute("UPDATE contract_template_versions SET title='Otro' WHERE id='ctv-legal-v1'")
        db.execute("UPDATE contracts SET status='terminated',termination_date='2026-12-31',closed_at='2026-10-20T00:00:00Z',close_reason='Fin' WHERE id='contract-signature-1'")

    def test_an_organization_without_agreement_requires_nothing(self):
        db, target = self.upgraded()
        db.executescript(target.read_text())
        self.assertEqual(db.execute("SELECT count(*) FROM contract_templates").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT sum(contract_required) FROM organizations").fetchone()[0], 0)
        # A sent contract must carry its fingerprint and the organization's signature.
        org = db.execute("SELECT id FROM organizations ORDER BY id LIMIT 1").fetchone()[0]
        admin = db.execute("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role='admin' ORDER BY u.id LIMIT 1").fetchone()[0]
        db.execute("INSERT INTO contract_templates(id,organization_id,name,engagement,created_by,created_at,updated_at) VALUES ('ct-1',?,'Servicios','services',?,'t','t')", (org, admin))
        db.execute("INSERT INTO contract_template_versions(id,organization_id,template_id,status,version,title,body_json,body_text,defaults_json,editable_json,effective_from,updated_by,updated_at,published_by,published_at) VALUES ('ctv-1',?,'ct-1','published',1,'Contrato','{\"type\":\"doc\",\"content\":[]}','Texto suficientemente largo del contrato.','{}','[]','2026-10-01',?,'t',?,'t')", (org, admin, admin))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO contracts(id,organization_id,template_version_id,engagement,title,body_text,terms_json,party_name,user_id,start_date,status,created_by,created_at,updated_at,sent_at,document_sha256) VALUES ('c-1',?,'ctv-1','services','Contrato','Texto suficientemente largo del contrato.','{}','Ana',?,'2026-11-01','sent',?,'t','t','t',?)", (org, admin, admin, "c" * 64))
