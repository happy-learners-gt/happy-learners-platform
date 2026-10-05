-- ST-097, ST-071: a class is planned with a time, a lesson, library resources and notes, is started and finished,
-- and remembers who taught it and which publication of the lesson it used.
ALTER TABLE class_sessions ADD COLUMN starts_at TEXT CHECK(starts_at IS NULL OR starts_at GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE class_sessions ADD COLUMN duration_minutes INTEGER CHECK(duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480);
ALTER TABLE class_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled'));
ALTER TABLE class_sessions ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE class_sessions ADD COLUMN lesson_revision INTEGER;
ALTER TABLE class_sessions ADD COLUMN taught_by TEXT REFERENCES users(id);
ALTER TABLE class_sessions ADD COLUMN started_at TEXT;
ALTER TABLE class_sessions ADD COLUMN completed_at TEXT;
ALTER TABLE class_sessions ADD COLUMN updated_at TEXT;
ALTER TABLE class_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX class_sessions_group ON class_sessions(group_id,session_date);

-- Resources of the organization's library used in a class, in the order the educator chose. A link, never a copy.
CREATE TABLE class_session_resources (
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  resource_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(session_id,resource_id)
);
CREATE INDEX class_session_resources_resource ON class_session_resources(resource_id);

-- ST-098: a group code opens the group's classes, lessons and resources without an account or personal data.
ALTER TABLE course_groups ADD COLUMN access_code TEXT;
CREATE UNIQUE INDEX course_groups_access_code ON course_groups(access_code) WHERE access_code IS NOT NULL;
CREATE TABLE group_access_sessions (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  organization_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Classes recorded before this change: a class with attendance was taught by whoever took the roll.
UPDATE class_sessions SET status='completed',
  completed_at=(SELECT max(m.updated_at) FROM attendance_marks m WHERE m.session_id=class_sessions.id),
  taught_by=COALESCE((SELECT e.actor_id FROM activity_events e WHERE e.target_type='session' AND e.target_id=class_sessions.id ORDER BY e.occurred_at DESC LIMIT 1),
    (SELECT cm.user_id FROM course_members cm WHERE cm.course_id=class_sessions.course_id AND cm.role='lead' LIMIT 1)),
  lesson_revision=(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_sessions.lesson_id)
WHERE EXISTS(SELECT 1 FROM attendance_marks m WHERE m.session_id=class_sessions.id);
UPDATE class_sessions SET started_at=completed_at WHERE status='completed';
UPDATE class_sessions SET updated_at=COALESCE(completed_at,created_at);

-- Demo (org-demo only): each group keeps its weekly time, classes are planned until the end of November with the
-- group's assigned lesson and two resources of its course, and every group has a code to try the student view.
CREATE TABLE demo_schedule(group_id TEXT PRIMARY KEY, starts_at TEXT, duration INTEGER, weekdays TEXT, code TEXT);
INSERT INTO demo_schedule VALUES
  ('seed-group-mat-3a','08:00',45,'1,3','DG-MATE-3A'),
  ('seed-group-mat-3b','10:00',45,'2,4','DG-MATE-3B'),
  ('seed-group-cie-4a','13:00',50,'1,4','DG-CIEN-4A'),
  ('seed-group-eng-sab','09:00',60,'6','DG-ENGL-SAB'),
  ('seed-group-rob-mar','15:00',90,'2','DG-ROBO-MAR'),
  ('seed-group-art-k2','09:30',40,'1,3,5','DG-ARTE-K2'),
  ('group-demo-class','11:00',45,'2,4','DG-EXPL-DEMO');
UPDATE class_sessions SET starts_at=(SELECT starts_at FROM demo_schedule d WHERE d.group_id=class_sessions.group_id),
  duration_minutes=(SELECT duration FROM demo_schedule d WHERE d.group_id=class_sessions.group_id)
WHERE organization_id='org-demo' AND group_id IN (SELECT group_id FROM demo_schedule);
UPDATE course_groups SET access_code=(SELECT code FROM demo_schedule d WHERE d.group_id=course_groups.id)
WHERE organization_id='org-demo' AND id IN (SELECT group_id FROM demo_schedule);
INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,created_at,starts_at,duration_minutes,status,updated_at)
WITH RECURSIVE days(day) AS (SELECT '2026-10-09' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-11-27')
SELECT 'seed-plan-'||g.id||'-'||days.day,g.id,g.course_id,g.organization_id,
  (SELECT a.lesson_id FROM lesson_assignments a WHERE a.group_id=g.id AND a.status='active' ORDER BY a.starts_on LIMIT 1),
  days.day,'2026-10-04T12:00:00.000Z',d.starts_at,d.duration,'planned','2026-10-04T12:00:00.000Z'
FROM course_groups g JOIN demo_schedule d ON d.group_id=g.id CROSS JOIN days
WHERE g.organization_id='org-demo' AND g.status='active' AND instr(','||d.weekdays||',', ','||strftime('%w',days.day)||',')>0;
INSERT INTO class_session_resources(session_id,resource_id,organization_id,position)
SELECT s.id,r.id,s.organization_id,r.position FROM class_sessions s
JOIN (SELECT id,course_id,row_number() OVER (PARTITION BY course_id ORDER BY id)-1 AS position FROM materials WHERE organization_id='org-demo' AND status='published' AND kind IN ('link','text')) r
  ON r.course_id=s.course_id AND r.position<2
WHERE s.organization_id='org-demo' AND s.status='planned';
INSERT INTO class_session_resources(session_id,resource_id,organization_id,position)
SELECT s.id,r.id,s.organization_id,r.position FROM class_sessions s
JOIN (SELECT id,row_number() OVER (ORDER BY id)-1 AS position FROM resources WHERE organization_id='org-demo' AND status='published' AND archived=0) r ON r.position<2
WHERE s.organization_id='org-demo' AND s.status='planned' AND s.group_id='group-demo-class';
DROP TABLE demo_schedule;

-- The shared demo was renamed by an early test run; it keeps the name its seed defines.
UPDATE organizations SET name='Colegio Horizonte (demostración)' WHERE id='org-demo' AND name='Organización de Prueba';
