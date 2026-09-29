CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  level TEXT NOT NULL,
  skill TEXT NOT NULL CHECK(skill IN ('lectura','escritura','escucha','conversación')),
  topic TEXT NOT NULL,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published'))
);
CREATE TABLE IF NOT EXISTS lesson_completions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  completed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS resources_organization ON resources(organization_id);
CREATE INDEX IF NOT EXISTS completions_lesson ON lesson_completions(lesson_id);
INSERT OR IGNORE INTO resources
SELECT 'resource-colors','org-demo','Colors around us','Palabras y una actividad breve para identificar colores.','Inicial','lectura','Colores','["vocabulario","familia"]','Red, blue, yellow and green. Find three objects and say their color.','published'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id='org-demo');
INSERT OR IGNORE INTO resources
SELECT 'resource-greetings','org-demo','Greetings song','Rutina sencilla para comenzar la clase.','Inicial','conversación','Saludos','["rutina","oral"]','Hello! How are you? I am fine, thank you. Practice with a partner.','published'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id='org-demo');
