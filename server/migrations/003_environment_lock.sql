-- Records which environment (staging or production) a database belongs to.
-- A deployed server claims an unmarked database on start-up and refuses to run
-- on a database marked for a different environment (see server/src/envlock.js).

CREATE TABLE app_environment (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), -- at most one row
  env        TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
