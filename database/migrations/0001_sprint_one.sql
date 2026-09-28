-- Sprint 1: synthetic workspace only. No child profiles or contact information.
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, timezone TEXT NOT NULL DEFAULT 'America/Guatemala', configured INTEGER NOT NULL DEFAULT 0 CHECK(configured IN (0,1)));
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE memberships (user_id TEXT PRIMARY KEY REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id), role TEXT NOT NULL CHECK(role IN ('admin','instructor')));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE programs (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), title TEXT NOT NULL);
CREATE TABLE lessons (id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES programs(id), status TEXT NOT NULL CHECK(status IN ('draft','published')), content TEXT NOT NULL CHECK(json_valid(content)));
CREATE INDEX programs_organization ON programs(organization_id);
INSERT INTO organizations(id,name,configured) VALUES ('org-demo',NULL,0),('org-other','Organización externa ficticia',1);
INSERT INTO users VALUES ('user-0','admin-demo','hl-synthetic-demo-20260928-0','f8e4bcb56b7a7b1ce19efb78a12b8b61ef7749cc9b7160ba1b7b7260597adf89');
INSERT INTO memberships VALUES ('user-0','org-demo','admin');
INSERT INTO users VALUES ('user-1','instructor-demo','hl-synthetic-demo-20260928-1','a36d010924d3b152bf694a1312a82754fc7860d90b53690017f5dda3b7a935d8');
INSERT INTO memberships VALUES ('user-1','org-demo','instructor');
INSERT INTO users VALUES ('user-2','externo-demo','hl-synthetic-demo-20260928-2','cc8aaee9ecdde08fbc80f5a04761c5b1d3ab05477b17975f687290ac0301e1be');
INSERT INTO memberships VALUES ('user-2','org-other','instructor');
INSERT INTO programs VALUES ('exploradores','org-demo','Exploradores');
INSERT INTO lessons VALUES ('colores-en-equipo','exploradores','published','{"id": "colores-en-equipo", "title": "Un mundo de colores", "program": "Exploradores · Unidad 1", "duration": 30, "objective": "Reconocer colores del entorno en inglés (red, blue, yellow y green) y practicar la colaboración mediante una composición colectiva.", "materials": ["Hojas de papel reutilizado", "Lápices o crayones de colores", "Tres objetos seguros de colores distintos"], "activities": [{"title": "Miramos a nuestro alrededor", "minutes": 5, "instructions": "Muestra tres objetos. Nombra sus colores en inglés: red, blue, yellow y green. Invita al grupo a repetirlos y a encontrar otro objeto del mismo color. Acepta respuestas verbales, señalamientos o gestos."}, {"title": "Creamos juntos", "minutes": 15, "instructions": "Organiza pequeños equipos. Cada equipo combina colores en una hoja para crear un paisaje imaginario. Modela las frases «I see red» y «I see blue» y permite elegir una para describir el dibujo. Ofrece turnos para elegir materiales y anima a compartirlos. Describe las acciones sin comparar a las personas."}, {"title": "Compartimos lo que descubrimos", "minutes": 10, "instructions": "Invita a mostrar las creaciones voluntariamente. Invita a nombrar en inglés un color elegido y pregunta cómo se ayudaron. Cierra reconociendo el trabajo compartido, sin guardar nombres, fotos ni evaluaciones individuales."}], "reflection": "¿Qué adaptación ayudó a que todos participaran? Usa esta pregunta para tu preparación; la plataforma no registra respuestas individuales.", "publishedAt": "2026-09-28"}');
