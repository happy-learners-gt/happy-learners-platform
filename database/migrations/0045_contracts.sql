-- DEC-046: contracts. Each organization keeps contract templates of any kind of engagement (employment, services,
-- volunteer ad honorem, internship or other), each with versions in rich text and default terms. A contract is one
-- template version agreed with one person: administration prepares it, signs it for the organization and sends it
-- (alone or with an invitation); the person signs it and it is in force from its start date, for an indefinite term or
-- until its end date. Once sent, what was agreed never changes: amending means a new contract that supersedes it.
--
-- The volunteer agreement of ST-151 becomes the first template of the organizations that published it, and each
-- signed agreement becomes an active contract, so there is one mechanism instead of two. The terms and the privacy
-- policy stay organization-wide documents and gain a rich-text body and the date from which each version applies.

ALTER TABLE organizations ADD COLUMN contract_required INTEGER NOT NULL DEFAULT 0 CHECK(contract_required IN (0,1));
ALTER TABLE legal_documents ADD COLUMN body_json TEXT CHECK(body_json IS NULL OR json_valid(body_json));
ALTER TABLE legal_documents ADD COLUMN effective_at TEXT;

CREATE TABLE contract_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 120),
  engagement TEXT NOT NULL CHECK(engagement IN ('employment','services','volunteer','internship','other')),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, name)
);

