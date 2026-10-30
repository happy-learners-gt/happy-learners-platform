-- Section freedom (1.3.5). Existing lessons and activities stay core and belong to the course.
-- A section may later add its own, hide what is not core, and (when the policy is free) replace a core activity.

ALTER TABLE lessons ADD COLUMN is_core INTEGER NOT NULL DEFAULT 1 CHECK(is_core IN (0,1));
ALTER TABLE lessons ADD COLUMN group_id TEXT REFERENCES course_groups(id);
-- The CHECK goes in a trigger: adding NOT NULL plus CHECK to this table fails on SQLite 3.45 once the table has been rebuilt by earlier migrations.
ALTER TABLE assessment_activities ADD COLUMN is_core INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assessment_activities ADD COLUMN group_id TEXT REFERENCES course_groups(id);

CREATE TABLE IF NOT EXISTS section_content_overrides (
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('lesson','activity','unit')),
  item_id TEXT NOT NULL,
  position INTEGER CHECK(position IS NULL OR position >= 0),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  replaces TEXT,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(group_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS lessons_by_section ON lessons(group_id);
CREATE INDEX IF NOT EXISTS assessment_activities_by_section ON assessment_activities(group_id);

-- A section lesson or activity belongs to a unit or course of that same section.
CREATE TRIGGER IF NOT EXISTS lessons_section_same_course_insert BEFORE INSERT ON lessons
WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_groups g JOIN learning_units u ON u.course_id=g.course_id WHERE g.id=NEW.group_id AND u.id=NEW.course_unit_id
) BEGIN SELECT RAISE(ABORT, 'La lección propia tiene que estar en una unidad de su sección.'); END;
CREATE TRIGGER IF NOT EXISTS lessons_section_same_course_update BEFORE UPDATE OF group_id, course_unit_id ON lessons
WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_groups g JOIN learning_units u ON u.course_id=g.course_id WHERE g.id=NEW.group_id AND u.id=NEW.course_unit_id
) BEGIN SELECT RAISE(ABORT, 'La lección propia tiene que estar en una unidad de su sección.'); END;
CREATE TRIGGER IF NOT EXISTS activities_core_flag_insert BEFORE INSERT ON assessment_activities
WHEN NEW.is_core NOT IN (0,1) BEGIN SELECT RAISE(ABORT, 'El núcleo de una actividad es sí o no.'); END;
CREATE TRIGGER IF NOT EXISTS activities_core_flag_update BEFORE UPDATE OF is_core ON assessment_activities
WHEN NEW.is_core NOT IN (0,1) BEGIN SELECT RAISE(ABORT, 'El núcleo de una actividad es sí o no.'); END;
CREATE TRIGGER IF NOT EXISTS activities_section_same_course_insert BEFORE INSERT ON assessment_activities
WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_groups g WHERE g.id=NEW.group_id AND g.course_id=NEW.course_id
) BEGIN SELECT RAISE(ABORT, 'La actividad propia tiene que ser de un curso de su sección.'); END;

-- The core cannot be hidden. A replacement is an activity standing in for another activity.
CREATE TRIGGER IF NOT EXISTS section_overrides_keep_core_lesson BEFORE INSERT ON section_content_overrides
WHEN NEW.hidden=1 AND NEW.item_type='lesson' AND EXISTS (SELECT 1 FROM lessons WHERE id=NEW.item_id AND is_core=1)
BEGIN SELECT RAISE(ABORT, 'No se oculta una lección del núcleo.'); END;
CREATE TRIGGER IF NOT EXISTS section_overrides_keep_core_activity BEFORE INSERT ON section_content_overrides
WHEN NEW.hidden=1 AND NEW.item_type='activity' AND EXISTS (SELECT 1 FROM assessment_activities WHERE id=NEW.item_id AND is_core=1)
BEGIN SELECT RAISE(ABORT, 'No se oculta una actividad del núcleo.'); END;
CREATE TRIGGER IF NOT EXISTS section_overrides_replace_activity BEFORE INSERT ON section_content_overrides
WHEN NEW.replaces IS NOT NULL AND (
  NEW.item_type<>'activity'
  OR NOT EXISTS (
    SELECT 1 FROM assessment_activities own JOIN assessment_activities core ON core.id=NEW.replaces
    WHERE own.id=NEW.item_id AND own.group_id=NEW.group_id AND core.is_core=1 AND own.category_id=core.category_id AND own.points=core.points
  )
) BEGIN SELECT RAISE(ABORT, 'El reemplazo tiene que ser una actividad propia de la misma categoría y los mismos puntos.'); END;
CREATE TRIGGER IF NOT EXISTS section_overrides_keep_taught BEFORE INSERT ON section_content_overrides
WHEN NEW.hidden=1 AND NEW.item_type='lesson' AND EXISTS (
  SELECT 1 FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id
  WHERE p.lesson_id=NEW.item_id AND s.group_id=NEW.group_id AND s.status='completed'
) BEGIN SELECT RAISE(ABORT, 'No se oculta una lección ya impartida en esta sección.'); END;
CREATE TRIGGER IF NOT EXISTS section_overrides_keep_graded BEFORE INSERT ON section_content_overrides
WHEN NEW.hidden=1 AND NEW.item_type='activity' AND EXISTS (
  SELECT 1 FROM assessment_scores WHERE activity_id=NEW.item_id AND group_id=NEW.group_id
) BEGIN SELECT RAISE(ABORT, 'No se oculta una actividad que ya tiene notas en esta sección.'); END;
