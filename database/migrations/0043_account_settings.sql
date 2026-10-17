-- ST-158, ST-159: account settings and closing the account.

-- Each session gains a public id (never its token hash), when it started and was last used, the device summary derived
-- from the User-Agent (the header itself is not kept) and the country from CF-IPCountry. No IP address is stored.
-- SQLite cannot add a column with a computed default in place, so the table is rebuilt: open sessions keep their token
-- hash, person and expiry, get a new id, and count as started 8 hours before they expire (the session lifetime).
-- The defaults keep any insert that only names token_hash, user_id and expires_at working.
CREATE TABLE sessions_v2 (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE DEFAULT ('session-' || lower(hex(randomblob(16)))) CHECK(id GLOB 'session-*' AND length(id) = 40),
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  last_used_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  method TEXT NOT NULL DEFAULT 'password' CHECK(method IN ('password','invitation')),
  device TEXT CHECK(device IS NULL OR length(device) BETWEEN 1 AND 80),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country = upper(country))),
  CHECK(last_used_at >= created_at)
);
INSERT INTO sessions_v2(token_hash,user_id,expires_at,created_at,last_used_at)
  SELECT token_hash,user_id,expires_at,expires_at-28800000,expires_at-28800000 FROM sessions ORDER BY rowid;
DROP TABLE sessions;
ALTER TABLE sessions_v2 RENAME TO sessions;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id, last_used_at DESC);

-- The sign-in history of each account: successful and failed attempts with a known username (an unknown username has
-- no account to show it to). Same device summary and country as sessions; records older than 90 days are pruned.
CREATE TABLE sign_in_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed')),
  method TEXT NOT NULL CHECK(method IN ('password','invitation')),
  device TEXT NOT NULL CHECK(length(device) BETWEEN 1 AND 80),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country = upper(country))),
  occurred_at TEXT NOT NULL
);
CREATE INDEX sign_in_events_user ON sign_in_events(user_id, occurred_at DESC);
CREATE INDEX sign_in_events_organization ON sign_in_events(organization_id, occurred_at);

-- A change of the sign-in e-mail: pending until the link sent to the new address is confirmed (verified) or 24 hours
-- pass (read as expired); a newer request or the person cancels it (cancelled). Only the SHA-256 of the link's secret
-- is kept. At most one pending change per person; once it leaves pending, a change never moves again.
CREATE TABLE email_changes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_email TEXT CHECK(previous_email IS NULL OR (length(previous_email) BETWEEN 3 AND 254 AND previous_email = lower(previous_email))),
  new_email TEXT NOT NULL CHECK(length(new_email) BETWEEN 3 AND 254 AND new_email = lower(new_email)),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','expired','cancelled')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > requested_at),
  verified_at TEXT CHECK(verified_at IS NULL OR verified_at >= requested_at),
  cancelled_at TEXT CHECK(cancelled_at IS NULL OR cancelled_at >= requested_at),
  CHECK(previous_email IS NULL OR previous_email <> new_email),
  CHECK((status = 'verified') = (verified_at IS NOT NULL)),
  CHECK((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX email_changes_pending ON email_changes(user_id) WHERE status = 'pending';
CREATE INDEX email_changes_user ON email_changes(user_id, requested_at DESC);
CREATE TRIGGER email_changes_final BEFORE UPDATE ON email_changes WHEN OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT,'an e-mail change only moves while pending'); END;

-- ST-159: requests to close an account. requested -> in_progress (administration starts it) -> completed (the person's
-- departure, ST-123, is recorded: departure_id names it); requested -> cancelled (the person, before it starts).
-- Recording the departure of someone with a request still waiting completes it too. At most one open request per
-- person; the rows are kept (no delete) and copied by backups like departures.
CREATE TABLE account_closures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('requested','in_progress','completed','cancelled')),
  reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 500),
  requested_at TEXT NOT NULL,
  started_at TEXT CHECK(started_at IS NULL OR started_at >= requested_at),
  started_by TEXT REFERENCES users(id),
  completed_at TEXT CHECK(completed_at IS NULL OR completed_at >= requested_at),
  departure_id TEXT REFERENCES departures(id),
  cancelled_at TEXT CHECK(cancelled_at IS NULL OR cancelled_at >= requested_at),
  CHECK((started_at IS NULL) = (started_by IS NULL)),
  CHECK(status <> 'in_progress' OR started_at IS NOT NULL),
  CHECK((status = 'completed') = (completed_at IS NOT NULL AND departure_id IS NOT NULL)),
  CHECK((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK(status <> 'cancelled' OR started_at IS NULL)
);
CREATE UNIQUE INDEX account_closures_open ON account_closures(user_id) WHERE status IN ('requested','in_progress');
CREATE INDEX account_closures_organization ON account_closures(organization_id, requested_at DESC);
CREATE TRIGGER account_closures_transition BEFORE UPDATE ON account_closures
WHEN NOT ((OLD.status = 'requested' AND NEW.status IN ('in_progress','cancelled','completed')) OR (OLD.status = 'in_progress' AND NEW.status = 'completed'))
  OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.user_id <> OLD.user_id OR NEW.reason <> OLD.reason OR NEW.requested_at <> OLD.requested_at
BEGIN SELECT RAISE(ABORT,'a closure request only moves forward'); END;
CREATE TRIGGER account_closures_delete BEFORE DELETE ON account_closures
BEGIN SELECT RAISE(ABORT,'closure requests are kept'); END;

-- The outbox records the account's security notices too (kind 'account'): the e-mail confirmation, the notices to the
-- previous address, a password change, and a closure request (to administration) or its start (to the person). They
-- are mandatory by nature and name the person and the reason. The table is rebuilt as in 0039: every row is copied
-- unchanged, in its order, and the indexes are recreated. The body is still never stored.
-- The activity records these flows with the actions and target ('account') it already admits, so it is not rebuilt.
CREATE TABLE mail_outbox_v3 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('invitation','notification','account')),
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
  CHECK(CASE kind WHEN 'notification' THEN notification_type IS NOT NULL AND reason IS NOT NULL AND user_id IS NOT NULL
    WHEN 'account' THEN notification_type IS NULL AND reason IS NOT NULL AND user_id IS NOT NULL AND mandatory = 1
    ELSE notification_type IS NULL AND reason IS NULL AND user_id IS NULL AND mandatory = 0 END)
);
INSERT INTO mail_outbox_v3(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory)
  SELECT id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory FROM mail_outbox ORDER BY rowid;
DROP TABLE mail_outbox;
ALTER TABLE mail_outbox_v3 RENAME TO mail_outbox;
CREATE INDEX mail_outbox_reference ON mail_outbox(reference_id,created_at DESC);
CREATE INDEX mail_outbox_sent ON mail_outbox(organization_id,status,sent_at);
CREATE INDEX mail_outbox_kind ON mail_outbox(organization_id,kind,created_at DESC);
CREATE INDEX mail_outbox_person ON mail_outbox(user_id,created_at DESC) WHERE user_id IS NOT NULL;
