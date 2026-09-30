-- Private Office files attached to a course. Objects remain in private R2;
-- this table stores scoped metadata, integrity hashes and retry-safe upload IDs.
CREATE TABLE course_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  upload_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  extension TEXT NOT NULL CHECK(extension IN ('docx','pptx','xlsx')),
  media_type TEXT NOT NULL CHECK(media_type IN (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 15728640),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  UNIQUE(course_id,upload_key),
  UNIQUE(id,organization_id)
);
CREATE INDEX course_files_course ON course_files(course_id,status,created_at DESC);