CREATE TABLE contract_template_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  template_id TEXT NOT NULL REFERENCES contract_templates(id),
  status TEXT NOT NULL CHECK(status IN ('draft','published')),
  version INTEGER CHECK(version > 0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
  body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(body_json) <= 400000),
  -- The body as plain text: what the fingerprint and the search read.
  body_text TEXT NOT NULL CHECK(length(body_text) BETWEEN 20 AND 120000),
  -- Default terms (DEC-046 schema) and which of them administration may change per contract.
  defaults_json TEXT NOT NULL CHECK(json_valid(defaults_json)),
  editable_json TEXT NOT NULL CHECK(json_valid(editable_json) AND json_type(editable_json) = 'array'),
  effective_from TEXT CHECK(effective_from IS NULL OR effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  CHECK((status = 'published') = (version IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL AND effective_from IS NOT NULL)),
  UNIQUE(template_id, version)
);
CREATE UNIQUE INDEX contract_template_versions_draft ON contract_template_versions(template_id) WHERE status = 'draft';
CREATE INDEX contract_template_versions_template ON contract_template_versions(template_id, version DESC);
CREATE TRIGGER contract_template_versions_published_update BEFORE UPDATE ON contract_template_versions WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published contract template versions are immutable'); END;
CREATE TRIGGER contract_template_versions_published_delete BEFORE DELETE ON contract_template_versions WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT,'published contract template versions are kept'); END;

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  template_version_id TEXT NOT NULL REFERENCES contract_template_versions(id),
  origin TEXT NOT NULL DEFAULT 'contract' CHECK(origin IN ('contract','volunteer-agreement')),
  engagement TEXT NOT NULL CHECK(engagement IN ('employment','services','volunteer','internship','other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
  body_json TEXT CHECK(body_json IS NULL OR json_valid(body_json)),
  body_text TEXT NOT NULL CHECK(length(body_text) BETWEEN 20 AND 120000),
  terms_json TEXT NOT NULL CHECK(json_valid(terms_json)),
  party_name TEXT NOT NULL CHECK(length(party_name) BETWEEN 2 AND 120),
  party_email TEXT CHECK(party_email IS NULL OR (length(party_email) BETWEEN 3 AND 254 AND party_email = lower(party_email))),
  user_id TEXT REFERENCES users(id),
  invitation_id TEXT REFERENCES invitations(id),
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK(end_date IS NULL OR (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date >= start_date)),
  status TEXT NOT NULL CHECK(status IN ('draft','sent','active','declined','voided','terminated','superseded')),
  supersedes_id TEXT REFERENCES contracts(id),
  document_sha256 TEXT CHECK(document_sha256 IS NULL OR length(document_sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  org_signer_id TEXT REFERENCES users(id),
  org_signed_name TEXT CHECK(org_signed_name IS NULL OR length(org_signed_name) BETWEEN 3 AND 120),
  org_signed_at TEXT,
  org_signature_sha256 TEXT CHECK(org_signature_sha256 IS NULL OR length(org_signature_sha256) = 64),
  member_signed_name TEXT CHECK(member_signed_name IS NULL OR length(member_signed_name) BETWEEN 3 AND 120),
  member_signed_at TEXT,
  member_signature_sha256 TEXT CHECK(member_signature_sha256 IS NULL OR length(member_signature_sha256) = 64),
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id),
  close_reason TEXT CHECK(close_reason IS NULL OR length(close_reason) <= 500),
  termination_date TEXT CHECK(termination_date IS NULL OR termination_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK(user_id IS NOT NULL OR invitation_id IS NOT NULL),
  CHECK(status <> 'draft' OR (document_sha256 IS NULL AND sent_at IS NULL AND member_signed_at IS NULL)),
  -- Sent means fingerprinted and signed by the organization; contracts migrated from the volunteer agreement were
  -- published by administration instead, so they carry the document's fingerprint without an organization signature.
  CHECK(status IN ('draft','voided') OR (document_sha256 IS NOT NULL AND sent_at IS NOT NULL
    AND (origin = 'volunteer-agreement' OR (org_signer_id IS NOT NULL AND org_signed_name IS NOT NULL AND org_signed_at IS NOT NULL AND org_signature_sha256 IS NOT NULL)))),
  CHECK(status NOT IN ('active','terminated','superseded') OR (user_id IS NOT NULL AND member_signed_name IS NOT NULL AND member_signed_at IS NOT NULL AND member_signature_sha256 IS NOT NULL)),
  CHECK(status <> 'terminated' OR termination_date IS NOT NULL),
  CHECK(status NOT IN ('declined','voided','terminated','superseded') OR closed_at IS NOT NULL)
);
CREATE INDEX contracts_organization ON contracts(organization_id, status, created_at DESC);
CREATE INDEX contracts_user ON contracts(user_id, status);
CREATE UNIQUE INDEX contracts_invitation ON contracts(invitation_id) WHERE invitation_id IS NOT NULL AND status IN ('draft','sent','active');
-- What was sent is what is signed: the content, the terms and both signatures never change afterwards. Only the
-- person (when an invitation is accepted), the member signature, the status and the closing fields are written.
CREATE TRIGGER contracts_frozen BEFORE UPDATE ON contracts WHEN OLD.status <> 'draft' AND (
  NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.template_version_id IS NOT OLD.template_version_id
  OR NEW.engagement IS NOT OLD.engagement OR NEW.title IS NOT OLD.title OR NEW.body_json IS NOT OLD.body_json OR NEW.body_text IS NOT OLD.body_text
  OR NEW.terms_json IS NOT OLD.terms_json OR NEW.party_name IS NOT OLD.party_name OR NEW.party_email IS NOT OLD.party_email
  OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.document_sha256 IS NOT OLD.document_sha256
  OR NEW.sent_at IS NOT OLD.sent_at OR NEW.org_signer_id IS NOT OLD.org_signer_id OR NEW.org_signed_name IS NOT OLD.org_signed_name
  OR NEW.org_signed_at IS NOT OLD.org_signed_at OR NEW.org_signature_sha256 IS NOT OLD.org_signature_sha256
  OR NEW.invitation_id IS NOT OLD.invitation_id OR NEW.supersedes_id IS NOT OLD.supersedes_id OR NEW.created_by IS NOT OLD.created_by
  OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id)
  OR (OLD.member_signed_at IS NOT NULL AND (NEW.member_signed_at IS NOT OLD.member_signed_at OR NEW.member_signed_name IS NOT OLD.member_signed_name OR NEW.member_signature_sha256 IS NOT OLD.member_signature_sha256))
)
BEGIN SELECT RAISE(ABORT,'a sent contract is never edited'); END;
-- The life of a contract: draft → sent → active → terminated or superseded; sent → declined or voided; draft → voided.
CREATE TRIGGER contracts_status BEFORE UPDATE OF status ON contracts WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'draft' AND NEW.status IN ('sent','voided'))
  OR (OLD.status = 'sent' AND NEW.status IN ('active','declined','voided'))
  OR (OLD.status = 'active' AND NEW.status IN ('terminated','superseded'))
)
BEGIN SELECT RAISE(ABORT,'contract status change not allowed'); END;
CREATE TRIGGER contracts_delete BEFORE DELETE ON contracts WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT,'only a draft contract is removed'); END;

