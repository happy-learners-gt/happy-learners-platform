-- Accounts for the organizations without a seeded team (DEC-032). Each statement only applies in its own store.
-- Happy Learners starts empty, with one administrator and two educators; their passwords are issued privately and
-- only their hashes live here. The fictional external organization gets an administrator with the demo password.
UPDATE organizations SET name='Happy Learners',timezone='America/Guatemala',configured=1 WHERE id='org-hl' AND name IS NULL;
INSERT INTO users(id,username,password_salt,password_hash,display_name) SELECT 'hl-user-admin','admin-hl','hl-org-hl-20261006-ca5a7e9f54029414','e0146e30769e573822fe04b125f0a35d4bade14e02e7ff3975f8b89f5719ef46','Administración Happy Learners' WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO memberships(user_id,organization_id,role,active) SELECT 'hl-user-admin','org-hl','admin',1 WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO users(id,username,password_salt,password_hash,display_name) SELECT 'hl-user-docente-1','docente1-hl','hl-org-hl-20261006-e1b5871b3806511e','2d02659e7b9f2ec8a8f76e2b2a83d40e4e3b205a0b53f670ed44240ad822cf0f','Docente 1' WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO memberships(user_id,organization_id,role,active) SELECT 'hl-user-docente-1','org-hl','instructor',1 WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO users(id,username,password_salt,password_hash,display_name) SELECT 'hl-user-docente-2','docente2-hl','hl-org-hl-20261006-c81a8bbb84ba36cc','9b5ab16865a8065089aee34a9bbc6f8dd8ad7f22d9c68d0a8e0f10c330814506','Docente 2' WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO memberships(user_id,organization_id,role,active) SELECT 'hl-user-docente-2','org-hl','instructor',1 WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-hl');
INSERT INTO users(id,username,password_salt,password_hash,display_name) SELECT 'other-user-admin','admin-externo','hl-org-other-20261006-9389fafbb9643894','07b528b7166a3641627dde415c307a2bc29f2bae89494177788421615c55f76f','Administración externa' WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-other');
INSERT INTO memberships(user_id,organization_id,role,active) SELECT 'other-user-admin','org-other','admin',1 WHERE EXISTS(SELECT 1 FROM organizations WHERE id='org-other');
