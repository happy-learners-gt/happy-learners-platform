-- ST-152 (DEC-043): effective hours teaching classes. The hours of a class come from the timestamps it already has
-- (class_sessions.started_at and completed_at, ST-036/ST-109) and go to the person who started it (taught_by); no
-- column is added and nothing is backfilled: classes completed before this release keep what they recorded, and
-- those without a real start (0018 set started_at=completed_at for them) count 0 and show «Sin registro de inicio».
--
-- Administration corrects the minutes or the attribution of a completed class with a mandatory reason. Each
-- correction is one row that keeps the value before and after it; the latest one is in force. The activity records
-- it too (action 'updated', target 'session'), so activity_events is not rebuilt. Backups copy this table.
CREATE TABLE class_hour_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  minutes_before INTEGER NOT NULL CHECK(minutes_before >= 0),
  minutes_after INTEGER NOT NULL CHECK(minutes_after BETWEEN 0 AND 720),
  educator_before TEXT REFERENCES users(id),
  educator_after TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 300),
  adjusted_by TEXT NOT NULL REFERENCES users(id),
  adjusted_at TEXT NOT NULL
);
CREATE INDEX class_hour_adjustments_session ON class_hour_adjustments(session_id, adjusted_at DESC);
