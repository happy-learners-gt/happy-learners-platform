-- A course resource is one library item with a record (1.3.7). Materials and files become resources;
-- the bibliography becomes a role on that resource. course_bibliography stays, and nothing reads it after this.
-- The extracted text and the book map stay on the file, unchanged.

CREATE TABLE course_resources (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL,
  material_id TEXT REFERENCES materials(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES course_files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('file','link','text','reference')),
  type TEXT NOT NULL CHECK(type IN ('book','chapter','article','guide','standard','score','video','dataset','case','template','rubric','website','other')),
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(authors) AND json_type(authors)='array'),
  year INTEGER CHECK(year IS NULL OR year BETWEEN 1000 AND 2100),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata)='object'),
  language TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT 'reserved' CHECK(license IN ('reserved','cc-by','cc-by-sa','cc-by-nc','public-domain','internal')),
  shareable INTEGER NOT NULL DEFAULT 0 CHECK(shareable IN (0,1)),
  level TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  role TEXT CHECK(role IS NULL OR role IN ('primary','required','recommended','support')),
  citation_override TEXT CHECK(citation_override IS NULL OR length(citation_override) <= 500),
  status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id),
  CHECK((kind='reference' AND material_id IS NULL AND file_id IS NULL) OR (kind='file' AND file_id IS NOT NULL AND material_id IS NULL) OR (kind IN ('link','text') AND material_id IS NOT NULL AND file_id IS NULL))
);
CREATE UNIQUE INDEX course_resources_one_primary ON course_resources(course_id) WHERE role='primary';
CREATE UNIQUE INDEX course_resources_material ON course_resources(course_id, material_id) WHERE material_id IS NOT NULL;
CREATE UNIQUE INDEX course_resources_file ON course_resources(course_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX course_resources_course ON course_resources(course_id, status);

CREATE TABLE resource_index (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES course_resources(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES resource_index(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  title TEXT NOT NULL,
  start_page INTEGER CHECK(start_page IS NULL OR start_page >= 1),
  end_page INTEGER CHECK(end_page IS NULL OR end_page >= 1),
  start_seconds INTEGER CHECK(start_seconds IS NULL OR start_seconds >= 0),
  end_seconds INTEGER CHECK(end_seconds IS NULL OR end_seconds >= 0),
  source TEXT NOT NULL CHECK(source IN ('outline','detected','manual'))
);
CREATE INDEX resource_index_resource ON resource_index(resource_id, position);

CREATE TABLE readings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  group_id TEXT REFERENCES course_groups(id),
  resource_id TEXT NOT NULL REFERENCES course_resources(id) ON DELETE CASCADE,
  index_id TEXT REFERENCES resource_index(id) ON DELETE SET NULL,
  pages TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id),
  FOREIGN KEY(unit_id, course_id) REFERENCES learning_units(id, course_id)
);
CREATE INDEX readings_course ON readings(course_id, unit_id, position);

CREATE TABLE reading_marks (
  reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES group_learners(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  read_at TEXT NOT NULL,
  PRIMARY KEY(reading_id, learner_id)
);

-- Who signs a migrated row: the course lead, or an administrator of the organization.
-- A bibliography role becomes the resource role; a handwritten citation is kept as the override.
INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at)
SELECT 'resource-'||m.id, m.organization_id, m.course_id, m.id, NULL, m.kind,
  CASE WHEN b.role='text' THEN 'book' ELSE 'other' END,
  m.title, '[]', NULL, '{}', '', 'reserved', 0, '', '',
  CASE b.role WHEN 'text' THEN CASE WHEN b.is_primary=1 THEN 'primary' ELSE 'required' END WHEN 'support' THEN 'support' WHEN 'other' THEN 'recommended' ELSE NULL END,
  NULLIF(b.citation, ''),
  m.status,
  COALESCE((SELECT user_id FROM course_members WHERE course_id=m.course_id AND role='lead' LIMIT 1), (SELECT mb.user_id FROM memberships mb WHERE mb.organization_id=m.organization_id AND mb.role='admin' LIMIT 1)),
  m.updated_at, m.updated_at
FROM materials m
LEFT JOIN course_bibliography b ON b.material_id=m.id AND b.course_id=m.course_id;

INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at)
SELECT 'resource-'||f.id, f.organization_id, f.course_id, NULL, f.id, 'file',
  CASE WHEN b.role='text' THEN 'book' ELSE 'other' END,
  substr(f.original_name,1,length(f.original_name)-length(f.extension)-1), '[]', NULL, '{}', '', 'reserved', 0, '', '',
  CASE b.role WHEN 'text' THEN CASE WHEN b.is_primary=1 THEN 'primary' ELSE 'required' END WHEN 'support' THEN 'support' WHEN 'other' THEN 'recommended' ELSE NULL END,
  NULLIF(b.citation, ''),
  CASE f.status WHEN 'ready' THEN 'published' WHEN 'archived' THEN 'archived' ELSE 'draft' END,
  f.created_by, f.created_at, f.updated_at
FROM course_files f
LEFT JOIN course_bibliography b ON b.file_id=f.id AND b.course_id=f.course_id
WHERE f.status<>'uploading';

-- Later library items become resources too. A file does, once it is ready.
CREATE TRIGGER materials_become_resources AFTER INSERT ON materials
BEGIN
  INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at)
  SELECT 'resource-'||NEW.id, NEW.organization_id, NEW.course_id, NEW.id, NULL, NEW.kind, 'other', NEW.title, '[]', NULL, '{}', '', 'reserved', 0, '', '', NULL, NULL, NEW.status,
    COALESCE((SELECT user_id FROM course_members WHERE course_id=NEW.course_id AND role='lead' LIMIT 1), (SELECT mb.user_id FROM memberships mb WHERE mb.organization_id=NEW.organization_id AND mb.role='admin' LIMIT 1)),
    NEW.updated_at, NEW.updated_at
  WHERE NOT EXISTS (SELECT 1 FROM course_resources WHERE material_id=NEW.id);
END;
CREATE TRIGGER course_files_become_resources AFTER UPDATE OF status ON course_files
WHEN NEW.status='ready' AND OLD.status<>'ready'
BEGIN
  INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at)
  SELECT 'resource-'||NEW.id, NEW.organization_id, NEW.course_id, NULL, NEW.id, 'file', 'other',
    substr(NEW.original_name,1,length(NEW.original_name)-length(NEW.extension)-1), '[]', NULL, '{}', '', 'reserved', 0, '', '', NULL, NULL, 'published', NEW.created_by, NEW.created_at, NEW.updated_at
  WHERE NOT EXISTS (SELECT 1 FROM course_resources WHERE file_id=NEW.id);
END;
