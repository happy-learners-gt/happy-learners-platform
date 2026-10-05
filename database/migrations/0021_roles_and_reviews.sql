-- DEC-023, ST-103: each section names the educators who teach its classes. They belong to the course's team.
CREATE TABLE section_educators (
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(group_id, user_id),
  -- Deferred: saving a team rewrites its rows inside one transaction.
  FOREIGN KEY(course_id, user_id) REFERENCES course_members(course_id, user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX section_educators_user ON section_educators(user_id, course_id);

-- Everyone on a team kept reaching every section of the course until now: they keep teaching all of them.
INSERT INTO section_educators(group_id, user_id, course_id, organization_id, added_at)
  SELECT g.id, m.user_id, g.course_id, g.organization_id, m.added_at
  FROM course_groups g JOIN course_members m ON m.course_id = g.course_id AND m.organization_id = g.organization_id;

-- DEC-023, ST-104: a co-teacher asks the lead to publish a lesson; the lead publishes it or returns it with a comment.
CREATE TABLE lesson_reviews (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'returned', 'approved')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 600),
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '' CHECK(length(decision_note) <= 600),
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id)
);
-- One open request per lesson.
CREATE UNIQUE INDEX lesson_reviews_one_pending ON lesson_reviews(lesson_id) WHERE status = 'pending';
CREATE INDEX lesson_reviews_course ON lesson_reviews(course_id, status, requested_at DESC);
CREATE INDEX lesson_reviews_author ON lesson_reviews(requested_by, requested_at DESC);
