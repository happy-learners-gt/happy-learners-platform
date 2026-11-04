-- REL-007, seguridad, identidad y accesos (SPR-004, DEC-058). Non-destructive: every row is kept.

-- Sessions and the sign-in history accept the new ways in: a link sent by e-mail (ST-130), a password recovery link
-- (ST-134), a passkey (ST-132) and an identity provider (ST-129, ST-131, ST-138). SQLite cannot widen a CHECK in
-- place, so both tables are rebuilt with the same columns, rows, order and indexes.
CREATE TABLE sessions_v3 (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE DEFAULT ('session-' || lower(hex(randomblob(16)))) CHECK(id GLOB 'session-*' AND length(id) = 40),
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  last_used_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  method TEXT NOT NULL DEFAULT 'password' CHECK(method IN ('password','invitation','link','recovery','passkey','google','microsoft','apple','sso')),
  device TEXT CHECK(device IS NULL OR length(device) BETWEEN 1 AND 80),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country = upper(country))),
  -- ST-133: whether the second factor was checked when the session opened (a passkey counts as both factors).
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  CHECK(last_used_at >= created_at)
);
INSERT INTO sessions_v3(token_hash,user_id,expires_at,id,created_at,last_used_at,method,device,country)
  SELECT token_hash,user_id,expires_at,id,created_at,last_used_at,method,device,country FROM sessions ORDER BY rowid;
DROP TABLE sessions;
ALTER TABLE sessions_v3 RENAME TO sessions;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id, last_used_at DESC);

CREATE TABLE sign_in_events_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed')),
  method TEXT NOT NULL CHECK(method IN ('password','invitation','link','recovery','passkey','google','microsoft','apple','sso')),
  device TEXT NOT NULL CHECK(length(device) BETWEEN 1 AND 80),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country = upper(country))),
  occurred_at TEXT NOT NULL
);
INSERT INTO sign_in_events_v2 SELECT id,organization_id,user_id,outcome,method,device,country,occurred_at FROM sign_in_events ORDER BY rowid;
DROP TABLE sign_in_events;
ALTER TABLE sign_in_events_v2 RENAME TO sign_in_events;
CREATE INDEX sign_in_events_user ON sign_in_events(user_id, occurred_at DESC);
CREATE INDEX sign_in_events_organization ON sign_in_events(organization_id, occurred_at);

-- ST-137, ST-186: the security log. Append-only: each event is sealed, in the transaction that writes it, with the
-- SHA-256 of the previous seal and its own fields (apps/api/src/security-log.ts), so changing or removing a sealed
-- event breaks the chain. It never holds a password, a code, a token, an IP address or a User-Agent: only the device
-- summary and the country that sessions already keep (ST-187). Events older than the retention are pruned in order and
-- the chain keeps the seal of the last one pruned as its anchor.
CREATE TABLE security_events (
  id TEXT PRIMARY KEY CHECK(id GLOB 'security-*'),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK(length(type) BETWEEN 3 AND 40),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed','info')),
  actor_id TEXT,
  subject_id TEXT,
  method TEXT CHECK(method IS NULL OR length(method) BETWEEN 2 AND 20),
  detail TEXT CHECK(detail IS NULL OR length(detail) <= 240),
  device TEXT CHECK(device IS NULL OR length(device) BETWEEN 1 AND 80),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country = upper(country))),
  occurred_at TEXT NOT NULL,
  hash TEXT CHECK(hash IS NULL OR (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'))
);
CREATE INDEX security_events_time ON security_events(organization_id, occurred_at);
CREATE INDEX security_events_subject ON security_events(subject_id, occurred_at);
CREATE INDEX security_events_unsealed ON security_events(organization_id) WHERE hash IS NULL;
-- A sealed event never changes.
CREATE TRIGGER security_events_sealed BEFORE UPDATE ON security_events WHEN OLD.hash IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'security event sealed'); END;
CREATE TABLE security_chain (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  anchor_rowid INTEGER NOT NULL DEFAULT 0,
  anchor_hash TEXT NOT NULL,
  head_rowid INTEGER NOT NULL DEFAULT 0,
  head_hash TEXT NOT NULL,
  sealed_at TEXT NOT NULL,
  pruned_on TEXT
);

