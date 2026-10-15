-- ST-125: each person's calendar subscription link. Only the SHA-256 of the secret token is stored, as for sessions;
-- regenerating the link replaces the row, so the previous link stops working at once. Backups never copy this table.
CREATE TABLE calendar_feeds (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  created_at TEXT NOT NULL
);
