-- Pacing (DEC-027). A course «Con calendario» gives each section a schedule and classes; a course «A tu ritmo» has
-- neither: each student of a section works through the published course in order and the section follows how far
-- each one got. A course or program that already holds classes is used with a calendar and keeps working that way.
UPDATE courses SET pacing='scheduled',version=version+1
  WHERE pacing='self-paced' AND program_id IS NULL AND EXISTS(SELECT 1 FROM class_sessions s WHERE s.course_id=courses.id);
UPDATE study_programs SET pacing='scheduled',version=version+1
  WHERE pacing='self-paced' AND EXISTS(SELECT 1 FROM courses c JOIN class_sessions s ON s.course_id=c.id WHERE c.program_id=study_programs.id);

-- Who is studying with the section code: a student of the section's list, chosen when entering a self-paced section.
ALTER TABLE group_access_sessions ADD COLUMN learner_id TEXT REFERENCES group_learners(id);

-- How far each student of a self-paced section got in each published lesson.
CREATE TABLE learner_progress (
  organization_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  learner_id TEXT NOT NULL REFERENCES group_learners(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  opened_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(group_id, learner_id, lesson_id),
  CHECK(completed_at IS NULL OR completed_at >= opened_at)
);
CREATE INDEX learner_progress_learner ON learner_progress(learner_id);
