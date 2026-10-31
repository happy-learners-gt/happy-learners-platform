-- Classrooms (1.5.3, docs/design/asistente-ia.md §6d). An organization's classrooms with their capacity, archived rather
-- than deleted; a section may have a usual classroom. Generating timetables gives each section one classroom for the
-- week: no classroom holds two classes at once.

CREATE TABLE classrooms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX classrooms_name ON classrooms(organization_id, name COLLATE NOCASE) WHERE status = 'active';
ALTER TABLE course_groups ADD COLUMN classroom_id TEXT REFERENCES classrooms(id);
