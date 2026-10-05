-- ST-097, ST-101: a class of the course schedule plans none, one or several lessons of its course, in order, and
-- remembers the publication of each one it was taught with.
CREATE TABLE class_session_lessons (
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 5),
  revision INTEGER CHECK(revision IS NULL OR revision > 0),
  PRIMARY KEY(session_id, lesson_id),
  UNIQUE(session_id, position)
);
CREATE INDEX class_session_lessons_lesson ON class_session_lessons(lesson_id);

-- The single lesson of each class becomes its first planned lesson, with the publication it used.
-- class_sessions.lesson_id keeps mirroring the first lesson so v0.8.4 can still be restored.
INSERT INTO class_session_lessons(session_id, lesson_id, position, revision)
  SELECT id, lesson_id, 0, lesson_revision FROM class_sessions WHERE lesson_id IS NOT NULL;
