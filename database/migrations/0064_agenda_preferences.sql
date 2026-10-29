-- The agenda remembers the view and the filters on the person's own preferences (1.3.4).
-- A null view follows the screen (day on a phone, week on a desk). The show list is the kinds left visible.
ALTER TABLE user_preferences ADD COLUMN agenda_view TEXT CHECK(agenda_view IS NULL OR agenda_view IN ('day','week','month','year'));
ALTER TABLE user_preferences ADD COLUMN agenda_show TEXT NOT NULL DEFAULT 'class,no-class,event,due' CHECK(length(agenda_show) <= 40 AND agenda_show NOT GLOB '*[^a-z,-]*');
