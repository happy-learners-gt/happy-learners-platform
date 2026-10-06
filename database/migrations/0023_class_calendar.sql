-- DEC-026: days without class for the whole organization (group_id NULL) or for one section; schedules skip them.
CREATE TABLE calendar_breaks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  group_id TEXT REFERENCES course_groups(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  starts_on TEXT NOT NULL CHECK(starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  ends_on TEXT NOT NULL CHECK(ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND ends_on >= starts_on),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX calendar_breaks_organization ON calendar_breaks(organization_id, starts_on);

-- What a finished class covered of each lesson. Classes finished before DEC-026 covered all of their lessons.
ALTER TABLE class_session_lessons ADD COLUMN outcome TEXT CHECK(outcome IS NULL OR outcome IN ('completed','partial','not_reached'));
UPDATE class_session_lessons SET outcome = 'completed' WHERE session_id IN (SELECT id FROM class_sessions WHERE status = 'completed');
