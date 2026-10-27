-- The organization's school year (ciclo lectivo) and its periods (bimestres, trimestres, semestres or unidades).
-- Administration prepares a year as a draft, makes it the current one and closes it: draft → current → closed, at most
-- one current year per organization, and a closed year never changes. A section's schedule keeps its own from/until
-- (it only takes the current year's dates as a suggestion) and days without class stay in calendar_breaks (DEC-026).
-- Additive: no existing table changes. The domain validates a whole year; these constraints guard what it promises.

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 80),
  starts_on TEXT NOT NULL CHECK(date(starts_on) = starts_on),
  ends_on TEXT NOT NULL CHECK(date(ends_on) = ends_on),
  period_kind TEXT NOT NULL CHECK(period_kind IN ('bimester','trimester','semester','unit')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','current','closed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  closed_at TEXT,
  CHECK(ends_on > starts_on),
  CHECK(status = 'draft' OR activated_at IS NOT NULL),
  CHECK(status <> 'closed' OR closed_at IS NOT NULL),
  UNIQUE(organization_id, name)
);
-- At most one current year per organization.
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current ON academic_years(organization_id) WHERE status = 'current';

CREATE TABLE IF NOT EXISTS academic_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  year_id TEXT NOT NULL REFERENCES academic_years(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 12),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  starts_on TEXT NOT NULL CHECK(date(starts_on) = starts_on),
  ends_on TEXT NOT NULL CHECK(date(ends_on) = ends_on),
  CHECK(ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS academic_periods_by_year ON academic_periods(year_id, starts_on);

-- Only the forward transitions; a closed year is read-only and only a draft is ever deleted.
CREATE TRIGGER IF NOT EXISTS academic_years_transition BEFORE UPDATE OF status ON academic_years
WHEN NOT (NEW.status = OLD.status OR (OLD.status = 'draft' AND NEW.status = 'current') OR (OLD.status = 'current' AND NEW.status = 'closed'))
BEGIN SELECT RAISE(ABORT, 'academic year transition not allowed'); END;
CREATE TRIGGER IF NOT EXISTS academic_years_closed_read_only BEFORE UPDATE ON academic_years
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, 'a closed academic year is read-only'); END;
CREATE TRIGGER IF NOT EXISTS academic_years_delete_draft BEFORE DELETE ON academic_years
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'only a draft academic year is deleted'); END;

-- A period belongs to a year of its organization, lies within it and is never written once the year is closed.
CREATE TRIGGER IF NOT EXISTS academic_periods_insert BEFORE INSERT ON academic_periods
WHEN NOT EXISTS (SELECT 1 FROM academic_years y WHERE y.id = NEW.year_id AND y.organization_id = NEW.organization_id AND y.status <> 'closed' AND NEW.starts_on >= y.starts_on AND NEW.ends_on <= y.ends_on)
BEGIN SELECT RAISE(ABORT, 'period outside its open academic year'); END;
CREATE TRIGGER IF NOT EXISTS academic_periods_update BEFORE UPDATE ON academic_periods
WHEN NEW.year_id <> OLD.year_id OR NEW.organization_id <> OLD.organization_id
  OR NOT EXISTS (SELECT 1 FROM academic_years y WHERE y.id = NEW.year_id AND y.status <> 'closed' AND NEW.starts_on >= y.starts_on AND NEW.ends_on <= y.ends_on)
BEGIN SELECT RAISE(ABORT, 'period outside its open academic year'); END;
CREATE TRIGGER IF NOT EXISTS academic_periods_delete BEFORE DELETE ON academic_periods
WHEN EXISTS (SELECT 1 FROM academic_years y WHERE y.id = OLD.year_id AND y.status = 'closed')
BEGIN SELECT RAISE(ABORT, 'a closed academic year is read-only'); END;
