export const historySchema = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  starting_revision INTEGER NOT NULL CHECK(starting_revision >= 0)
) STRICT;
CREATE INDEX sessions_by_project ON sessions(project_id);
CREATE TABLE snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(project_id, path, revision),
  FOREIGN KEY(project_id, revision) REFERENCES revisions(project_id, revision)
) STRICT;
CREATE TABLE change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('node', 'edge')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'modified', 'deleted')),
  path TEXT NOT NULL,
  before_revision INTEGER,
  after_revision INTEGER,
  before_entity TEXT CHECK(before_entity IS NULL OR json_valid(before_entity)),
  after_entity TEXT CHECK(after_entity IS NULL OR json_valid(after_entity)),
  session_id TEXT REFERENCES sessions(id),
  attribution TEXT CHECK(attribution IS NULL OR json_valid(attribution)),
  FOREIGN KEY(project_id, before_revision) REFERENCES revisions(project_id, revision),
  FOREIGN KEY(project_id, after_revision) REFERENCES revisions(project_id, revision),
  CHECK((action = 'created' AND before_revision IS NULL AND after_revision IS NOT NULL)
    OR (action = 'deleted' AND before_revision IS NOT NULL AND after_revision IS NULL)
    OR (action = 'modified' AND before_revision IS NOT NULL AND after_revision > before_revision))
) STRICT;
CREATE INDEX events_by_project ON change_events(project_id, id);
`;
