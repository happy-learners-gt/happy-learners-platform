-- DEC-024: each section is its own instance of the course. What happens in it is recorded as the section's own.
ALTER TABLE activity_events ADD COLUMN group_id TEXT REFERENCES course_groups(id);
UPDATE activity_events SET group_id = target_id WHERE target_type = 'group' AND target_id IN (SELECT id FROM course_groups);
UPDATE activity_events SET group_id = (SELECT s.group_id FROM class_sessions s WHERE s.id = activity_events.target_id) WHERE target_type = 'session';
CREATE INDEX activity_events_group ON activity_events(group_id, occurred_at DESC);

-- A student who opens a lesson with the section code counts for that section; an opening by link alone counts for none.
ALTER TABLE lesson_completions ADD COLUMN group_id TEXT REFERENCES course_groups(id);
CREATE INDEX lesson_completions_group ON lesson_completions(group_id);
