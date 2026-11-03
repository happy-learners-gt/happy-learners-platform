-- How much of each AI answer was used (AIG-4, docs/transformacion/ia.md). When the person decides on what the AI
-- proposed, the run keeps how many items it proposed and how many were used, once, and when. Never which ones nor
-- their text. Runs nobody decided on keep both empty.

ALTER TABLE ai_runs ADD COLUMN proposed_items INTEGER CHECK(proposed_items IS NULL OR proposed_items BETWEEN 1 AND 100);
ALTER TABLE ai_runs ADD COLUMN accepted_items INTEGER CHECK(accepted_items IS NULL OR (accepted_items >= 0 AND accepted_items <= proposed_items));
ALTER TABLE ai_runs ADD COLUMN decided_at TEXT;
