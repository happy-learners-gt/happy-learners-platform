-- ST-027: a published lesson assigned to a course group for a period. The assignment remembers the publication
-- it was made with, so a later publication or an archived lesson is identified without losing the original.
CREATE TABLE lesson_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  starts_on TEXT NOT NULL CHECK(starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on TEXT CHECK(ends_on IS NULL OR (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ends_on >= starts_on)),
  assigned_revision INTEGER NOT NULL CHECK(assigned_revision >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(group_id,course_id,organization_id) REFERENCES course_groups(id,course_id,organization_id)
);
CREATE INDEX lesson_assignments_course ON lesson_assignments(course_id,status,starts_on);
CREATE INDEX lesson_assignments_lesson ON lesson_assignments(lesson_id,status);

-- Demo: each seeded group gets the first published lesson of its course, current from the start of the term.
INSERT INTO lesson_assignments(id,organization_id,course_id,group_id,lesson_id,starts_on,ends_on,assigned_revision,status,created_by,created_at,updated_at)
SELECT 'seed-assignment-'||substr(g.id,length('seed-group-')+1),g.organization_id,g.course_id,g.id,
  (SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND l.published_content IS NOT NULL ORDER BY u.position,l.position,l.id LIMIT 1),
  '2026-09-01','2026-12-18',
  (SELECT l.revision FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND l.published_content IS NOT NULL ORDER BY u.position,l.position,l.id LIMIT 1),
  'active',(SELECT user_id FROM course_members m WHERE m.course_id=g.course_id AND m.role='lead' LIMIT 1),'2026-09-01T13:00:00.000Z','2026-09-01T13:00:00.000Z'
FROM course_groups g
WHERE g.id LIKE 'seed-group-%' AND g.status='active'
  AND EXISTS(SELECT 1 FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND l.published_content IS NOT NULL AND l.revision>=1)
  AND EXISTS(SELECT 1 FROM course_members m WHERE m.course_id=g.course_id AND m.role='lead');
