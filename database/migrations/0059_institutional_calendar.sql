-- Institutional calendars (1.3.0). Rules are reusable definitions; events are their generated occurrences or
-- one-off dates. Organization, program and section calendars add up. The old calendar_breaks table remains readable
-- for rollback, but every existing row is copied into the new model and new writes use calendar_events.

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  scope TEXT NOT NULL CHECK(scope IN ('organization','program','section')),
  scope_id TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='organization' AND scope_id IS NULL) OR (scope<>'organization' AND scope_id IS NOT NULL)),
  UNIQUE(id,organization_id)
);
CREATE UNIQUE INDEX calendars_scope ON calendars(organization_id,scope,COALESCE(scope_id,''));

CREATE TABLE calendar_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  key TEXT NOT NULL CHECK(key GLOB '[a-z]*' AND length(key) BETWEEN 1 AND 40),
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
  no_class_default INTEGER NOT NULL DEFAULT 0 CHECK(no_class_default IN (0,1)),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
  UNIQUE(organization_id,key),
  UNIQUE(id,organization_id)
);

CREATE TABLE calendar_rules (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  rule TEXT NOT NULL CHECK(json_valid(rule) AND json_type(rule)='object'),
  no_class INTEGER NOT NULL CHECK(no_class IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(calendar_id,organization_id) REFERENCES calendars(id,organization_id),
  FOREIGN KEY(category_id,organization_id) REFERENCES calendar_categories(id,organization_id),
  UNIQUE(id,organization_id)
);
CREATE INDEX calendar_rules_calendar ON calendar_rules(calendar_id);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  starts_on TEXT NOT NULL CHECK(date(starts_on)=starts_on),
  ends_on TEXT NOT NULL CHECK(date(ends_on)=ends_on),
  part TEXT NOT NULL DEFAULT 'full' CHECK(part IN ('full','morning','afternoon')),
  no_class INTEGER NOT NULL CHECK(no_class IN (0,1)),
  rule_id TEXT,
  year INTEGER CHECK(year IS NULL OR year BETWEEN 1583 AND 4099),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','skipped')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(calendar_id,organization_id) REFERENCES calendars(id,organization_id),
  FOREIGN KEY(category_id,organization_id) REFERENCES calendar_categories(id,organization_id),
  FOREIGN KEY(rule_id,organization_id) REFERENCES calendar_rules(id,organization_id),
  CHECK(ends_on>=starts_on),
  CHECK((rule_id IS NULL AND year IS NULL) OR (rule_id IS NOT NULL AND year IS NOT NULL))
);
CREATE INDEX calendar_events_calendar_dates ON calendar_events(calendar_id,starts_on,ends_on);
CREATE UNIQUE INDEX calendar_events_rule_year ON calendar_events(rule_id,year) WHERE rule_id IS NOT NULL;

-- Built-in categories are data, not country-specific behavior. Separate statements stay below Durable Object
-- SQLite's deliberately small compound-SELECT limit.
INSERT INTO calendar_categories SELECT 'category-no-class-'||id,id,'no-class','Día sin clase',1,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-holiday-'||id,id,'holiday','Asueto',1,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-academic-period-'||id,id,'academic-period','Periodo académico',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-admissions-'||id,id,'admissions','Admisiones',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-enrollment-'||id,id,'enrollment','Inscripciones',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-course-selection-'||id,id,'course-selection','Asignación de cursos',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-exams-'||id,id,'exams','Exámenes',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-make-up-'||id,id,'make-up','Recuperación',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-extracurricular-'||id,id,'extracurricular','Actividad extracurricular',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-performance-'||id,id,'performance','Competencia o presentación',0,1 FROM organizations;
INSERT INTO calendar_categories SELECT 'category-institutional-'||id,id,'institutional','Institucional',0,1 FROM organizations;

-- Calendars required by legacy organization and section breaks.
INSERT INTO calendars(id,organization_id,scope,scope_id,name,created_at,updated_at)
SELECT 'calendar-organization-'||organization_id,organization_id,'organization',NULL,'Calendario institucional',
       min(created_at),min(created_at)
FROM calendar_breaks WHERE group_id IS NULL GROUP BY organization_id;
INSERT INTO calendars(id,organization_id,scope,scope_id,name,created_at,updated_at)
SELECT 'calendar-section-'||b.group_id,b.organization_id,'section',b.group_id,'Calendario de '||g.name,
       min(b.created_at),min(b.created_at)
FROM calendar_breaks b JOIN course_groups g ON g.id=b.group_id
WHERE b.group_id IS NOT NULL GROUP BY b.organization_id,b.group_id;

INSERT INTO calendar_events(id,calendar_id,organization_id,category_id,title,starts_on,ends_on,part,no_class,rule_id,year,status,created_by,created_at,updated_at)
SELECT 'event-'||b.id,
       CASE WHEN b.group_id IS NULL THEN 'calendar-organization-'||b.organization_id ELSE 'calendar-section-'||b.group_id END,
       b.organization_id,'category-no-class-'||b.organization_id,b.title,b.starts_on,b.ends_on,'full',1,NULL,NULL,'active',
       b.created_by,b.created_at,b.created_at
FROM calendar_breaks b;

-- A program may have its own current cycle alongside the organization's current cycle.
ALTER TABLE academic_years ADD COLUMN program_id TEXT REFERENCES study_programs(id);
DROP INDEX academic_years_one_current;
CREATE UNIQUE INDEX academic_years_one_current ON academic_years(organization_id,COALESCE(program_id,'')) WHERE status='current';
CREATE TRIGGER academic_years_program_insert BEFORE INSERT ON academic_years
WHEN NEW.program_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM study_programs p WHERE p.id=NEW.program_id AND p.organization_id=NEW.organization_id
)
BEGIN SELECT RAISE(ABORT,'academic year program outside organization'); END;
CREATE TRIGGER academic_years_program_update BEFORE UPDATE OF program_id,organization_id ON academic_years
WHEN NEW.program_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM study_programs p WHERE p.id=NEW.program_id AND p.organization_id=NEW.organization_id
)
BEGIN SELECT RAISE(ABORT,'academic year program outside organization'); END;

-- A section can follow one period; the API verifies that it belongs to the current organization or program cycle.
ALTER TABLE course_groups ADD COLUMN schedule_period_id TEXT REFERENCES academic_periods(id);

CREATE TRIGGER calendars_scope_insert BEFORE INSERT ON calendars
WHEN (NEW.scope='program' AND NOT EXISTS (
    SELECT 1 FROM study_programs p WHERE p.id=NEW.scope_id AND p.organization_id=NEW.organization_id
  )) OR (NEW.scope='section' AND NOT EXISTS (
    SELECT 1 FROM course_groups g WHERE g.id=NEW.scope_id AND g.organization_id=NEW.organization_id
  ))
BEGIN SELECT RAISE(ABORT,'calendar scope outside organization'); END;
CREATE TRIGGER calendars_scope_update BEFORE UPDATE OF scope,scope_id,organization_id ON calendars
WHEN (NEW.scope='program' AND NOT EXISTS (
    SELECT 1 FROM study_programs p WHERE p.id=NEW.scope_id AND p.organization_id=NEW.organization_id
  )) OR (NEW.scope='section' AND NOT EXISTS (
    SELECT 1 FROM course_groups g WHERE g.id=NEW.scope_id AND g.organization_id=NEW.organization_id
  ))
BEGIN SELECT RAISE(ABORT,'calendar scope outside organization'); END;
