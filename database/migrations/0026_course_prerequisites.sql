-- Program prerequisites (DEC-029). Inside a program, a course can require other courses of the same program: the
-- program reads as a path, and each course says what comes before and after it.
CREATE TABLE course_prerequisites (
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  required_course_id TEXT NOT NULL REFERENCES courses(id),
  PRIMARY KEY(course_id, required_course_id),
  CHECK(course_id <> required_course_id)
);
CREATE INDEX course_prerequisites_required ON course_prerequisites(required_course_id);
