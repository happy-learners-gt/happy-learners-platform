-- The course's bibliography. Each reference points to an item already in the course's library: a material (text or
-- link) or a file stored in R2 (COURSE_FILES), never a copy. It has a role (text, support or other), an optional
-- citation, and at most one reference per course is its main book, which has the role «text».
-- Additive: no existing table changes.

CREATE TABLE IF NOT EXISTS course_bibliography (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  course_id TEXT NOT NULL,
  material_id TEXT,
  file_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('text','support','other')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  citation TEXT NOT NULL DEFAULT '' CHECK(length(citation) <= 300),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id),
  CHECK((material_id IS NULL) <> (file_id IS NULL)),
  CHECK(is_primary = 0 OR role = 'text'),
  UNIQUE(course_id, material_id),
  UNIQUE(course_id, file_id)
);
-- At most one main book per course.
CREATE UNIQUE INDEX IF NOT EXISTS course_bibliography_one_primary ON course_bibliography(course_id) WHERE is_primary = 1;

-- A reference only points to an item of its own course and organization.
CREATE TRIGGER IF NOT EXISTS course_bibliography_item_insert BEFORE INSERT ON course_bibliography
WHEN (NEW.material_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.id = NEW.material_id AND m.course_id = NEW.course_id AND m.organization_id = NEW.organization_id))
  OR (NEW.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM course_files f WHERE f.id = NEW.file_id AND f.course_id = NEW.course_id AND f.organization_id = NEW.organization_id))
BEGIN SELECT RAISE(ABORT, 'reference outside its course library'); END;
CREATE TRIGGER IF NOT EXISTS course_bibliography_item_update BEFORE UPDATE ON course_bibliography
WHEN NEW.course_id <> OLD.course_id OR NEW.organization_id <> OLD.organization_id OR NEW.material_id IS NOT OLD.material_id OR NEW.file_id IS NOT OLD.file_id
BEGIN SELECT RAISE(ABORT, 'a reference keeps its item'); END;
