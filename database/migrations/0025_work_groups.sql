-- Work groups (DEC-028). The students of a section are the universe: the whole section is the default group, and
-- its educators form smaller groups from its list and assign them to the activities done in pairs or in teams.
CREATE TABLE work_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX work_groups_name ON work_groups(group_id, name COLLATE NOCASE);

CREATE TABLE work_group_members (
  work_group_id TEXT NOT NULL REFERENCES work_groups(id),
  learner_id TEXT NOT NULL REFERENCES group_learners(id),
  PRIMARY KEY(work_group_id, learner_id)
);
CREATE INDEX work_group_members_learner ON work_group_members(learner_id);

-- Which groups of a section do an activity of a published lesson. An activity without rows is done by the whole section.
CREATE TABLE activity_work_groups (
  organization_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  activity_id TEXT NOT NULL,
  work_group_id TEXT NOT NULL REFERENCES work_groups(id),
  PRIMARY KEY(group_id, lesson_id, activity_id, work_group_id)
);
CREATE INDEX activity_work_groups_group ON activity_work_groups(work_group_id);
