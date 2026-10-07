-- DEC-035, ST-117: a lesson lasts what its activities add up to. Lessons saved before kept a separate duration; where
-- it differs, the draft and the publication take the sum of their activities' minutes. Other lessons stay as they are.
UPDATE lessons SET content=json_set(content,'$.duration',(SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.content,'$.activities') a))
  WHERE (SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.content,'$.activities') a) > 0
    AND json_extract(content,'$.duration') IS NOT (SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.content,'$.activities') a);
UPDATE lessons SET published_content=json_set(published_content,'$.duration',(SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.published_content,'$.activities') a))
  WHERE published_content IS NOT NULL AND (SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.published_content,'$.activities') a) > 0
    AND json_extract(published_content,'$.duration') IS NOT (SELECT sum(json_extract(a.value,'$.minutes')) FROM json_each(lessons.published_content,'$.activities') a);

-- DEC-035, ST-118: an educator may teach two sections whose classes overlap only when someone confirms it with a
-- reason. Each confirmation names both sections and stays as a record, also after the assignment changes.
CREATE TABLE educator_conflict_overrides (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  other_group_id TEXT NOT NULL REFERENCES course_groups(id),
  overlaps INTEGER NOT NULL CHECK(overlaps > 0),
  first_date TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
  confirmed_by TEXT NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL
);
CREATE INDEX educator_conflict_overrides_pair ON educator_conflict_overrides(user_id, group_id, other_group_id);
