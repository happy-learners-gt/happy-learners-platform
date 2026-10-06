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

    def test_class_planning_backfills_taught_classes_and_plans_the_demo(self):
        """0018: classes with marks become taught, the demo gets upcoming classes with lessons and resources."""
        demo = self.scoped("org-demo")
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
        demo = self.scoped("org-demo")
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
        demo = self.scoped("org-demo")
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
        demo = self.scoped("org-demo")
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
        demo = self.scoped("org-demo")
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
