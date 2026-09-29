-- Generic course authoring. Legacy tables and public snapshots remain intact.
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  legacy_program_id TEXT NOT NULL UNIQUE REFERENCES programs(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL CHECK(profile IN ('free','preschool','school','university','workshop','laboratory')),
  unit_label TEXT NOT NULL CHECK(unit_label IN ('Temas','Experiencias','Unidades','Semanas','Módulos','Prácticas')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  UNIQUE(id,organization_id)
);
CREATE TABLE learning_units (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  legacy_unit_id TEXT REFERENCES units(id),
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position>=0),
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  updated_at TEXT NOT NULL,
  UNIQUE(course_id,legacy_unit_id),
  UNIQUE(id,course_id)
);
CREATE INDEX learning_units_course ON learning_units(course_id,position);
CREATE INDEX courses_organization ON courses(organization_id,status);
INSERT INTO courses(id,organization_id,legacy_program_id,title,profile,unit_label,updated_at)
SELECT 'course-'||id,organization_id,id,title,'free','Unidades',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM programs;
-- A legacy unit can serve several legacy programs. Map only proven lesson links;
-- unattached units go to the organization's first existing course, never per level.
INSERT INTO learning_units(id,course_id,legacy_unit_id,name,objective,position,status,updated_at)
SELECT c.id||'--'||u.id,c.id,u.id,u.name,u.objective,
  row_number() OVER(PARTITION BY c.id ORDER BY lv.position,u.position,u.id)-1,
  CASE WHEN lv.status='archived' THEN 'archived' ELSE u.status END,u.updated_at
FROM units u JOIN levels lv ON lv.id=u.level_id JOIN courses c ON c.organization_id=lv.organization_id
WHERE EXISTS(SELECT 1 FROM lessons l WHERE l.unit_id=u.id AND l.program_id=c.legacy_program_id)
   OR (NOT EXISTS(SELECT 1 FROM lessons l WHERE l.unit_id=u.id)
       AND c.id=(SELECT min(first.id) FROM courses first WHERE first.organization_id=c.organization_id));
ALTER TABLE lessons ADD COLUMN course_unit_id TEXT REFERENCES learning_units(id);
UPDATE lessons SET course_unit_id=(SELECT lu.id FROM learning_units lu JOIN courses c ON c.id=lu.course_id
  WHERE lu.legacy_unit_id=lessons.unit_id AND c.legacy_program_id=lessons.program_id);
CREATE INDEX lessons_course_unit ON lessons(course_unit_id,position);

CREATE TABLE vocabularies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id,name_key),
  UNIQUE(id,organization_id)
);
CREATE TABLE taxonomy_terms (
  id TEXT PRIMARY KEY,
  vocabulary_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(vocabulary_id,organization_id) REFERENCES vocabularies(id,organization_id),
  UNIQUE(vocabulary_id,name_key),
  UNIQUE(id,organization_id)
);
CREATE TABLE course_terms (
  course_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  PRIMARY KEY(course_id,term_id),
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  FOREIGN KEY(term_id,organization_id) REFERENCES taxonomy_terms(id,organization_id)
);
-- The generic material model has no language-specific CHECK or required fields.
-- Legacy resources remain readable for existing references; nothing is deleted.
CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text','link')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  UNIQUE(id,organization_id)
);
CREATE INDEX materials_course ON materials(course_id,status);
CREATE TABLE material_terms (
  material_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  PRIMARY KEY(material_id,term_id),
  FOREIGN KEY(material_id,organization_id) REFERENCES materials(id,organization_id),
  FOREIGN KEY(term_id,organization_id) REFERENCES taxonomy_terms(id,organization_id)
);
-- Classification choices, not fabricated course content or academic policies.
INSERT INTO vocabularies(id,organization_id,name,name_key,status)
SELECT 'discipline-'||id,id,'Disciplina','disciplina','active' FROM organizations;
INSERT INTO taxonomy_terms(id,vocabulary_id,organization_id,name,name_key,status)
SELECT 'discipline-'||o.id||'-'||t.slug,'discipline-'||o.id,o.id,t.name,t.name_key,'active'
FROM organizations o CROSS JOIN (
  SELECT 'arts' AS slug,'Artes' AS name,'artes' AS name_key UNION ALL
  SELECT 'science','Ciencias','ciencias' UNION ALL
  SELECT 'technology','Tecnología','tecnología' UNION ALL
  SELECT 'languages','Idiomas','idiomas'
) t;
