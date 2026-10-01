-- Course files also accept PDF (≤ 25 MB) and MP4/WebM video (≤ 100 MB). SQLite cannot change a CHECK
-- constraint in place, so the table is rebuilt; every existing row, ID and hash is copied unchanged.
CREATE TABLE course_files_v2 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  upload_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  extension TEXT NOT NULL CHECK(extension IN ('docx','pptx','xlsx','pdf','mp4','webm')),
  media_type TEXT NOT NULL CHECK(media_type IN (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'video/mp4',
    'video/webm'
  )),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 104857600),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  UNIQUE(course_id,upload_key),
  UNIQUE(id,organization_id)
);
INSERT INTO course_files_v2(id,organization_id,course_id,upload_key,object_key,original_name,extension,media_type,size_bytes,sha256,status,created_by,created_at,updated_at)
  SELECT id,organization_id,course_id,upload_key,object_key,original_name,extension,media_type,size_bytes,sha256,status,created_by,created_at,updated_at FROM course_files;
DROP TABLE course_files;
ALTER TABLE course_files_v2 RENAME TO course_files;
CREATE INDEX course_files_course ON course_files(course_id,status,created_at DESC);
