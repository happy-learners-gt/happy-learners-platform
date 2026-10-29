-- Data-driven grading schemes and non-points marks (REL-011, 1.3.1).
-- Additive: the existing points plan remains "general" and keeps using assessment_scores.

CREATE TABLE IF NOT EXISTS grading_schemes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL,
  config TEXT NOT NULL CHECK(json_valid(config)),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, name_key)
);
CREATE INDEX IF NOT EXISTS grading_schemes_by_organization ON grading_schemes(organization_id, status, name);

ALTER TABLE assessment_activities ADD COLUMN category_id TEXT NOT NULL DEFAULT 'general';
ALTER TABLE assessment_activities ADD COLUMN grading TEXT NOT NULL DEFAULT 'points'
  CHECK(grading IN ('points','rubric','pass-fail','level','panel'));
ALTER TABLE assessment_activities ADD COLUMN extra INTEGER NOT NULL DEFAULT 0 CHECK(extra IN (0,1));
ALTER TABLE assessment_activities ADD COLUMN retake_of TEXT REFERENCES assessment_activities(id);
ALTER TABLE assessment_activities ADD COLUMN rubric TEXT CHECK(rubric IS NULL OR json_valid(rubric));
ALTER TABLE assessment_activities ADD COLUMN panel TEXT CHECK(panel IS NULL OR json_valid(panel));

CREATE TABLE IF NOT EXISTS assessment_evaluators (
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  chair INTEGER NOT NULL DEFAULT 0 CHECK(chair IN (0,1)),
  PRIMARY KEY(activity_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_evaluators_one_chair
  ON assessment_evaluators(activity_id) WHERE chair=1;

CREATE TABLE IF NOT EXISTS assessment_marks (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  evaluator_id TEXT REFERENCES users(id),
  mark TEXT NOT NULL CHECK(json_valid(mark)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(learner_id, group_id, organization_id) REFERENCES group_learners(id, group_id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_marks_one_per_evaluator
  ON assessment_marks(activity_id, learner_id, COALESCE(evaluator_id,''));
CREATE INDEX IF NOT EXISTS assessment_marks_by_group ON assessment_marks(group_id, learner_id);

CREATE TABLE IF NOT EXISTS assessment_mark_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  evaluator_id TEXT REFERENCES users(id),
  before_mark TEXT CHECK(before_mark IS NULL OR json_valid(before_mark)),
  after_mark TEXT CHECK(after_mark IS NULL OR json_valid(after_mark)),
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_mark_history_by_learner
  ON assessment_mark_history(group_id, learner_id, changed_at);
CREATE TRIGGER IF NOT EXISTS assessment_mark_history_append_only BEFORE UPDATE ON assessment_mark_history
BEGIN SELECT RAISE(ABORT, 'grade history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS assessment_mark_history_keep BEFORE DELETE ON assessment_mark_history
BEGIN SELECT RAISE(ABORT, 'grade history is append-only'); END;

-- Marks change only in the current year while the section's period is open and not handed in.
CREATE TRIGGER IF NOT EXISTS assessment_marks_insert BEFORE INSERT ON assessment_marks
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a
  JOIN academic_periods p ON p.id=a.period_id
  JOIN academic_years y ON y.id=p.year_id
  JOIN course_groups g ON g.id=NEW.group_id AND g.course_id=a.course_id AND g.organization_id=NEW.organization_id
  WHERE a.id=NEW.activity_id AND a.organization_id=NEW.organization_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=NEW.group_id
  WHERE a.id=NEW.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=NEW.group_id AND r.status='submitted'
  WHERE a.id=NEW.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER IF NOT EXISTS assessment_marks_update BEFORE UPDATE ON assessment_marks
WHEN NEW.activity_id<>OLD.activity_id OR NEW.learner_id<>OLD.learner_id OR NEW.group_id<>OLD.group_id
  OR NEW.organization_id<>OLD.organization_id OR COALESCE(NEW.evaluator_id,'')<>COALESCE(OLD.evaluator_id,'')
  OR NOT EXISTS (
    SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    WHERE a.id=OLD.activity_id AND y.status='current'
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=OLD.group_id
    WHERE a.id=OLD.activity_id
  ) OR EXISTS (
    SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=OLD.group_id AND r.status='submitted'
    WHERE a.id=OLD.activity_id
  )
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER IF NOT EXISTS assessment_marks_delete BEFORE DELETE ON assessment_marks
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
  WHERE a.id=OLD.activity_id AND y.status='current'
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=OLD.group_id
  WHERE a.id=OLD.activity_id
) OR EXISTS (
  SELECT 1 FROM assessment_activities a JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=OLD.group_id AND r.status='submitted'
  WHERE a.id=OLD.activity_id
)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

CREATE TRIGGER IF NOT EXISTS assessment_activities_keep_marks BEFORE DELETE ON assessment_activities
WHEN EXISTS (SELECT 1 FROM assessment_marks m WHERE m.activity_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'activity has marks'); END;
