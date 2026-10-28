-- Academic calendar (REL-010, 1.2.4). The organization's bell schedules (jornadas): class periods and breaks of a
-- school day, generated from the entry time, the length of each period, the passing time and the breaks; the
-- configuration and its blocks are kept as JSON. A section's schedule may give each class day its own time
-- (schedule_meetings, JSON); the single-time columns still hold the first meeting for readers that only know one.
-- Additive: existing rows keep their schedules.

CREATE TABLE IF NOT EXISTS bell_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  weekdays TEXT NOT NULL CHECK(weekdays GLOB '[0-6]*'),
  config TEXT NOT NULL CHECK(json_valid(config)),
  blocks TEXT NOT NULL CHECK(json_valid(blocks) AND json_type(blocks) = 'array'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bell_schedules_name ON bell_schedules(organization_id, lower(name));

ALTER TABLE course_groups ADD COLUMN schedule_meetings TEXT CHECK(schedule_meetings IS NULL OR (json_valid(schedule_meetings) AND json_type(schedule_meetings) = 'array'));
