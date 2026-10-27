-- Curriculum packages. The packages themselves (an official reference such as the CNB Guatemala dosificación of an
-- area and grade) are versioned data in the repository, not rows: each organization only records which ones its
-- administration activated, and each course records which competencies and indicators its lead took from a package
-- into its own curriculum plan (course_competencies, course_outcomes). A code is linked once per course and package,
-- so taking it again never duplicates it. Additive: no existing table changes.

CREATE TABLE IF NOT EXISTS curriculum_package_activations (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  package_id TEXT NOT NULL CHECK(length(package_id) BETWEEN 3 AND 80),
  version TEXT NOT NULL,
  activated_by TEXT NOT NULL REFERENCES users(id),
  activated_at TEXT NOT NULL,
  PRIMARY KEY(organization_id, package_id)
);

CREATE TABLE IF NOT EXISTS course_package_links (
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('competency','indicator')),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 20),
  competency_id TEXT,
  outcome_id TEXT,
  linked_by TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL,
  PRIMARY KEY(course_id, package_id, kind, code),
  FOREIGN KEY(course_id, organization_id) REFERENCES courses(id, organization_id),
  FOREIGN KEY(competency_id, course_id) REFERENCES course_competencies(id, course_id),
  FOREIGN KEY(outcome_id, course_id) REFERENCES course_outcomes(id, course_id),
  CHECK((kind = 'competency' AND competency_id IS NOT NULL AND outcome_id IS NULL) OR (kind = 'indicator' AND outcome_id IS NOT NULL AND competency_id IS NULL))
);
-- One plan item is linked to at most one package code.
CREATE UNIQUE INDEX IF NOT EXISTS course_package_links_competency ON course_package_links(competency_id) WHERE competency_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS course_package_links_outcome ON course_package_links(outcome_id) WHERE outcome_id IS NOT NULL;
