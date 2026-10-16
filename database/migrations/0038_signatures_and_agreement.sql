-- ST-151: the volunteer agreement ("Acuerdo de voluntariado ad honorem") is a third kind of legal document, published
-- and versioned like the terms. ST-153: accepting the terms or the agreement is signed electronically (DEC-043).
--
-- legal_documents admits its kinds in a CHECK, so it is rebuilt. legal_acceptances references it, and dropping a
-- referenced table while foreign keys are enforced (always, in a Durable Object) leaves its rows orphaned, so it is
-- rebuilt too: each new table is filled before the old one is dropped, the acceptances point to the new documents
-- table and the rename carries that reference to the final name. Every row is copied unchanged, column by column;
-- indexes and triggers are recreated exactly as 0032 wrote them (dropping a table drops its own triggers; the
-- acceptances' insert trigger names legal_documents, so it is dropped first and recreated after the rename).
DROP TRIGGER legal_acceptances_insert;
CREATE TABLE legal_documents_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('terms','privacy','volunteer')),
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
INSERT INTO legal_documents_v2(id,organization_id,kind,status,version,title,body,consent,updated_by,updated_at,published_by,published_at)
  SELECT id,organization_id,kind,status,version,title,body,consent,updated_by,updated_at,published_by,published_at FROM legal_documents ORDER BY rowid;
CREATE TABLE legal_acceptances_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  document_id TEXT NOT NULL REFERENCES legal_documents_v2(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL,
  withdrawn_at TEXT CHECK(withdrawn_at IS NULL OR withdrawn_at >= accepted_at)
);
INSERT INTO legal_acceptances_v2(id,organization_id,document_id,user_id,accepted_at,withdrawn_at)
  SELECT id,organization_id,document_id,user_id,accepted_at,withdrawn_at FROM legal_acceptances ORDER BY rowid;
DROP TABLE legal_acceptances;
DROP TABLE legal_documents;
ALTER TABLE legal_documents_v2 RENAME TO legal_documents;
ALTER TABLE legal_acceptances_v2 RENAME TO legal_acceptances;

CREATE UNIQUE INDEX legal_documents_draft ON legal_documents(organization_id, kind) WHERE status = 'draft';
-- A published version is a record of what people accepted: it is never edited nor removed.
CREATE TRIGGER legal_documents_published_update BEFORE UPDATE ON legal_documents WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published legal documents are immutable'); END;
CREATE TRIGGER legal_documents_published_delete BEFORE DELETE ON legal_documents WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published legal documents are kept'); END;

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

-- ST-153 (DEC-043): a simple electronic signature of one acceptance. The person typed their full name and confirmed
-- their identity with their password (never stored here). document_sha256 is the SHA-256 of the canonical text of the
-- signed version; signature_sha256 is the SHA-256 of the canonical record below, so a receipt whose fields were
-- changed no longer matches. Acceptances recorded before this migration have no signature ("sin firma").
-- A signature is never edited nor removed: it stays after the person leaves the organization (ST-151 CA3).
CREATE TABLE legal_signatures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  acceptance_id TEXT NOT NULL UNIQUE REFERENCES legal_acceptances(id),
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL CHECK(length(username) BETWEEN 1 AND 64),
  signed_name TEXT NOT NULL CHECK(length(signed_name) BETWEEN 3 AND 120),
  document_sha256 TEXT NOT NULL CHECK(length(document_sha256) = 64),
  signature_sha256 TEXT NOT NULL CHECK(length(signature_sha256) = 64),
  signed_at TEXT NOT NULL
);
CREATE INDEX legal_signatures_signed ON legal_signatures(organization_id, signed_at DESC);
CREATE INDEX legal_signatures_user ON legal_signatures(user_id, signed_at DESC);
CREATE TRIGGER legal_signatures_insert BEFORE INSERT ON legal_signatures
WHEN NOT EXISTS(SELECT 1 FROM legal_acceptances a JOIN legal_documents d ON d.id = a.document_id
  WHERE a.id = NEW.acceptance_id AND a.document_id = NEW.document_id AND a.user_id = NEW.user_id AND a.organization_id = NEW.organization_id
    AND d.kind IN ('terms','volunteer'))
BEGIN SELECT RAISE(ABORT,'a signature belongs to an acceptance of the terms or the volunteer agreement by the same person'); END;
CREATE TRIGGER legal_signatures_update BEFORE UPDATE ON legal_signatures
BEGIN SELECT RAISE(ABORT,'signatures are immutable'); END;
CREATE TRIGGER legal_signatures_delete BEFORE DELETE ON legal_signatures
BEGIN SELECT RAISE(ABORT,'signatures are kept'); END;
