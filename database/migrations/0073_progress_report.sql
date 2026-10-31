-- Section progress report (1.5.2, docs/design/constructor-de-reportes.md §4). The report builder gets a fourth kind of
-- document, «progress-report», for a section: attendance, plan coverage and readings. Its three tables are rebuilt with
-- the wider check (SQLite cannot change a CHECK), keeping their rows, in the same safe order as 0072.
-- The AI harness records a new task, «suggest-fields» (the designer proposes fields for a written text); ai_runs is
-- rebuilt the same way. Nothing references it.

CREATE TABLE report_templates_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate','panel-minutes','progress-report')),
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
  kind TEXT NOT NULL CHECK(kind IN ('report-card','certificate','panel-minutes','progress-report')),
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

CREATE TABLE ai_runs_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  course_id TEXT,
  task TEXT NOT NULL CHECK(task IN ('lesson-proposal','book-map','lesson-review-explain','lesson-improve','write','rules-to-constraints','suggest-fields')),
  prompt_version TEXT NOT NULL CHECK(length(prompt_version) BETWEEN 1 AND 40),
  generator TEXT NOT NULL CHECK(generator IN ('openai','fixture')),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 80),
  input_chars INTEGER NOT NULL CHECK(input_chars >= 0),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
  status TEXT NOT NULL CHECK(status IN ('ok','error','transient','refused','incomplete')),
  created_at TEXT NOT NULL
);
INSERT INTO ai_runs_next SELECT id,organization_id,user_id,course_id,task,prompt_version,generator,model,input_chars,input_tokens,output_tokens,duration_ms,status,created_at FROM ai_runs;
DROP TABLE ai_runs;
ALTER TABLE ai_runs_next RENAME TO ai_runs;
CREATE INDEX ai_runs_month ON ai_runs(organization_id, created_at);