-- The volunteer agreement (ST-151) becomes a template with one version per published version of the agreement. Its
-- plain-text paragraphs (separated by a blank line) become rich-text paragraphs.
INSERT INTO contract_templates(id,organization_id,name,engagement,description,status,created_by,created_at,updated_at)
  SELECT 'ct-volunteer-' || d.organization_id, d.organization_id, 'Acuerdo de voluntariado ad honorem', 'volunteer',
    'Actividad voluntaria sin remuneración económica. Proviene del acuerdo de voluntariado publicado.', 'active',
    (SELECT published_by FROM legal_documents x WHERE x.organization_id = d.organization_id AND x.kind = 'volunteer' AND x.status = 'published' ORDER BY x.version LIMIT 1),
    MIN(d.published_at), MAX(d.published_at)
  FROM legal_documents d WHERE d.kind = 'volunteer' AND d.status = 'published' GROUP BY d.organization_id;

WITH RECURSIVE parts(id, piece, rest, n) AS (
  SELECT id, '', replace(body, char(13), '') || char(10) || char(10), 0 FROM legal_documents WHERE kind = 'volunteer' AND status = 'published'
  UNION ALL
  SELECT id, substr(rest, 1, instr(rest, char(10) || char(10)) - 1), substr(rest, instr(rest, char(10) || char(10)) + 2), n + 1
  FROM parts WHERE rest <> '' AND instr(rest, char(10) || char(10)) > 0
),
paragraphs AS (
  SELECT id, json_group_array(json_object('type','paragraph','content', json_array(json_object('type','text','text', trim(replace(piece, char(10), ' ')))))) AS content
  FROM (SELECT id, piece, n FROM parts WHERE n > 0 AND trim(piece) <> '' ORDER BY id, n) GROUP BY id
)
INSERT INTO contract_template_versions(id,organization_id,template_id,status,version,title,body_json,body_text,defaults_json,editable_json,effective_from,updated_by,updated_at,published_by,published_at)
  SELECT 'ctv-' || d.id, d.organization_id, 'ct-volunteer-' || d.organization_id, 'published', d.version, d.title,
    json_object('type','doc','content', json(p.content)), d.body,
    json_object('role','Educador voluntario','compensation',json_object('kind','none'),'term',json_object('kind','indefinite')),
    json_array('role','term','weeklyHours','noticeDays','location','notes'), substr(d.published_at, 1, 10),
    d.updated_by, d.updated_at, d.published_by, d.published_at
  FROM legal_documents d JOIN paragraphs p ON p.id = d.id WHERE d.kind = 'volunteer' AND d.status = 'published';

-- Each agreement signed and not withdrawn becomes an active contract with the signature it already has.
INSERT INTO contracts(id,organization_id,template_version_id,origin,engagement,title,body_json,body_text,terms_json,party_name,party_email,user_id,start_date,status,document_sha256,
    created_by,created_at,updated_at,sent_at,member_signed_name,member_signed_at,member_signature_sha256)
  SELECT 'contract-' || s.id, s.organization_id, 'ctv-' || d.id, 'volunteer-agreement', 'volunteer', d.title, v.body_json, d.body,
    v.defaults_json, s.signed_name, u.email, s.user_id, substr(s.signed_at, 1, 10), 'active', s.document_sha256,
    d.published_by, s.signed_at, s.signed_at, d.published_at, s.signed_name, s.signed_at, s.signature_sha256
  FROM legal_signatures s JOIN legal_acceptances a ON a.id = s.acceptance_id AND a.withdrawn_at IS NULL
  JOIN legal_documents d ON d.id = s.document_id AND d.kind = 'volunteer'
  JOIN contract_template_versions v ON v.id = 'ctv-' || d.id
  JOIN users u ON u.id = s.user_id
  ORDER BY s.signed_at;

UPDATE organizations SET contract_required = 1 WHERE id IN (SELECT organization_id FROM contract_templates WHERE engagement = 'volunteer');