-- ST-133, ST-134, ST-136: the organization's access policy. One row, created with the defaults when first saved.
CREATE TABLE security_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  min_password_length INTEGER NOT NULL DEFAULT 12 CHECK(min_password_length BETWEEN 12 AND 64),
  breached_check INTEGER NOT NULL DEFAULT 1 CHECK(breached_check IN (0,1)),
  mfa_admin INTEGER NOT NULL DEFAULT 0 CHECK(mfa_admin IN (0,1)),
  mfa_educator INTEGER NOT NULL DEFAULT 0 CHECK(mfa_educator IN (0,1)),
  session_hours INTEGER NOT NULL DEFAULT 8 CHECK(session_hours BETWEEN 1 AND 12),
  link_sign_in INTEGER NOT NULL DEFAULT 1 CHECK(link_sign_in IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ST-133: the second factor of a person (TOTP, RFC 6238). The secret is encrypted with the organization's key, which
-- lives outside SQL and never leaves its store; the last time step used blocks replaying a code.
CREATE TABLE totp_factors (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  secret TEXT NOT NULL CHECK(length(secret) BETWEEN 20 AND 400),
  status TEXT NOT NULL CHECK(status IN ('pending','active')),
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  enabled_at TEXT
);
CREATE TABLE recovery_codes (
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL CHECK(length(code_hash) = 64),
  created_at TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY(user_id, code_hash)
);

-- ST-132: passkeys (WebAuthn). Only the public key, its counter and the name the person gave it.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 16 AND 1400),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK(backed_up IN (0,1)),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- One-use secrets of the sign-in flows: a second-factor step after the password, a WebAuthn challenge, the state of an
-- identity provider round trip, and the links sent by e-mail to sign in or recover the password. Only the SHA-256 of
-- the secret is kept; each is used once and expires in minutes.
CREATE TABLE auth_challenges (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  kind TEXT NOT NULL CHECK(kind IN ('mfa','passkey-register','passkey-sign-in','provider','link','recovery')),
  user_id TEXT REFERENCES users(id),
  data TEXT CHECK(data IS NULL OR length(data) <= 4000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE INDEX auth_challenges_user ON auth_challenges(user_id, kind);

-- ST-129, ST-131, ST-138: accounts of an identity provider linked to a person. The subject is the provider's stable
-- identifier; the e-mail is only shown to the person.
CREATE TABLE linked_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','apple','sso')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT CHECK(email IS NULL OR length(email) <= 254),
  linked_at TEXT NOT NULL,
  last_used_at TEXT,
  PRIMARY KEY(provider, subject)
);
CREATE UNIQUE INDEX linked_identities_user ON linked_identities(user_id, provider);

-- ST-138: the institution's identity provider (OpenID Connect). Draft until tested; only then it can be activated.
CREATE TABLE sso_connections (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  -- An http issuer only on this machine: the tests' stand-in, accepted by the Worker only when it runs locally too.
  issuer TEXT NOT NULL CHECK((issuer GLOB 'https://*' OR issuer GLOB 'http://127.0.0.1:*') AND length(issuer) <= 300),
  client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 255),
  client_secret TEXT NOT NULL CHECK(length(client_secret) BETWEEN 1 AND 2000),
  domains TEXT NOT NULL CHECK(length(domains) BETWEEN 3 AND 500),
  default_role TEXT NOT NULL DEFAULT 'educator' CHECK(default_role IN ('educator','admin')),
  admin_group TEXT CHECK(admin_group IS NULL OR length(admin_group) BETWEEN 1 AND 255),
  provision INTEGER NOT NULL DEFAULT 0 CHECK(provision IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','tested','active')),
  tested_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ST-136: integration tokens: a name, a scope, an expiry and revocation. Only the SHA-256 of the token is kept.
CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY CHECK(id GLOB 'token-*'),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 60),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  scope TEXT NOT NULL CHECK(scope IN ('read')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX access_tokens_user ON access_tokens(user_id);
