-- ST-093: administration creates the team's accounts, turns their access off and on and resets their password.
-- An account created or reset by administration signs in with a temporary password and must replace it first.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));

-- Each change to an account is part of the organization's activity (target 'account'; a password reset is 'reset').
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt; every row and column is copied unchanged.
CREATE TABLE activity_events_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','published','archived','restored','planned','recorded','uploaded','assigned','reset')),
  target_type TEXT NOT NULL CHECK(target_type IN ('course','program','module','lesson','resource','competency','outcome','group','session','team','account')),
  target_id TEXT NOT NULL,
  course_id TEXT,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  occurred_at TEXT NOT NULL,
  group_id TEXT REFERENCES course_groups(id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
INSERT INTO activity_events_v2(id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id)
  SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events;
DROP TABLE activity_events;
ALTER TABLE activity_events_v2 RENAME TO activity_events;
CREATE INDEX activity_events_course ON activity_events(course_id,occurred_at DESC);
CREATE INDEX activity_events_actor ON activity_events(actor_id,occurred_at DESC);
CREATE INDEX activity_events_organization ON activity_events(organization_id,occurred_at DESC);
CREATE INDEX activity_events_group ON activity_events(group_id,occurred_at DESC);
