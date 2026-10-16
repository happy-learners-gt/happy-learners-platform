-- ST-126, ST-127: terms and conditions and the privacy policy, versioned per organization. Administration edits one
-- draft of each kind; publishing gives it the next version number and from then on it never changes. A privacy
-- policy also carries the consent text each person agrees to. No document is seeded: an organization without a
-- published version asks nobody to accept anything.
CREATE TABLE legal_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('terms','privacy')),
  status TEXT NOT NULL CHECK(status IN ('draft','published')),
  version INTEGER CHECK(version > 0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 20 AND 60000),
  consent TEXT CHECK(consent IS NULL OR length(consent) BETWEEN 10 AND 1000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  CHECK((kind = 'privacy') = (consent IS NOT NULL)),
  CHECK((status = 'published') = (version IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)),
  UNIQUE(organization_id, kind, version)
);
CREATE UNIQUE INDEX legal_documents_draft ON legal_documents(organization_id, kind) WHERE status = 'draft';
-- A published version is a record of what people accepted: it is never edited nor removed.
CREATE TRIGGER legal_documents_published_update BEFORE UPDATE ON legal_documents WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published legal documents are immutable'); END;
CREATE TRIGGER legal_documents_published_delete BEFORE DELETE ON legal_documents WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published legal documents are kept'); END;

-- Who accepted which version and when. Withdrawing a privacy consent keeps the record and adds the moment it was
-- withdrawn; consenting again adds a new record. At most one record per person and version is in force.
CREATE TABLE legal_acceptances (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL,
  withdrawn_at TEXT CHECK(withdrawn_at IS NULL OR withdrawn_at >= accepted_at)
);
CREATE UNIQUE INDEX legal_acceptances_current ON legal_acceptances(document_id, user_id) WHERE withdrawn_at IS NULL;
CREATE INDEX legal_acceptances_user ON legal_acceptances(user_id, accepted_at DESC);
CREATE TRIGGER legal_acceptances_insert BEFORE INSERT ON legal_acceptances
WHEN NOT EXISTS(SELECT 1 FROM legal_documents d WHERE d.id = NEW.document_id AND d.organization_id = NEW.organization_id AND d.status = 'published')
BEGIN SELECT RAISE(ABORT,'only a published version of the same organization is accepted'); END;
-- Only the withdrawal is ever written afterwards, once.
CREATE TRIGGER legal_acceptances_update BEFORE UPDATE ON legal_acceptances
WHEN OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
  OR NEW.document_id <> OLD.document_id OR NEW.user_id <> OLD.user_id OR NEW.accepted_at <> OLD.accepted_at
BEGIN SELECT RAISE(ABORT,'an acceptance only records its withdrawal'); END;
CREATE TRIGGER legal_acceptances_delete BEFORE DELETE ON legal_acceptances
BEGIN SELECT RAISE(ABORT,'acceptances are kept'); END;

-- The activity log also records publishing, accepting and withdrawing a legal document (target 'legal'); its
-- checks are fixed in the table, so the table is rebuilt with the same rows, columns and indexes.
CREATE TABLE activity_events_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('created','updated','published','archived','restored','planned','recorded','uploaded','assigned','reset','accepted','withdrawn')),
  target_type TEXT NOT NULL CHECK(target_type IN ('course','program','module','lesson','resource','competency','outcome','group','session','team','account','legal')),
  target_id TEXT NOT NULL,
  course_id TEXT,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  occurred_at TEXT NOT NULL,
  group_id TEXT REFERENCES course_groups(id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id)
);
INSERT INTO activity_events_next(id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id)
  SELECT id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at,group_id FROM activity_events;
DROP TABLE activity_events;
ALTER TABLE activity_events_next RENAME TO activity_events;
CREATE INDEX activity_events_course ON activity_events(course_id,occurred_at DESC);
CREATE INDEX activity_events_actor ON activity_events(actor_id,occurred_at DESC);
CREATE INDEX activity_events_organization ON activity_events(organization_id,occurred_at DESC);
CREATE INDEX activity_events_group ON activity_events(group_id, occurred_at DESC);
