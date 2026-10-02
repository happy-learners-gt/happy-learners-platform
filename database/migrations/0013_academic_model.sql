-- Academic model. Courses are described with standard dimensions (UNESCO ISCED 2011 type and level,
-- ISCED-F 2013 field, format, modality, pacing) and a settings object; study programs group courses and
-- share or fix their configuration. The old profile, unit label and course classification columns stay
-- untouched for history; the application stops reading them.
CREATE TABLE study_programs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  education_type TEXT NOT NULL CHECK(education_type IN ('formal','non-formal')),
  level TEXT NOT NULL CHECK(level IN ('early-childhood','pre-primary','primary','lower-secondary','upper-secondary','post-secondary','short-tertiary','bachelor','master','doctoral','unspecified')),
  format TEXT NOT NULL CHECK(format IN ('subject','open-course','workshop','laboratory','seminar')),
  modality TEXT NOT NULL CHECK(modality IN ('in-person','online','hybrid')),
  pacing TEXT NOT NULL CHECK(pacing IN ('scheduled','self-paced')),
  area TEXT CHECK(area IS NULL OR length(area) IN (2,3)),
  settings TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings) AND json_type(settings)='object'),
  locked TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(locked) AND json_type(locked)='array'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  CHECK(education_type='non-formal' OR level<>'unspecified'),
  UNIQUE(organization_id,name_key),
  UNIQUE(id,organization_id)
);
ALTER TABLE courses ADD COLUMN program_id TEXT REFERENCES study_programs(id);
ALTER TABLE courses ADD COLUMN education_type TEXT NOT NULL DEFAULT 'non-formal' CHECK(education_type IN ('formal','non-formal'));
ALTER TABLE courses ADD COLUMN level TEXT NOT NULL DEFAULT 'unspecified' CHECK(level IN ('early-childhood','pre-primary','primary','lower-secondary','upper-secondary','post-secondary','short-tertiary','bachelor','master','doctoral','unspecified'));
ALTER TABLE courses ADD COLUMN format TEXT NOT NULL DEFAULT 'open-course' CHECK(format IN ('subject','open-course','workshop','laboratory','seminar'));
ALTER TABLE courses ADD COLUMN modality TEXT NOT NULL DEFAULT 'online' CHECK(modality IN ('in-person','online','hybrid'));
ALTER TABLE courses ADD COLUMN pacing TEXT NOT NULL DEFAULT 'self-paced' CHECK(pacing IN ('scheduled','self-paced'));
ALTER TABLE courses ADD COLUMN area TEXT CHECK(area IS NULL OR length(area) IN (2,3));
ALTER TABLE courses ADD COLUMN settings TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings) AND json_type(settings)='object');
CREATE INDEX courses_program ON courses(program_id);
-- A course can only belong to a program of its own organization.
CREATE TRIGGER courses_program_organization_insert BEFORE INSERT ON courses
WHEN NEW.program_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_programs p WHERE p.id=NEW.program_id AND p.organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'program belongs to another organization'); END;
CREATE TRIGGER courses_program_organization_update BEFORE UPDATE OF program_id,organization_id ON courses
WHEN NEW.program_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_programs p WHERE p.id=NEW.program_id AND p.organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'program belongs to another organization'); END;

-- Translate each former profile to the standard dimensions.
UPDATE courses SET education_type='non-formal',level='unspecified',format='open-course',modality='online',pacing='self-paced' WHERE profile='free';
UPDATE courses SET education_type='formal',level='pre-primary',format='subject',modality='in-person',pacing='scheduled' WHERE profile='preschool';
UPDATE courses SET education_type='formal',level='lower-secondary',format='subject',modality='in-person',pacing='scheduled' WHERE profile='school';
UPDATE courses SET education_type='formal',level='bachelor',format='subject',modality='hybrid',pacing='scheduled' WHERE profile='university';
UPDATE courses SET education_type='non-formal',level='unspecified',format='workshop',modality='in-person',pacing='scheduled' WHERE profile='workshop';
UPDATE courses SET education_type='formal',level='upper-secondary',format='laboratory',modality='in-person',pacing='scheduled' WHERE profile='laboratory';
-- Keep today's behaviour: formal courses did not require outcomes or assessment to publish, and courses that
-- already have groups keep attendance even when their modality alone would not enable it.
UPDATE courses SET settings=json_set(settings,'$.outcomesRequired',json('false'),'$.assessmentRequired',json('false')) WHERE education_type='formal';
UPDATE courses SET settings=json_set(settings,'$.attendance',json('true')) WHERE modality='online' AND EXISTS(SELECT 1 FROM course_groups g WHERE g.course_id=courses.id);
-- "Semanas" was the only label chosen on purpose that is still offered; the rest become «Módulos».
UPDATE courses SET settings=json_set(settings,'$.moduleLabel','weeks') WHERE unit_label='Semanas';
-- The former «Disciplina» classification becomes the ISCED-F field.
UPDATE courses SET area=(SELECT CASE
    WHEN ct.term_id='discipline-'||courses.organization_id||'-languages' THEN '023'
    WHEN ct.term_id='discipline-'||courses.organization_id||'-arts' THEN '021'
    WHEN ct.term_id='discipline-'||courses.organization_id||'-technology' THEN '061'
    WHEN ct.term_id='discipline-'||courses.organization_id||'-science' THEN '05' END
  FROM course_terms ct WHERE ct.course_id=courses.id AND ct.term_id IN (
    'discipline-'||courses.organization_id||'-languages','discipline-'||courses.organization_id||'-arts',
    'discipline-'||courses.organization_id||'-technology','discipline-'||courses.organization_id||'-science')
  ORDER BY ct.term_id LIMIT 1);
-- The demo course teaches English to young children: its field is languages.
UPDATE courses SET area='023' WHERE id='course-exploradores' AND area IS NULL;
