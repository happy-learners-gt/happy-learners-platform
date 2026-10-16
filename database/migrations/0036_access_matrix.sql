-- ST-128, ST-135 (DEC-041, DEC-043): roles and access. The permission catalog lives in the domain; these tables hold
-- what administration grants: the academic coordination profile of an educator with its program scope, security
-- groups with their permissions (each with a program scope) and members, and the audit of every change.
-- A program_id of '*' means every program. Effective permissions are read again on every request.
-- Backups copy these tables like any other.
CREATE TABLE coordination_scopes (
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  program_id TEXT NOT NULL CHECK(program_id = '*' OR length(program_id) BETWEEN 1 AND 100),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, organization_id, program_id)
);

CREATE TABLE security_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 300),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name_key)
);

-- Administration permissions (organization, accounts, access, backup, legal) are not in this list: no group grants them.
CREATE TABLE security_group_grants (
  group_id TEXT NOT NULL REFERENCES security_groups(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  permission TEXT NOT NULL CHECK(permission IN ('courses.view','lessons.review','teams.assign','sections.assign','classes.view','activity.view')),
  program_id TEXT NOT NULL CHECK(program_id = '*' OR length(program_id) BETWEEN 1 AND 100),
  PRIMARY KEY (group_id, permission, program_id)
);

CREATE TABLE security_group_members (
  group_id TEXT NOT NULL REFERENCES security_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX security_group_members_user ON security_group_members(user_id);

-- The audit of the access matrix: who changed which group or coordination profile, and when. Kept when a group is deleted.
CREATE TABLE access_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','granted','members','assigned','revoked')),
  subject_type TEXT NOT NULL CHECK(subject_type IN ('group','coordination')),
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL CHECK(length(summary) <= 400),
  occurred_at TEXT NOT NULL
);
CREATE INDEX access_events_time ON access_events(organization_id, occurred_at DESC);
