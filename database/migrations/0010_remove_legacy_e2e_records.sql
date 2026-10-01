-- Removes the records an early E2E run left in the shared demo before tests were isolated (removal
-- authorised by the product owner on 2026-10-01; read-only backup kept with the v0.2.5 release evidence).
-- Only names ending in " desktop-<13-digit timestamp>" or " mobile-<13-digit timestamp>" match.
-- Durable Object SQLite caps LIKE/GLOB patterns at 50 bytes, so the suffix is checked with substr().
-- Each statement keeps a row that something else still references, so no human content can be lost.
DELETE FROM lesson_completions WHERE lesson_id IN (SELECT id FROM lessons WHERE ((substr(json_extract(content,'$.title'),-22,9)=' desktop-' OR substr(json_extract(content,'$.title'),-21,8)=' mobile-') AND substr(json_extract(content,'$.title'),-13) NOT GLOB '*[^0-9]*'));
UPDATE class_sessions SET lesson_id=NULL WHERE lesson_id IN (SELECT id FROM lessons WHERE ((substr(json_extract(content,'$.title'),-22,9)=' desktop-' OR substr(json_extract(content,'$.title'),-21,8)=' mobile-') AND substr(json_extract(content,'$.title'),-13) NOT GLOB '*[^0-9]*'));
DELETE FROM lessons WHERE ((substr(json_extract(content,'$.title'),-22,9)=' desktop-' OR substr(json_extract(content,'$.title'),-21,8)=' mobile-') AND substr(json_extract(content,'$.title'),-13) NOT GLOB '*[^0-9]*');
DELETE FROM learning_units WHERE ((substr(name,-22,9)=' desktop-' OR substr(name,-21,8)=' mobile-') AND substr(name,-13) NOT GLOB '*[^0-9]*')
  AND NOT EXISTS(SELECT 1 FROM lessons l WHERE l.course_unit_id=learning_units.id);
DELETE FROM units WHERE ((substr(name,-22,9)=' desktop-' OR substr(name,-21,8)=' mobile-') AND substr(name,-13) NOT GLOB '*[^0-9]*')
  AND NOT EXISTS(SELECT 1 FROM lessons l WHERE l.unit_id=units.id) AND NOT EXISTS(SELECT 1 FROM learning_units u WHERE u.legacy_unit_id=units.id);
DELETE FROM levels WHERE ((substr(name,-22,9)=' desktop-' OR substr(name,-21,8)=' mobile-') AND substr(name,-13) NOT GLOB '*[^0-9]*')
  AND NOT EXISTS(SELECT 1 FROM units u WHERE u.level_id=levels.id);
DELETE FROM resources WHERE ((substr(title,-22,9)=' desktop-' OR substr(title,-21,8)=' mobile-') AND substr(title,-13) NOT GLOB '*[^0-9]*')
  AND NOT EXISTS(SELECT 1 FROM lessons l WHERE instr(l.content,'"'||resources.id||'"')>0 OR instr(COALESCE(l.published_content,''),'"'||resources.id||'"')>0);
-- Close the gaps left in the ordering.
UPDATE learning_units SET position=(SELECT count(*) FROM learning_units o WHERE o.course_id=learning_units.course_id AND (o.position<learning_units.position OR (o.position=learning_units.position AND o.id<learning_units.id)));
UPDATE levels SET position=(SELECT count(*) FROM levels o WHERE o.organization_id=levels.organization_id AND (o.position<levels.position OR (o.position=levels.position AND o.id<levels.id)));
