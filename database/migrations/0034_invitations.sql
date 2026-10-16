-- ST-121: administration invites people by e-mail with their role; they accept from a link that expires.
-- Staff e-mail addresses are personal data seen only by administration (DEC-012); unique within the organization.
ALTER TABLE users ADD COLUMN email TEXT CHECK(email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email = lower(email)));
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;

-- Only the SHA-256 of the link's secret is stored, as for sessions; resending replaces it, so the previous link stops working.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 80),
  role TEXT NOT NULL CHECK(role IN ('admin','educator')),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','expired')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_user_id TEXT REFERENCES users(id),
  CHECK((status = 'accepted') = (accepted_user_id IS NOT NULL))
);
-- One open invitation per address.
CREATE UNIQUE INDEX invitations_pending_email ON invitations(organization_id,email) WHERE status = 'pending';
CREATE INDEX invitations_created ON invitations(organization_id,created_at DESC);

-- DEC-042: every message passes through the organization's outbox, with its attempts and a daily cap.
-- The body is not kept: it carries the link, whose secret is never stored. Retrying a message issues a new link.
CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('invitation')),
  reference_id TEXT,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','not_configured','deferred')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT CHECK(last_error IS NULL OR length(last_error) <= 240),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT
);
CREATE INDEX mail_outbox_reference ON mail_outbox(reference_id,created_at DESC);
CREATE INDEX mail_outbox_sent ON mail_outbox(organization_id,status,sent_at);

-- Invitations are part of the activity (target 'invitation'; actions 'resent', 'revoked' and 'accepted').
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt as in 0031; every row is copied unchanged.
-- The lists keep every value earlier migrations admit, including 0032's ('accepted','withdrawn'; 'legal').
CREATE TABLE activity_events_v3 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','published','archived','restored','planned','recorded','uploaded','assigned','reset','accepted','withdrawn','resent','revoked')),
  target_type TEXT NOT NULL CHECK(target_type IN ('course','program','module','lesson','resource','competency','outcome','group','session','team','account','legal','invitation')),
  target_id TEXT NOT NULL,
  course_id TEXT,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  occurred_at TEXT NOT NULL,
  group_id TEXT REFERENCES course_groups(id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
INSERT INTO activity_events_v3(id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id)
  SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events;
DROP TABLE activity_events;
ALTER TABLE activity_events_v3 RENAME TO activity_events;
CREATE INDEX activity_events_course ON activity_events(course_id,occurred_at DESC);
CREATE INDEX activity_events_actor ON activity_events(actor_id,occurred_at DESC);
CREATE INDEX activity_events_organization ON activity_events(organization_id,occurred_at DESC);
CREATE INDEX activity_events_group ON activity_events(group_id,occurred_at DESC);
