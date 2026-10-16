-- ST-124: e-mail notifications of the changes that affect a person (DEC-042).
-- Administration marks which types are mandatory; a type without a row is optional.
CREATE TABLE notification_policies (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK(type IN ('course_assignment','section_assignment','review_submitted','review_returned','review_approved','class_changed','class_cancelled')),
  mandatory INTEGER NOT NULL DEFAULT 0 CHECK(mandatory IN (0,1)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(organization_id,type)
);
-- Each person's choice per type; a type without a row is on.
CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK(type IN ('course_assignment','section_assignment','review_submitted','review_returned','review_approved','class_changed','class_cancelled')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,type)
);

-- The outbox records notifications too (kind 'notification'), with the person, the type, the reason (motivo) and
-- whether the type was mandatory; a person without an address gets a record with status 'no_address' and an empty
-- recipient. SQLite cannot change a CHECK in place, so the table is rebuilt: every existing row is copied unchanged,
-- in its order, and the indexes are recreated. The body is still never stored.
CREATE TABLE mail_outbox_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('invitation','notification')),
  reference_id TEXT,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254 OR (status = 'no_address' AND recipient = '')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','not_configured','deferred','no_address')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT CHECK(last_error IS NULL OR length(last_error) <= 240),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT,
  user_id TEXT,
  notification_type TEXT CHECK(notification_type IS NULL OR notification_type IN ('course_assignment','section_assignment','review_submitted','review_returned','review_approved','class_changed','class_cancelled')),
  reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 240),
  mandatory INTEGER NOT NULL DEFAULT 0 CHECK(mandatory IN (0,1)),
  CHECK(CASE WHEN kind = 'notification' THEN notification_type IS NOT NULL AND reason IS NOT NULL AND user_id IS NOT NULL
    ELSE notification_type IS NULL AND reason IS NULL AND user_id IS NULL AND mandatory = 0 END)
);
INSERT INTO mail_outbox_v2(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id)
  SELECT id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id FROM mail_outbox ORDER BY rowid;
DROP TABLE mail_outbox;
ALTER TABLE mail_outbox_v2 RENAME TO mail_outbox;
CREATE INDEX mail_outbox_reference ON mail_outbox(reference_id,created_at DESC);
CREATE INDEX mail_outbox_sent ON mail_outbox(organization_id,status,sent_at);
CREATE INDEX mail_outbox_kind ON mail_outbox(organization_id,kind,created_at DESC);
CREATE INDEX mail_outbox_person ON mail_outbox(user_id,created_at DESC) WHERE user_id IS NOT NULL;
