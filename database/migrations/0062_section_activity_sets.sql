-- The section chooses which set does each activity. Usual groups become the set «Grupos de la sección».
-- An evaluation's former set is copied for the section that owns that set. The column stays, but readers use this table.
-- set_id on work_groups stays nullable: a group inserted without a set still shares the old name bucket.

CREATE TABLE section_activity_sets (
  group_id TEXT NOT NULL REFERENCES course_groups(id),
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lesson','assessment')),
  set_id TEXT NOT NULL REFERENCES work_group_sets(id),
  PRIMARY KEY (group_id, activity_id, kind)
);
CREATE INDEX section_activity_sets_by_set ON section_activity_sets(set_id);

CREATE TABLE _default_sets_62 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  group_id TEXT NOT NULL
);
INSERT INTO _default_sets_62(id, organization_id, group_id)
SELECT 'groupset-' || lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  organization_id, group_id
FROM work_groups WHERE set_id IS NULL
GROUP BY organization_id, group_id;

INSERT INTO work_group_sets(id, organization_id, group_id, name, rules, source, created_by, created_at, updated_at)
SELECT d.id, d.organization_id, d.group_id, 'Grupos de la sección',
  '{"by":"size","size":4,"how":"random","seed":"seccion"}', 'manual',
  (SELECT user_id FROM memberships WHERE organization_id=d.organization_id AND active=1 ORDER BY user_id LIMIT 1),
  datetime('now'), datetime('now')
FROM _default_sets_62 d
WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id=d.organization_id AND m.active=1);

UPDATE work_groups SET set_id=(
  SELECT s.id FROM work_group_sets s
  WHERE s.group_id=work_groups.group_id AND s.organization_id=work_groups.organization_id AND s.name='Grupos de la sección'
) WHERE set_id IS NULL AND EXISTS (
  SELECT 1 FROM work_group_sets s
  WHERE s.group_id=work_groups.group_id AND s.organization_id=work_groups.organization_id AND s.name='Grupos de la sección'
);

DROP TABLE _default_sets_62;

INSERT INTO section_activity_sets(group_id, activity_id, kind, set_id)
SELECT s.group_id, a.id, 'assessment', a.work_group_set_id
FROM assessment_activities a
JOIN work_group_sets s ON s.id=a.work_group_set_id
WHERE a.work_group_set_id IS NOT NULL;
