-- ST-029: the shared demo educator's group receives the first published lesson of its course that students
-- can open (it has a share code), so the dashboard shows the effective publication of a current assignment.
-- Cumulative: 0016 stays unchanged and no existing lesson content is rewritten.
INSERT INTO lesson_assignments(id,organization_id,course_id,group_id,lesson_id,starts_on,ends_on,assigned_revision,status,created_by,created_at,updated_at)
SELECT 'seed-assignment-demo-class',g.organization_id,g.course_id,g.id,
  (SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND json_extract(l.published_content,'$.shareCode') IS NOT NULL ORDER BY u.position,l.position,l.id LIMIT 1),
  '2026-09-01',NULL,
  (SELECT l.revision FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND json_extract(l.published_content,'$.shareCode') IS NOT NULL ORDER BY u.position,l.position,l.id LIMIT 1),
  'active',m.user_id,'2026-09-01T13:00:00.000Z','2026-09-01T13:00:00.000Z'
FROM course_groups g JOIN course_members m ON m.course_id=g.course_id AND m.role='lead'
WHERE g.id='group-demo-class' AND g.status='active'
  AND EXISTS(SELECT 1 FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=g.course_id AND l.archived=0 AND l.revision>=1 AND json_extract(l.published_content,'$.shareCode') IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM lesson_assignments a WHERE a.group_id=g.id AND a.status='active');
