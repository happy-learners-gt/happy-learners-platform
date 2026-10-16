-- ST-123: administration records when a person leaves the team. The account, its activity and everything it wrote stay;
-- each departure is one row, so a person who is reactivated and leaves again keeps both records. The reason is
-- administration's own note: it is not written to the activity. Backups copy this table like any other.
CREATE TABLE departures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  departed_on TEXT NOT NULL CHECK(departed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 300),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL
);
CREATE INDEX departures_user ON departures(user_id, recorded_at DESC);
