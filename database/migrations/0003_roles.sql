-- Preserve existing memberships and sessions. Legacy instructor becomes educator in the API.
ALTER TABLE memberships ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE TABLE role_events (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, occurred_at TEXT NOT NULL);
INSERT INTO users SELECT 'user-educator','educador-demo',password_salt,password_hash FROM users WHERE username='instructor-demo';
INSERT INTO memberships(user_id,organization_id,role) SELECT 'user-educator','org-demo','instructor' WHERE EXISTS(SELECT 1 FROM users WHERE id='user-educator');
