-- Group sets and group grading (lote 3a). A set is a reusable split of one section. The section's
-- existing work groups stay set_id NULL and keep a unique name among themselves; each set may repeat «Grupo 1».
-- A group activity copies its mark onto each member. source says whether that row came from the group or from a hand edit.

CREATE TABLE work_group_sets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  rules TEXT NOT NULL CHECK(json_valid(rules)),
  source TEXT NOT NULL CHECK(source IN ('manual','generated')),
  session_id TEXT REFERENCES class_sessions(id),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX work_group_sets_section ON work_group_sets(group_id, archived, name);

ALTER TABLE work_groups ADD COLUMN set_id TEXT REFERENCES work_group_sets(id);
DROP INDEX IF EXISTS work_groups_name;
CREATE UNIQUE INDEX work_groups_name_in_set ON work_groups(group_id, ifnull(set_id, ''), name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS work_groups_by_set ON work_groups(set_id);

ALTER TABLE assessment_activities ADD COLUMN group_mode TEXT NOT NULL DEFAULT 'individual' CHECK(group_mode IN ('individual','group'));
ALTER TABLE assessment_activities ADD COLUMN work_group_set_id TEXT REFERENCES work_group_sets(id);
ALTER TABLE assessment_activities ADD COLUMN peer_min REAL NOT NULL DEFAULT 0.5;
ALTER TABLE assessment_activities ADD COLUMN peer_max REAL NOT NULL DEFAULT 1.5;

ALTER TABLE assessment_scores ADD COLUMN source TEXT NOT NULL DEFAULT 'individual' CHECK(source IN ('individual','group'));
ALTER TABLE assessment_marks ADD COLUMN source TEXT NOT NULL DEFAULT 'individual' CHECK(source IN ('individual','group'));

CREATE TABLE assessment_group_marks (
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  work_group_id TEXT NOT NULL REFERENCES work_groups(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  mark TEXT NOT NULL CHECK(json_valid(mark)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(activity_id, work_group_id)
);

CREATE TABLE assessment_group_adjustments (
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  learner_id TEXT NOT NULL REFERENCES group_learners(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  kind TEXT NOT NULL CHECK(kind IN ('factor','override','peer')),
  value REAL NOT NULL,
  note TEXT CHECK(note IS NULL OR length(note) <= 200),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(activity_id, learner_id)
);

CREATE TABLE assessment_peer_ratings (
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  rater_id TEXT NOT NULL REFERENCES group_learners(id),
  ratee_id TEXT NOT NULL REFERENCES group_learners(id),
  score REAL NOT NULL CHECK(score >= 0 AND score <= 5 AND round(score * 10) = score * 10),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(activity_id, rater_id, ratee_id),
  CHECK(rater_id <> ratee_id)
);

-- Group marks, adjustments and coevaluation follow the same lock as other marks: current year, period open, not handed in.
CREATE TRIGGER assessment_group_marks_insert BEFORE INSERT ON assessment_group_marks
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
  JOIN course_groups g ON g.id=NEW.group_id AND g.course_id=a.course_id AND g.organization_id=NEW.organization_id
  WHERE a.id=NEW.activity_id AND a.organization_id=NEW.organization_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=NEW.group_id WHERE a.id=NEW.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=NEW.group_id AND r.status='submitted' WHERE a.id=NEW.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER assessment_group_marks_update BEFORE UPDATE ON assessment_group_marks
WHEN NEW.activity_id<>OLD.activity_id OR NEW.work_group_id<>OLD.work_group_id OR NEW.group_id<>OLD.group_id OR NEW.organization_id<>OLD.organization_id
  OR NOT EXISTS (
    SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    WHERE a.id=OLD.activity_id AND y.status='current'
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=OLD.group_id WHERE a.id=OLD.activity_id
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=OLD.group_id AND r.status='submitted' WHERE a.id=OLD.activity_id
  )
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER assessment_group_adjustments_insert BEFORE INSERT ON assessment_group_adjustments
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
  WHERE a.id=NEW.activity_id AND a.organization_id=NEW.organization_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=NEW.group_id WHERE a.id=NEW.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=NEW.group_id AND r.status='submitted' WHERE a.id=NEW.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER assessment_group_adjustments_update BEFORE UPDATE ON assessment_group_adjustments
WHEN NEW.activity_id<>OLD.activity_id OR NEW.learner_id<>OLD.learner_id OR NEW.group_id<>OLD.group_id OR NEW.organization_id<>OLD.organization_id
  OR NOT EXISTS (
    SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    WHERE a.id=OLD.activity_id AND y.status='current'
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=OLD.group_id WHERE a.id=OLD.activity_id
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=OLD.group_id AND r.status='submitted' WHERE a.id=OLD.activity_id
  )
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER assessment_peer_ratings_insert BEFORE INSERT ON assessment_peer_ratings
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
  JOIN work_group_sets s ON s.id=a.work_group_set_id
  WHERE a.id=NEW.activity_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN work_group_sets s ON s.id=a.work_group_set_id
  JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=s.group_id WHERE a.id=NEW.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN work_group_sets s ON s.id=a.work_group_set_id
  JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=s.group_id AND r.status='submitted' WHERE a.id=NEW.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER assessment_peer_ratings_delete BEFORE DELETE ON assessment_peer_ratings
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
  WHERE a.id=OLD.activity_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN work_group_sets s ON s.id=a.work_group_set_id
  JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=s.group_id WHERE a.id=OLD.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN work_group_sets s ON s.id=a.work_group_set_id
  JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=s.group_id AND r.status='submitted' WHERE a.id=OLD.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;
