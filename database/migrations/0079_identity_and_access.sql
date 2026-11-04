-- Identidad y acceso (docs/design/identidad-y-acceso.md). Non-destructive.

-- The confirmation window of a session ("sudo mode"): until this instant (ms), sensitive changes of the account do not
-- ask for the password again. Signing in opens it for 10 minutes; confirming with the password, a passkey or a code
-- opens it again. Existing sessions start closed (0).
ALTER TABLE sessions ADD COLUMN elevated_until INTEGER NOT NULL DEFAULT 0;

-- Access reviews: administration reviews, person by person, who keeps access. Completing a review applies each
-- «remove» (the access ends as when administration takes it away) and records who decided what and when.
CREATE TABLE access_reviews (
  id TEXT PRIMARY KEY CHECK(id GLOB 'review-*'),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
  due_on TEXT NOT NULL CHECK(due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_by TEXT,
  completed_at TEXT,
  CHECK((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX access_reviews_organization ON access_reviews(organization_id, created_at DESC);
CREATE TABLE access_review_items (
  review_id TEXT NOT NULL REFERENCES access_reviews(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('admin','educator')),
  decision TEXT CHECK(decision IS NULL OR decision IN ('keep','remove')),
  note TEXT CHECK(note IS NULL OR length(note) <= 300),
  decided_by TEXT,
  decided_at TEXT,
  applied_at TEXT,
  PRIMARY KEY(review_id, user_id),
  CHECK((decision IS NULL) = (decided_at IS NULL))
);
