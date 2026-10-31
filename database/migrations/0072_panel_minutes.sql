-- Panel minutes (1.5.1, docs/design/constructor-de-reportes.md §4). The minutes of a panel for one student freeze each
-- member's mark and the combined result (content and its SHA-256); each member signs with name and password (ST-153),
-- the chair last. Once a member has signed, that student's marks for the activity are locked.
-- The report builder gets a third kind of document, «panel-minutes»: its two tables are rebuilt with the wider check
-- (SQLite cannot change a CHECK), keeping their rows.

CREATE TABLE panel_minutes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  activity_id TEXT NOT NULL REFERENCES assessment_activities(id),
  group_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK(json_valid(content)),
  document_sha256 TEXT NOT NULL CHECK(length(document_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','signed')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE(activity_id, learner_id)
);
CREATE TABLE panel_minute_signatures (
  minute_id TEXT NOT NULL REFERENCES panel_minutes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  signed_name TEXT NOT NULL CHECK(length(signed_name) BETWEEN 3 AND 120),
  signed_at TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK(length(signature_sha256) = 64),
  PRIMARY KEY(minute_id, user_id)
);

-- Rebuilt in an order that never leaves a reference dangling: the new tables first, then the old dependents (versions and
-- documents) are dropped before the templates they point to, and the new tables take the old names.
CREATE TABLE report_templates_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate','panel-minutes')),
  program_id TEXT REFERENCES study_programs(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  draft TEXT NOT NULL CHECK(json_valid(draft)),
  published_version INTEGER CHECK(published_version IS NULL OR published_version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
INSERT INTO report_templates_next SELECT id,organization_id,kind,program_id,name,draft,published_version,status,updated_by,updated_at FROM report_templates;
CREATE TABLE report_template_versions_next (
  template_id TEXT NOT NULL REFERENCES report_templates_next(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  content TEXT NOT NULL CHECK(json_valid(content)),
  published_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  PRIMARY KEY(template_id, version)
);
INSERT INTO report_template_versions_next SELECT template_id,version,content,published_by,published_at FROM report_template_versions;
CREATE TABLE generated_documents_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate','panel-minutes')),
  template_id TEXT REFERENCES report_templates_next(id),
  template_version INTEGER,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('section','learner','minute')),
  subject_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
INSERT INTO generated_documents_next SELECT id,organization_id,kind,template_id,template_version,subject_type,subject_id,sha256,created_by,created_at FROM generated_documents;
DROP TABLE generated_documents;
DROP TABLE report_template_versions;
DROP TABLE report_templates;
ALTER TABLE report_templates_next RENAME TO report_templates;
ALTER TABLE report_template_versions_next RENAME TO report_template_versions;
ALTER TABLE generated_documents_next RENAME TO generated_documents;
CREATE UNIQUE INDEX report_templates_scope ON report_templates(organization_id, kind, COALESCE(program_id, '')) WHERE status = 'active';
CREATE INDEX generated_documents_subject ON generated_documents(organization_id, subject_type, subject_id, created_at);
