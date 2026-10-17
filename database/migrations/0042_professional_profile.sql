-- ST-154, ST-155, ST-156, ST-157 (DEC-045): the educator's professional profile, its credentials and its publication.
--
-- The profile keeps a working copy (staff_profiles.draft, a JSON object validated by the API with the pure rules of
-- packages/domain) and a separate record of every version sent for review or published (staff_profile_versions),
-- like lessons keep their draft and their published content: editing a published profile never changes what the team
-- and the students see until the new version is approved. Name, photo, contact data and availability stay in the
-- columns of ST-149 and apply at once; contact data never goes beyond the organization (DEC-043).
--
-- Standards instead of local lists, so the model works for any subject, level and country: ISCED 2011 levels,
-- BCP 47 language tags, ISO 3166-1 alpha-2 countries, IANA time zones and ISCED-F 2013 broad fields as suggestions
-- for open teaching areas. The API checks them; the database checks the shape it can check without the catalogs.

-- Whether a profile needs administration's approval before it is published; by default it does (ST-156).
ALTER TABLE organizations ADD COLUMN profile_review_required INTEGER NOT NULL DEFAULT 1 CHECK(profile_review_required IN (0,1));

-- The working copy, the visibility of each section and the state of the public profile:
--   draft → in_review → published ; in_review → changes_requested → in_review ; published ⇄ hidden.
-- `draft_version` grows with every saved change; a version sent for review remembers which one it copied.
-- `hidden_by` says who hid a published profile: the person ('self'), administration ('admin') or the platform when the
-- person leaves or loses access ('system'); only administration shows again what administration hid.
ALTER TABLE staff_profiles ADD COLUMN draft TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(draft) AND json_type(draft) = 'object' AND length(draft) <= 60000);
ALTER TABLE staff_profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(visibility) AND json_type(visibility) = 'object');
ALTER TABLE staff_profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','changes_requested','published','hidden'));
ALTER TABLE staff_profiles ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0 CHECK(draft_version >= 0);
ALTER TABLE staff_profiles ADD COLUMN hidden_by TEXT CHECK(hidden_by IS NULL OR hidden_by IN ('self','admin','system'));
ALTER TABLE staff_profiles ADD COLUMN status_changed_at TEXT;

-- ST-149 specialties become open teaching areas (label, with no ISCED-F field yet). The column stays, kept in step by
-- the API, because the profile route of ST-149 and the onboarding (ST-122) still read it.
UPDATE staff_profiles SET draft = json_object('areas', json((SELECT json_group_array(json_object('label', s.value, 'field', NULL)) FROM json_each(staff_profiles.specialties) s)))
  WHERE json_array_length(specialties) > 0;

-- Every version sent for review or published, kept as history. At most one is in review and one is published per
-- person; the previous publication becomes 'superseded' when a new one is approved. 'returned' is a version on which
-- administration asked for changes (with its note), 'withdrawn' one replaced by a newer submission or closed because
-- the person left.
CREATE TABLE staff_profile_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  draft_version INTEGER NOT NULL CHECK(draft_version >= 0),
  content TEXT NOT NULL CHECK(json_valid(content) AND json_type(content) = 'object' AND length(content) <= 60000),
  status TEXT NOT NULL CHECK(status IN ('in_review','returned','published','superseded','withdrawn')),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT CHECK(decision_note IS NULL OR length(trim(decision_note)) BETWEEN 5 AND 500),
  published_at TEXT,
  UNIQUE(user_id, version),
  -- A decision names who took it; changes are always asked for with a note; a publication has its date.
  CHECK(status = 'in_review' OR status = 'withdrawn' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(status <> 'returned' OR decision_note IS NOT NULL),
  CHECK((status IN ('published','superseded')) = (published_at IS NOT NULL))
);
CREATE UNIQUE INDEX staff_profile_versions_open ON staff_profile_versions(user_id) WHERE status = 'in_review';
CREATE UNIQUE INDEX staff_profile_versions_current ON staff_profile_versions(user_id) WHERE status = 'published';
CREATE INDEX staff_profile_versions_queue ON staff_profile_versions(organization_id, status, submitted_at);

-- A credential may point to a document of the same person's staff file (ST-150) as its support.
CREATE UNIQUE INDEX staff_documents_owner ON staff_documents(id, user_id);

-- ST-155: credentials. draft → submitted → verified | rejected (with a reason); the person may withdraw them; a
-- verified credential counts as expired from the day after its expiry date, computed when it is read (not stored).
-- Editing a rejected or verified credential returns it to draft: what was verified is exactly what is shown.
CREATE TABLE staff_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('degree','certification','teaching_license','language_certificate','other')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 2 AND 160),
  country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country GLOB '[A-Z][A-Z]')),
  issued_on TEXT NOT NULL CHECK(issued_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  expires_on TEXT CHECK(expires_on IS NULL OR (expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND expires_on >= issued_on)),
  credential_code TEXT CHECK(credential_code IS NULL OR length(credential_code) BETWEEN 1 AND 100),
  verification_url TEXT CHECK(verification_url IS NULL OR (length(verification_url) <= 500 AND verification_url GLOB 'https://*')),
  document_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','verified','rejected','withdrawn')),
  rejection_reason TEXT CHECK(rejection_reason IS NULL OR length(trim(rejection_reason)) BETWEEN 5 AND 500),
  submitted_at TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id, user_id) REFERENCES staff_documents(id, user_id),
  CHECK(status NOT IN ('submitted','verified','rejected') OR submitted_at IS NOT NULL),
  CHECK(status NOT IN ('verified','rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK((status = 'rejected') = (rejection_reason IS NOT NULL))
);
CREATE INDEX staff_credentials_user ON staff_credentials(user_id, status);
CREATE INDEX staff_credentials_queue ON staff_credentials(organization_id, status, submitted_at);

-- The profile and its credentials are part of the activity: target 'profile' and 'credential', with the actions
-- 'submitted', 'approved', 'returned' (changes requested), 'hidden', 'verified' and 'rejected'. SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt as in 0032 and 0034; every row is copied unchanged and the lists
-- keep every value earlier migrations admit.
CREATE TABLE activity_events_v4 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','published','archived','restored','planned','recorded','uploaded','assigned','reset','accepted','withdrawn','resent','revoked','submitted','approved','returned','hidden','verified','rejected')),
  target_type TEXT NOT NULL CHECK(target_type IN ('course','program','module','lesson','resource','competency','outcome','group','session','team','account','legal','invitation','profile','credential')),
  target_id TEXT NOT NULL,
  course_id TEXT,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  occurred_at TEXT NOT NULL,
  group_id TEXT REFERENCES course_groups(id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
INSERT INTO activity_events_v4(id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id)
  SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events;
DROP TABLE activity_events;
ALTER TABLE activity_events_v4 RENAME TO activity_events;
CREATE INDEX activity_events_course ON activity_events(course_id,occurred_at DESC);
CREATE INDEX activity_events_actor ON activity_events(actor_id,occurred_at DESC);
CREATE INDEX activity_events_organization ON activity_events(organization_id,occurred_at DESC);
CREATE INDEX activity_events_group ON activity_events(group_id,occurred_at DESC);
