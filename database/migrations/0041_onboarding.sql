-- ST-122: guided onboarding on the first sign-in. One row per account of the organization.
-- Only what the person declares is stored here: when they read the welcome (what their role can do), when they chose to
-- sign the volunteer agreement later (only while it is optional for them) and when they finished the introduction to
-- their courses and sections. The other steps (own password, terms and privacy, profile, volunteer agreement) are
-- derived from the real data every time and are never written here, so they cannot be declared without doing them.
-- completed_at is written once, when every required step is done; it is never cleared afterwards.
CREATE TABLE onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  started_at TEXT NOT NULL,
  welcome_at TEXT CHECK(welcome_at IS NULL OR welcome_at >= started_at),
  agreement_skipped_at TEXT CHECK(agreement_skipped_at IS NULL OR agreement_skipped_at >= started_at),
  tour_at TEXT CHECK(tour_at IS NULL OR tour_at >= started_at),
  completed_at TEXT CHECK(completed_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX onboarding_organization ON onboarding(organization_id, completed_at);

-- Accounts that existed before this release already work in the platform: they count as onboarded from now on and are
-- never sent to the welcome. New accounts (POST /api/members, an accepted invitation) start with completed_at NULL.
INSERT INTO onboarding(user_id, organization_id, started_at, completed_at)
  SELECT m.user_id, m.organization_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM memberships m;
