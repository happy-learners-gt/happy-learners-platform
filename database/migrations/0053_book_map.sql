-- The book map (rebanada 5b): for the course's main book (identified by its SHA-256, so a new book starts a new map)
-- and each learning outcome of the plan, the pages that work on it, the evidence (a quote verified on each page),
-- where it came from (lexical search, a language model or the team) and whether the team confirmed it. The language
-- model's check runs in the organization's Durable Object alarm, like lesson proposals, with an explicit state.
-- Confirmed pages are what lesson proposals use. An empty, confirmed list means «the book does not cover it».

CREATE TABLE IF NOT EXISTS book_maps (
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  file_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  outcome_id TEXT NOT NULL,
  candidates TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(candidates)),
  pages TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pages) AND json_type(pages) = 'array'),
  evidence TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence) AND json_type(evidence) = 'array'),
  source TEXT NOT NULL CHECK(source IN ('lexical','ai','teacher')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','confirmed')),
  ai_status TEXT NOT NULL DEFAULT 'none' CHECK(ai_status IN ('none','queued','running','done','error')),
  ai_error TEXT CHECK(ai_error IS NULL OR length(ai_error) <= 300),
  ai_attempts INTEGER NOT NULL DEFAULT 0 CHECK(ai_attempts >= 0),
  ai_started_at TEXT,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(course_id, sha256, outcome_id),
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id),
  FOREIGN KEY(outcome_id, course_id) REFERENCES course_outcomes(id, course_id)
);
CREATE INDEX IF NOT EXISTS book_maps_ai ON book_maps(ai_status, organization_id);
