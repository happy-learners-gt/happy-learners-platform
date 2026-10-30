-- The AI harness (1.4.0, docs/design/asistente-ia.md §6a). Every call to a language model, or to the local fixture that
-- stands in for it, leaves one row: who, for what, which model, how big the input was, the tokens it used, how long it
-- took and how it ended. Never the text of the input or of the answer.
-- Prices are administration's: per model and from a date, per million tokens. The cost is computed when read.

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  course_id TEXT,
  task TEXT NOT NULL CHECK(task IN ('lesson-proposal','book-map','lesson-review-explain','lesson-improve','write','rules-to-constraints')),
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
CREATE INDEX ai_runs_month ON ai_runs(organization_id, created_at);

CREATE TABLE ai_prices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 80),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  input_per_million REAL NOT NULL CHECK(input_per_million >= 0 AND input_per_million <= 1000),
  output_per_million REAL NOT NULL CHECK(output_per_million >= 0 AND output_per_million <= 1000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, model, effective_from)
);
