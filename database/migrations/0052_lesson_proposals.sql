-- Lesson proposals (rebanada 5a). The course's main book (a PDF in COURSE_FILES) is read once in the browser, page by
-- page; its text is kept here so proposals never parse a PDF inside a request. A proposal job asks for one draft lesson
-- per learning outcome, processed in small batches by the organization's Durable Object alarm. Each item has an
-- explicit state (queued → running → done | error) and an idempotency key, so retrying never duplicates a lesson.
-- Drafts go through the existing review and publication flow; nothing is published automatically.

CREATE TABLE IF NOT EXISTS book_texts (
  file_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  status TEXT NOT NULL CHECK(status IN ('ready','no_text')),
  pages INTEGER NOT NULL CHECK(pages BETWEEN 0 AND 1000),
  characters INTEGER NOT NULL CHECK(characters >= 0),
  extracted_by TEXT NOT NULL REFERENCES users(id),
  extracted_at TEXT NOT NULL,
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id)
);
CREATE TABLE IF NOT EXISTS book_pages (
  file_id TEXT NOT NULL REFERENCES book_texts(file_id),
  page INTEGER NOT NULL CHECK(page >= 1),
  text TEXT NOT NULL CHECK(length(text) <= 12000),
  PRIMARY KEY(file_id, page)
);

CREATE TABLE IF NOT EXISTS proposal_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL,
  unit_id TEXT NOT NULL REFERENCES learning_units(id),
  book_file_id TEXT NOT NULL,
  sequence TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 10 AND 300),
  generator TEXT NOT NULL CHECK(generator IN ('fixture','openai')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id)
);
CREATE TABLE IF NOT EXISTS proposal_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES proposal_jobs(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','error')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  error TEXT CHECK(error IS NULL OR length(error) <= 300),
  pages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pages)),
  lesson_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(outcome_id, course_id) REFERENCES course_outcomes(id, course_id),
  CHECK(status <> 'done' OR lesson_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS proposal_items_pending ON proposal_items(status, job_id, position);
