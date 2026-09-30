-- Attendance records are private to educators and store display labels only.
CREATE TABLE course_groups (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  UNIQUE(id,course_id,organization_id)
);
CREATE TABLE group_learners (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(group_id,course_id,organization_id) REFERENCES course_groups(id,course_id,organization_id),
  UNIQUE(id,group_id,organization_id)
);
CREATE TABLE class_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  lesson_id TEXT,
  session_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(group_id,course_id,organization_id) REFERENCES course_groups(id,course_id,organization_id),
  FOREIGN KEY(lesson_id) REFERENCES lessons(id)
);
CREATE TABLE attendance_marks (
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  learner_id TEXT NOT NULL REFERENCES group_learners(id),
  status TEXT NOT NULL CHECK(status IN ('present','late','absent','excused')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id,learner_id)
);
CREATE INDEX course_groups_course ON course_groups(course_id,status);
CREATE INDEX group_learners_group ON group_learners(group_id,status,display_name);
CREATE INDEX class_sessions_date ON class_sessions(course_id,session_date DESC);

-- Stable fictional roster for the shared product demo; no real learner details.
INSERT INTO course_groups(id,course_id,organization_id,name,created_at)
SELECT 'group-demo-class',id,organization_id,'Grupo de demostración',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM courses WHERE organization_id='org-demo' ORDER BY id LIMIT 1;
INSERT INTO group_learners(id,group_id,course_id,organization_id,display_name,created_at)
SELECT 'demo-participant-'||n,'group-demo-class',g.course_id,g.organization_id,'Participante de demostración '||printf('%02d',n),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM course_groups g CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) roster
WHERE g.id='group-demo-class';
