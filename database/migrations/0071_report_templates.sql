-- The report builder (1.5.0, docs/design/constructor-de-reportes.md). A template is data: its draft is edited, and
-- publishing it freezes a version. A program's template wins over the organization's for its sections. Images (a
-- logo, a seal) are JPEG of up to 1 MB, kept here so a backup holds them. Every document generated keeps the version
-- it came from and its SHA-256, so it can be generated again and checked.

CREATE TABLE report_images (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 4 AND 1048576),
  width INTEGER NOT NULL CHECK(width > 0),
  height INTEGER NOT NULL CHECK(height > 0),
  components INTEGER NOT NULL CHECK(components IN (1,3)),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE report_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate')),
  program_id TEXT REFERENCES study_programs(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  draft TEXT NOT NULL CHECK(json_valid(draft)),
  published_version INTEGER CHECK(published_version IS NULL OR published_version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
-- One active template per kind and scope (the organization, or a program).
CREATE UNIQUE INDEX report_templates_scope ON report_templates(organization_id, kind, COALESCE(program_id, '')) WHERE status = 'active';

CREATE TABLE report_template_versions (
  template_id TEXT NOT NULL REFERENCES report_templates(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  content TEXT NOT NULL CHECK(json_valid(content)),
  published_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  PRIMARY KEY(template_id, version)
);

CREATE TABLE generated_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate')),
  template_id TEXT REFERENCES report_templates(id),
  template_version INTEGER,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('section','learner')),
  subject_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX generated_documents_subject ON generated_documents(organization_id, subject_type, subject_id, created_at);
