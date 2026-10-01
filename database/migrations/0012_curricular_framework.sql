-- Curricular framework: what a course develops (competencies), what learners can show at the end
-- (learning outcomes) and which units plan each outcome. Lessons and activities name the outcomes they
-- work on inside their versioned content, so drafts and publication work as before. Nothing existing changes.
CREATE TABLE course_competencies (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK(position>=0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  UNIQUE(id,course_id)
);
CREATE TABLE course_outcomes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  competency_id TEXT,
  statement TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('remember','understand','apply','analyze','evaluate','create')),
  evidence TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK(position>=0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(course_id,organization_id) REFERENCES courses(id,organization_id),
  FOREIGN KEY(competency_id,course_id) REFERENCES course_competencies(id,course_id),
  UNIQUE(id,course_id)
);
-- A unit plans an outcome only within its own course.
CREATE TABLE unit_outcomes (
  unit_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  PRIMARY KEY(unit_id,outcome_id),
  FOREIGN KEY(unit_id,course_id) REFERENCES learning_units(id,course_id),
  FOREIGN KEY(outcome_id,course_id) REFERENCES course_outcomes(id,course_id)
);
CREATE INDEX course_competencies_course ON course_competencies(course_id,position);
CREATE INDEX course_outcomes_course ON course_outcomes(course_id,position);
CREATE INDEX unit_outcomes_outcome ON unit_outcomes(outcome_id);

-- Curated example for the demo course, so its plan shows coverage and gaps. Lessons are not modified:
-- aligning them is left to educators, which is exactly what the plan's gaps invite.
INSERT INTO course_competencies(id,course_id,organization_id,name,description,position,updated_at)
SELECT 'competency-exploradores-oral',id,organization_id,'Comunicación oral en inglés','Comprende y usa expresiones cotidianas sencillas para interactuar.',0,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM courses WHERE id='course-exploradores'
UNION ALL
SELECT 'competency-exploradores-vocabulary',id,organization_id,'Vocabulario del entorno','Nombra en inglés objetos y características de su entorno cercano.',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM courses WHERE id='course-exploradores';
INSERT INTO course_outcomes(id,course_id,organization_id,competency_id,statement,level,evidence,position,updated_at)
SELECT 'outcome-exploradores-introduce',id,organization_id,'competency-exploradores-oral','Saluda y se presenta con frases sencillas en inglés.','apply','Se presenta ante un compañero diciendo su nombre y respondiendo a un saludo.',0,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM courses WHERE id='course-exploradores'
UNION ALL
SELECT 'outcome-exploradores-understand',id,organization_id,'competency-exploradores-oral','Comprende saludos y preguntas básicas al escucharlos.','understand','Responde con gestos o palabras a «Hello! What''s your name?».',1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM courses WHERE id='course-exploradores'
UNION ALL
SELECT 'outcome-exploradores-colors',id,organization_id,'competency-exploradores-vocabulary','Nombra en inglés los colores básicos de objetos del aula.','remember','Señala y nombra el color de tres objetos del aula.',2,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM courses WHERE id='course-exploradores';
INSERT INTO unit_outcomes(unit_id,outcome_id,course_id)
SELECT u.id,o.id,u.course_id FROM learning_units u JOIN course_outcomes o ON o.course_id=u.course_id
WHERE u.id='course-exploradores--unit-org-demo' AND o.id IN ('outcome-exploradores-introduce','outcome-exploradores-understand');
