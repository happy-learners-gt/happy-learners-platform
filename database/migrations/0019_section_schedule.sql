-- ST-099: each section of a course has a weekly schedule; saving it generates the classes of its period.
ALTER TABLE course_groups ADD COLUMN schedule_weekdays TEXT CHECK(schedule_weekdays IS NULL OR schedule_weekdays GLOB '[0-6]*');
ALTER TABLE course_groups ADD COLUMN schedule_starts_at TEXT CHECK(schedule_starts_at IS NULL OR schedule_starts_at GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE course_groups ADD COLUMN schedule_duration INTEGER CHECK(schedule_duration IS NULL OR schedule_duration BETWEEN 5 AND 480);
ALTER TABLE course_groups ADD COLUMN schedule_from TEXT;
ALTER TABLE course_groups ADD COLUMN schedule_until TEXT;
-- A generated class follows its section's schedule; a class added by hand stays when the schedule changes.
ALTER TABLE class_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','schedule'));

-- lesson_assignments and class_session_resources are no longer read: a class takes its lesson from the schedule of
-- classes and its resources from the lesson's publication. They stay until ST-076 so v0.8.3 can still be restored.

-- Demo (org-demo only): the weekly time of each section comes from the classes planned in 0018.
UPDATE class_sessions SET origin='schedule' WHERE organization_id='org-demo' AND id LIKE 'seed-plan-%';
UPDATE course_groups SET
  schedule_weekdays=(SELECT group_concat(w, ',') FROM (SELECT DISTINCT strftime('%w', s.session_date) AS w FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule' ORDER BY w)),
  schedule_starts_at=(SELECT s.starts_at FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule' ORDER BY s.session_date LIMIT 1),
  schedule_duration=(SELECT s.duration_minutes FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule' ORDER BY s.session_date LIMIT 1),
  schedule_from=(SELECT min(s.session_date) FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule'),
  schedule_until=(SELECT max(s.session_date) FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule')
WHERE organization_id='org-demo' AND EXISTS(SELECT 1 FROM class_sessions s WHERE s.group_id=course_groups.id AND s.origin='schedule');

-- Every demo class repeated the same lesson; untouched planned classes follow the course's published lessons in
-- content order, and those beyond the last lesson wait for the educator.
UPDATE class_sessions SET lesson_id=(
  SELECT p.lesson_id FROM (
    SELECT s.id AS session_id, s.course_id, row_number() OVER (PARTITION BY s.group_id ORDER BY s.session_date, s.starts_at) AS n
    FROM class_sessions s WHERE s.organization_id='org-demo' AND s.origin='schedule' AND s.status='planned' AND s.version=1) q
  JOIN (
    SELECT l.id AS lesson_id, u.course_id, row_number() OVER (PARTITION BY u.course_id ORDER BY u.position, l.position, l.id) AS n
    FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.status='active' AND l.archived=0 AND l.revision>0) p
    ON p.course_id=q.course_id AND p.n=q.n
  WHERE q.session_id=class_sessions.id)
WHERE organization_id='org-demo' AND origin='schedule' AND status='planned' AND version=1;
