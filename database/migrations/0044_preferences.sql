-- ST-160, ST-161 (DEC-045): each person's regional, appearance and notification preferences.

-- The organization's regional format (BCP 47) is the default of every person who has not chosen one. Neutral Spanish
-- keeps what the screens showed until now (24-hour clock, weeks from Monday); each organization may choose its own.
ALTER TABLE organizations ADD COLUMN locale TEXT NOT NULL DEFAULT 'es' CHECK(length(locale) BETWEEN 2 AND 35 AND locale NOT GLOB '*[^A-Za-z0-9-]*');

-- Regional and appearance preferences (ST-160). A NULL locale, zone, first day or hour cycle follows the organization
-- (locale and zone) or the regional format (first day and hour cycle); a person without a row has every default.
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  language TEXT NOT NULL DEFAULT 'es' CHECK(length(language) BETWEEN 2 AND 3 AND language NOT GLOB '*[^a-z]*'),
  locale TEXT CHECK(locale IS NULL OR (length(locale) BETWEEN 2 AND 35 AND locale NOT GLOB '*[^A-Za-z0-9-]*')),
  timezone TEXT CHECK(timezone IS NULL OR length(timezone) BETWEEN 3 AND 64),
  week_start INTEGER CHECK(week_start IS NULL OR week_start BETWEEN 1 AND 7),
  hour_cycle TEXT CHECK(hour_cycle IS NULL OR hour_cycle IN ('h12','h23')),
  home_page TEXT NOT NULL DEFAULT 'inicio' CHECK(home_page IN ('inicio','agenda','cursos','biblioteca','horas')),
  theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('system','light','dark')),
  text_scale INTEGER NOT NULL DEFAULT 100 CHECK(text_scale BETWEEN 100 AND 150),
  high_contrast INTEGER NOT NULL DEFAULT 0 CHECK(high_contrast IN (0,1)),
  motion TEXT NOT NULL DEFAULT 'system' CHECK(motion IN ('system','reduce')),
  density TEXT NOT NULL DEFAULT 'comfortable' CHECK(density IN ('comfortable','compact')),
  updated_at TEXT NOT NULL
);

-- How e-mail reaches each person (ST-161): immediately, in a daily or weekly digest at `digest_time`, or never (only
-- mandatory notices); optional e-mails wait while the quiet hours last. Times are wall-clock times of the person's zone.
CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email_frequency TEXT NOT NULL DEFAULT 'immediate' CHECK(email_frequency IN ('immediate','daily','weekly','never')),
  digest_time TEXT NOT NULL DEFAULT '07:00' CHECK(digest_time GLOB '[0-2][0-9]:[0-5][0-9]' AND digest_time <= '23:59'),
  quiet_start TEXT CHECK(quiet_start IS NULL OR (quiet_start GLOB '[0-2][0-9]:[0-5][0-9]' AND quiet_start <= '23:59')),
  quiet_end TEXT CHECK(quiet_end IS NULL OR (quiet_end GLOB '[0-2][0-9]:[0-5][0-9]' AND quiet_end <= '23:59')),
  updated_at TEXT NOT NULL,
  CHECK((quiet_start IS NULL) = (quiet_end IS NULL) AND (quiet_start IS NULL OR quiet_start <> quiet_end))
);

-- The choice per type now names its channel: in the application or by e-mail. Every choice of ST-124 was about
-- e-mail, so each existing row is copied, in its order, as the e-mail channel; a type and channel without a row is on.
CREATE TABLE notification_preferences_v2 (
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK(type IN ('course_assignment','section_assignment','review_submitted','review_returned','review_approved','class_changed','class_cancelled')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('in_app','email')),
  PRIMARY KEY(user_id,type,channel)
);
INSERT INTO notification_preferences_v2(user_id,organization_id,type,enabled,updated_at,channel)
  SELECT user_id,organization_id,type,enabled,updated_at,'email' FROM notification_preferences ORDER BY rowid;
DROP TABLE notification_preferences;
ALTER TABLE notification_preferences_v2 RENAME TO notification_preferences;

-- In-application notices: what the bell in the top bar lists. Only the reason and the page are kept.
CREATE TABLE notification_inbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(length(type) BETWEEN 3 AND 40 AND type NOT GLOB '*[^a-z_]*'),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
  path TEXT NOT NULL CHECK(substr(path,1,1) = '/' AND length(path) <= 300),
  mandatory INTEGER NOT NULL DEFAULT 0 CHECK(mandatory IN (0,1)),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notification_inbox_person ON notification_inbox(user_id,created_at DESC);

-- When the organization's store last looked for scheduled e-mail that is due (there is no scheduled trigger: the
-- next access does it, at most every few minutes).
CREATE TABLE mail_schedule_runs (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  ran_at TEXT NOT NULL
);

-- The outbox keeps scheduled e-mail too: a notification waiting for its digest or for the end of the quiet hours is
-- 'scheduled' until `deliver_after`; once a digest (kind 'digest', one message) includes it, it is 'digested' and
-- names that digest. Types follow the domain catalog (including the mandatory account and terms notices), so the
-- column checks their shape. SQLite cannot change a CHECK in place: the table is rebuilt, every existing row copied
-- unchanged and in its order, and the indexes recreated. The body is still never stored.
CREATE TABLE mail_outbox_v3 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 3 AND 30 AND kind NOT GLOB '*[^a-z_]*'),
  reference_id TEXT,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254 OR (status = 'no_address' AND recipient = '')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','not_configured','deferred','no_address','scheduled','digested')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT CHECK(last_error IS NULL OR length(last_error) <= 240),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT,
  user_id TEXT,
  notification_type TEXT CHECK(notification_type IS NULL OR (length(notification_type) BETWEEN 3 AND 40 AND notification_type NOT GLOB '*[^a-z_]*')),
  reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 240),
  mandatory INTEGER NOT NULL DEFAULT 0 CHECK(mandatory IN (0,1)),
  deliver_after TEXT,
  path TEXT CHECK(path IS NULL OR (substr(path,1,1) = '/' AND length(path) <= 300)),
  digest_id TEXT,
  CHECK(CASE kind
    WHEN 'notification' THEN notification_type IS NOT NULL AND reason IS NOT NULL AND user_id IS NOT NULL
    WHEN 'digest' THEN user_id IS NOT NULL AND reason IS NOT NULL AND notification_type IS NULL AND mandatory = 0
    WHEN 'invitation' THEN notification_type IS NULL AND reason IS NULL AND user_id IS NULL AND mandatory = 0
    ELSE notification_type IS NULL END),
  CHECK(status NOT IN ('scheduled','digested') OR kind = 'notification'),
  CHECK(status <> 'scheduled' OR deliver_after IS NOT NULL),
  CHECK(status <> 'digested' OR digest_id IS NOT NULL)
);
INSERT INTO mail_outbox_v3(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory)
  SELECT id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,sent_at,provider_id,user_id,notification_type,reason,mandatory FROM mail_outbox ORDER BY rowid;
DROP TABLE mail_outbox;
ALTER TABLE mail_outbox_v3 RENAME TO mail_outbox;
CREATE INDEX mail_outbox_reference ON mail_outbox(reference_id,created_at DESC);
CREATE INDEX mail_outbox_sent ON mail_outbox(organization_id,status,sent_at);
CREATE INDEX mail_outbox_kind ON mail_outbox(organization_id,kind,created_at DESC);
CREATE INDEX mail_outbox_person ON mail_outbox(user_id,created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX mail_outbox_due ON mail_outbox(organization_id,deliver_after) WHERE status = 'scheduled';
