-- The minimal gradebook (libreta). Each active student of a section's roster (group_learners, identified by its id,
-- never by name) has at most one score per period of the school year: a number from 0 to 100 with one decimal. A
-- missing score is simply no row, never a zero. Each period gains the weight a weighted average uses. A section may
-- lock a period's scores; a closed school year locks all of its scores. Closing a year promotes nobody.
-- Additive: existing tables keep their rows.

ALTER TABLE academic_periods ADD COLUMN weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS section_grades (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  score REAL NOT NULL CHECK(score >= 0 AND score <= 100 AND round(score * 10) = score * 10),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(learner_id, group_id, organization_id) REFERENCES group_learners(id, group_id, organization_id),
  UNIQUE(learner_id, period_id)
);
CREATE INDEX IF NOT EXISTS section_grades_by_group ON section_grades(group_id, period_id);

CREATE TABLE IF NOT EXISTS section_period_locks (
  group_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  period_id TEXT NOT NULL REFERENCES academic_periods(id),
  locked_by TEXT NOT NULL REFERENCES users(id),
  locked_at TEXT NOT NULL,
  PRIMARY KEY(group_id, period_id)
);

-- Scores are written only in the current year, in a period of the student's organization, while the section has
-- not locked it.
CREATE TRIGGER IF NOT EXISTS section_grades_insert BEFORE INSERT ON section_grades
WHEN NOT EXISTS (SELECT 1 FROM academic_periods p JOIN academic_years y ON y.id = p.year_id WHERE p.id = NEW.period_id AND p.organization_id = NEW.organization_id AND y.status = 'current')
  OR EXISTS (SELECT 1 FROM section_period_locks l WHERE l.group_id = NEW.group_id AND l.period_id = NEW.period_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;
CREATE TRIGGER IF NOT EXISTS section_grades_update BEFORE UPDATE ON section_grades
WHEN NEW.learner_id <> OLD.learner_id OR NEW.period_id <> OLD.period_id OR NEW.group_id <> OLD.group_id OR NEW.organization_id <> OLD.organization_id
  OR NOT EXISTS (SELECT 1 FROM academic_periods p JOIN academic_years y ON y.id = p.year_id WHERE p.id = OLD.period_id AND y.status = 'current')
  OR EXISTS (SELECT 1 FROM section_period_locks l WHERE l.group_id = OLD.group_id AND l.period_id = OLD.period_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;
CREATE TRIGGER IF NOT EXISTS section_grades_delete BEFORE DELETE ON section_grades
WHEN NOT EXISTS (SELECT 1 FROM academic_periods p JOIN academic_years y ON y.id = p.year_id WHERE p.id = OLD.period_id AND y.status = 'current')
  OR EXISTS (SELECT 1 FROM section_period_locks l WHERE l.group_id = OLD.group_id AND l.period_id = OLD.period_id)
BEGIN SELECT RAISE(ABORT, 'grades of this period are closed'); END;

-- A period with scores stays: the year can be edited, but not by removing where grades were recorded.
CREATE TRIGGER IF NOT EXISTS academic_periods_keep_grades BEFORE DELETE ON academic_periods
WHEN EXISTS (SELECT 1 FROM section_grades g WHERE g.period_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'period has grades'); END;
