-- Who teaches each course and what each person did. People get a display name (fictional in the demo);
-- the teaching team has one lead and any number of co-teachers; the activity log records configuration
-- and authoring operations with their author, so progress and contributions can be reviewed.
ALTER TABLE users ADD COLUMN display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 2 AND 80);
UPDATE users SET display_name='Administración de la demostración' WHERE id='user-0' AND display_name IS NULL;
UPDATE users SET display_name='Instructor de la demostración' WHERE id='user-1' AND display_name IS NULL;
UPDATE users SET display_name='Educador de la demostración' WHERE id='user-educator' AND display_name IS NULL;
UPDATE users SET display_name='Educador externo' WHERE id='user-2' AND display_name IS NULL;

CREATE TABLE course_members (
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('lead','co-teacher')),
  added_at TEXT NOT NULL,
  PRIMARY KEY(course_id,user_id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
-- At most one lead per course.
CREATE UNIQUE INDEX course_members_one_lead ON course_members(course_id) WHERE role='lead';
CREATE INDEX course_members_user ON course_members(user_id);
-- A member must belong to the course's organization.
CREATE TRIGGER course_members_organization BEFORE INSERT ON course_members
WHEN NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.user_id AND m.organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'member belongs to another organization'); END;

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','published','archived','restored','planned','recorded','uploaded','assigned')),
  target_type TEXT NOT NULL CHECK(target_type IN ('course','program','module','lesson','resource','competency','outcome','group','session','team')),
  target_id TEXT NOT NULL,
  course_id TEXT,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
CREATE INDEX activity_events_course ON activity_events(course_id,occurred_at DESC);
CREATE INDEX activity_events_actor ON activity_events(actor_id,occurred_at DESC);
CREATE INDEX activity_events_organization ON activity_events(organization_id,occurred_at DESC);

-- The demo course was prepared by the demo educator.
INSERT INTO course_members(course_id,organization_id,user_id,role,added_at)
SELECT c.id,c.organization_id,'user-educator','lead',c.updated_at FROM courses c
WHERE c.id='course-exploradores' AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id='user-educator' AND m.organization_id=c.organization_id);
