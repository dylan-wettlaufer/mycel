export const sourceContentSchema = `
CREATE TABLE snapshot_contents (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  digest BLOB NOT NULL CHECK(length(digest) = 32),
  content TEXT NOT NULL,
  PRIMARY KEY(project_id, digest)
) STRICT, WITHOUT ROWID;
CREATE TABLE snapshot_versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  revision INTEGER NOT NULL,
  digest BLOB NOT NULL,
  PRIMARY KEY(project_id, path, revision),
  FOREIGN KEY(project_id, revision) REFERENCES revisions(project_id, revision),
  FOREIGN KEY(project_id, digest) REFERENCES snapshot_contents(project_id, digest)
) STRICT, WITHOUT ROWID;
CREATE INDEX snapshot_versions_by_digest ON snapshot_versions(project_id, digest);

INSERT INTO snapshot_contents(project_id, digest, content)
  SELECT project_id, mycel_source_digest(content), content FROM snapshots WHERE true
  ON CONFLICT(project_id, digest) DO NOTHING;
INSERT INTO snapshot_versions(project_id, path, revision, digest)
  SELECT project_id, path, revision, mycel_source_digest(content) FROM snapshots;
DROP TABLE snapshots;
CREATE VIEW snapshots AS
  SELECT v.project_id, v.path, v.revision, c.content
  FROM snapshot_versions v JOIN snapshot_contents c USING(project_id, digest);
`;
