-- ST-149: each person keeps their profile. The name stays in users.display_name; this row holds the rest.
-- Phone and contact e-mail are personal data seen only by the person and administration (DEC-043); students never
-- receive them. The photo is a private R2 object (COURSE_FILES bucket) served only to the organization's staff.
-- Specialties and availability are JSON arrays validated by the API (weekday 1-7 with HH:MM ranges).
CREATE TABLE staff_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  phone TEXT CHECK(phone IS NULL OR length(phone) BETWEEN 7 AND 25),
  contact_email TEXT CHECK(contact_email IS NULL OR (length(contact_email) BETWEEN 3 AND 254 AND contact_email = lower(contact_email))),
  education TEXT NOT NULL DEFAULT '' CHECK(length(education) <= 1000),
  specialties TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(specialties) AND json_type(specialties) = 'array'),
  availability TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(availability) AND json_type(availability) = 'array'),
  photo_key TEXT,
  photo_type TEXT CHECK(photo_type IS NULL OR photo_type IN ('image/jpeg','image/png','image/webp')),
  photo_size INTEGER CHECK(photo_size IS NULL OR photo_size BETWEEN 1 AND 2097152),
  photo_sha256 TEXT CHECK(photo_sha256 IS NULL OR length(photo_sha256) = 64),
  updated_at TEXT NOT NULL,
  CHECK((photo_key IS NULL) = (photo_type IS NULL) AND (photo_key IS NULL) = (photo_size IS NULL) AND (photo_key IS NULL) = (photo_sha256 IS NULL))
);

-- ST-150: the staff file. Each document is a private R2 object with its type, issue date and optional expiry date.
-- Withdrawing a document only records when and by whom: the metadata and the object stay for retention, and the
-- file stays after the person leaves (ST-123). Only administration and the person see it (DEC-043).
-- Uploads, downloads and withdrawals are written to activity_events as target 'account' with the existing actions
-- 'uploaded', 'recorded' (a download) and 'withdrawn', so that table is not rebuilt here.
CREATE TABLE staff_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('dpi','cv','criminal-record','police-record','studies','certificate','other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  issued_on TEXT NOT NULL CHECK(issued_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  expires_on TEXT CHECK(expires_on IS NULL OR (expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND expires_on >= issued_on)),
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by TEXT REFERENCES users(id),
  CHECK((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
CREATE INDEX staff_documents_user ON staff_documents(user_id, uploaded_at DESC);
CREATE INDEX staff_documents_expiry ON staff_documents(organization_id, expires_on) WHERE withdrawn_at IS NULL AND expires_on IS NOT NULL;
