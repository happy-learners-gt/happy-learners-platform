-- Attendance counted where it is read (1.5.7, docs/operations/slo.md §4). Listing sections and the home page counted
-- every attendance mark of every class on each request, the largest share of the rows read against the free plan's
-- daily quota. Each class keeps how many marks it has and how many are present or late; triggers keep both exact on
-- every insert, change and removal of a mark, whatever writes it.

ALTER TABLE class_sessions ADD COLUMN marked_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE class_sessions ADD COLUMN attended_count INTEGER NOT NULL DEFAULT 0;
UPDATE class_sessions SET
  marked_count = (SELECT count(*) FROM attendance_marks m WHERE m.session_id = class_sessions.id),
  attended_count = (SELECT count(*) FROM attendance_marks m WHERE m.session_id = class_sessions.id AND m.status IN ('present','late'));

CREATE TRIGGER attendance_marks_count_insert AFTER INSERT ON attendance_marks BEGIN
  UPDATE class_sessions SET marked_count = marked_count + 1, attended_count = attended_count + (NEW.status IN ('present','late')) WHERE id = NEW.session_id;
END;
CREATE TRIGGER attendance_marks_count_delete AFTER DELETE ON attendance_marks BEGIN
  UPDATE class_sessions SET marked_count = marked_count - 1, attended_count = attended_count - (OLD.status IN ('present','late')) WHERE id = OLD.session_id;
END;
CREATE TRIGGER attendance_marks_count_update AFTER UPDATE OF session_id, status ON attendance_marks BEGIN
  UPDATE class_sessions SET marked_count = marked_count - 1, attended_count = attended_count - (OLD.status IN ('present','late')) WHERE id = OLD.session_id;
  UPDATE class_sessions SET marked_count = marked_count + 1, attended_count = attended_count + (NEW.status IN ('present','late')) WHERE id = NEW.session_id;
END;
