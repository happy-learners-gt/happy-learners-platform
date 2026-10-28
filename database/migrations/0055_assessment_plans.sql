-- Professional gradebook (REL-010, 1.2.3). A course's assessment plan per period: evaluation activities (tasks,
-- project, exam…) whose points add up to 100, shared by the course's sections. Each roster student earns from 0 up to
-- an activity's points; the section's period score (section_grades) is then the sum of what was earned so far. Comments
-- per student and period, an append-only history of score changes, and the period's closing review: the section
-- hands the period in, coordination or administration returns it or approves it (which locks it).
-- Additive: existing tables keep their rows.

CREATE TABLE IF NOT EXISTS assessment_activities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  position INTEGER NOT NULL CHECK(position >= 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK(kind IN ('task','project','quiz','exam','participation','other')),
  points REAL NOT NULL CHECK(points > 0 AND points <= 100 AND round(points * 10) = points * 10),
  due_on TEXT CHECK(due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_activities_by_course ON assessment_activities(course_id, period_id, position);

CREATE TABLE IF NOT EXISTS assessment_scores (
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  points REAL NOT NULL CHECK(points >= 0 AND points <= 100 AND round(points * 10) = points * 10),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(learner_id, group_id, organization_id) REFERENCES group_learners(id, group_id, organization_id),
  PRIMARY KEY(activity_id, learner_id)
);
CREATE INDEX IF NOT EXISTS assessment_scores_by_group ON assessment_scores(group_id);

-- An activity's score never exceeds its points, and is written only while the period is open in the current year
-- and the section has not locked it.
CREATE TRIGGER IF NOT EXISTS assessment_scores_insert BEFORE INSERT ON assessment_scores
WHEN NOT EXISTS (SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id = a.period_id JOIN academic_years y ON y.id = p.year_id
    WHERE a.id = NEW.activity_id AND a.organization_id = NEW.organization_id AND y.status = 'current' AND NEW.points <= a.points)
  OR EXISTS (SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id = a.period_id AND l.group_id = NEW.group_id WHERE a.id = NEW.activity_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;
CREATE TRIGGER IF NOT EXISTS assessment_scores_update BEFORE UPDATE ON assessment_scores
WHEN NEW.activity_id <> OLD.activity_id OR NEW.learner_id <> OLD.learner_id OR NEW.group_id <> OLD.group_id OR NEW.organization_id <> OLD.organization_id
  OR NOT EXISTS (SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id = a.period_id JOIN academic_years y ON y.id = p.year_id
    WHERE a.id = OLD.activity_id AND y.status = 'current' AND NEW.points <= a.points)
  OR EXISTS (SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id = a.period_id AND l.group_id = OLD.group_id WHERE a.id = OLD.activity_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;
CREATE TRIGGER IF NOT EXISTS assessment_scores_delete BEFORE DELETE ON assessment_scores
WHEN NOT EXISTS (SELECT 1 FROM assessment_activities a JOIN academic_periods p ON p.id = a.period_id JOIN academic_years y ON y.id = p.year_id WHERE a.id = OLD.activity_id AND y.status = 'current')
  OR EXISTS (SELECT 1 FROM assessment_activities a JOIN section_period_locks l ON l.period_id = a.period_id AND l.group_id = OLD.group_id WHERE a.id = OLD.activity_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

-- An activity with scores stays, and its points never drop below a score already given; the plan of a closed year
-- does not change.
CREATE TRIGGER IF NOT EXISTS assessment_activities_keep_scores BEFORE DELETE ON assessment_activities
WHEN EXISTS (SELECT 1 FROM assessment_scores s WHERE s.activity_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'activity has scores'); END;
CREATE TRIGGER IF NOT EXISTS assessment_activities_points BEFORE UPDATE ON assessment_activities
WHEN NEW.course_id <> OLD.course_id OR NEW.period_id <> OLD.period_id OR NEW.organization_id <> OLD.organization_id
  OR EXISTS (SELECT 1 FROM assessment_scores s WHERE s.activity_id = OLD.id AND s.points > NEW.points)
BEGIN SELECT RAISE(ABORT, 'activity has higher scores'); END;
CREATE TRIGGER IF NOT EXISTS assessment_activities_open_year BEFORE INSERT ON assessment_activities
WHEN NOT EXISTS (SELECT 1 FROM academic_periods p JOIN academic_years y ON y.id = p.year_id WHERE p.id = NEW.period_id AND p.organization_id = NEW.organization_id AND y.status = 'current')
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

-- A period with a plan stays in its year.
CREATE TRIGGER IF NOT EXISTS academic_periods_keep_plans BEFORE DELETE ON academic_periods
WHEN EXISTS (SELECT 1 FROM assessment_activities a WHERE a.period_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'period has grades'); END;

CREATE TABLE IF NOT EXISTS section_grade_comments (
  learner_id TEXT NOT NULL,
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  group_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 600),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(learner_id, group_id, organization_id) REFERENCES group_learners(id, group_id, organization_id),
  PRIMARY KEY(learner_id, period_id)
);
CREATE INDEX IF NOT EXISTS section_grade_comments_by_group ON section_grade_comments(group_id, period_id);

-- Append-only: who changed which score, from what to what. Empty is null.
CREATE TABLE IF NOT EXISTS section_grade_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  activity_id TEXT REFERENCES assessment_activities(id),
  before REAL,
  after REAL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS section_grade_history_by_learner ON section_grade_history(group_id, learner_id, changed_at);
CREATE TRIGGER IF NOT EXISTS section_grade_history_append_only BEFORE UPDATE ON section_grade_history
BEGIN SELECT RAISE(ABORT, 'grade history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS section_grade_history_keep BEFORE DELETE ON section_grade_history
BEGIN SELECT RAISE(ABORT, 'grade history is append-only'); END;

-- The closing review of a section's period: handed in, returned with a note, or approved (the lock is the closing).
CREATE TABLE IF NOT EXISTS section_period_reviews (
  group_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  status TEXT NOT NULL CHECK(status IN ('submitted','returned','approved')),
  note TEXT CHECK(note IS NULL OR length(note) <= 600),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  PRIMARY KEY(group_id, period_id)
);
