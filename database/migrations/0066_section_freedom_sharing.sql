-- Own units, review of a section's own activities, and proposals to the course (1.3.6).

ALTER TABLE learning_units ADD COLUMN group_id TEXT REFERENCES course_groups(id);
ALTER TABLE assessment_activities ADD COLUMN review_status TEXT;

CREATE INDEX IF NOT EXISTS learning_units_by_section ON learning_units(group_id);

CREATE TRIGGER IF NOT EXISTS units_section_same_course_insert BEFORE INSERT ON learning_units
WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_groups g WHERE g.id=NEW.group_id AND g.course_id=NEW.course_id
) BEGIN SELECT RAISE(ABORT, 'La unidad propia tiene que ser de una sección de su curso.'); END;
CREATE TRIGGER IF NOT EXISTS units_section_same_course_update BEFORE UPDATE OF group_id, course_id ON learning_units
WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_groups g WHERE g.id=NEW.group_id AND g.course_id=NEW.course_id
) BEGIN SELECT RAISE(ABORT, 'La unidad propia tiene que ser de una sección de su curso.'); END;

CREATE TRIGGER IF NOT EXISTS activities_review_status_insert BEFORE INSERT ON assessment_activities
WHEN NEW.review_status IS NOT NULL AND NEW.review_status NOT IN ('pending','returned')
BEGIN SELECT RAISE(ABORT, 'La revisión de una actividad es pendiente o devuelta.'); END;
CREATE TRIGGER IF NOT EXISTS activities_review_status_update BEFORE UPDATE OF review_status ON assessment_activities
WHEN NEW.review_status IS NOT NULL AND NEW.review_status NOT IN ('pending','returned')
BEGIN SELECT RAISE(ABORT, 'La revisión de una actividad es pendiente o devuelta.'); END;

CREATE TABLE IF NOT EXISTS section_proposals (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('unit','lesson','activity')),
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  result_id TEXT
);
CREATE INDEX IF NOT EXISTS section_proposals_by_section ON section_proposals(group_id, status);
