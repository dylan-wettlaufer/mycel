/** Applied migrations are immutable; extend the schema with a new migration. */
export const initialSchema = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  name TEXT NOT NULL CHECK (length(name) > 0),
  root TEXT NOT NULL UNIQUE CHECK (length(root) > 0),
  indexing_settings TEXT NOT NULL CHECK (
    CASE WHEN json_valid(indexing_settings) THEN
      json_type(indexing_settings) IS 'object'
      AND json_type(indexing_settings, '$.extensions') IS 'array'
      AND json_type(indexing_settings, '$.exclude') IS 'array'
      AND json_type(indexing_settings, '$.respectGitignore') IN ('true', 'false')
      AND json_type(indexing_settings, '$.respectGitignore') IS NOT NULL
    ELSE 0 END
  )
) STRICT;

CREATE TABLE revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, revision)
) STRICT;

CREATE TRIGGER revisions_increasing BEFORE INSERT ON revisions
WHEN NEW.revision <= COALESCE(
  (SELECT MAX(revision) FROM revisions WHERE project_id = NEW.project_id), -1
)
BEGIN
  SELECT RAISE(ABORT, 'Project revisions must increase monotonically');
END;

CREATE TRIGGER revisions_immutable BEFORE UPDATE ON revisions
BEGIN
  SELECT RAISE(ABORT, 'Revision records cannot be updated');
END;

CREATE TRIGGER revisions_no_delete BEFORE DELETE ON revisions
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'Revision records can only be deleted with their project');
END;

CREATE TABLE nodes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'function', 'class', 'method')),
  name TEXT NOT NULL CHECK (length(name) > 0),
  qualified_name TEXT NOT NULL CHECK (length(qualified_name) > 0),
  path TEXT NOT NULL CHECK (length(path) > 0),
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, revision) REFERENCES revisions(project_id, revision),
  CHECK (start_offset >= 0 AND end_offset BETWEEN start_offset AND 9007199254740991),
  CHECK (start_line >= 1 AND end_line BETWEEN start_line AND 9007199254740991),
  CHECK (start_column BETWEEN 1 AND 9007199254740991),
  CHECK (end_column BETWEEN 1 AND 9007199254740991),
  CHECK (end_line > start_line OR end_column >= start_column)
) STRICT;

CREATE INDEX nodes_by_path ON nodes(project_id, path);
CREATE INDEX nodes_by_qualified_name ON nodes(project_id, qualified_name);
CREATE INDEX nodes_by_name ON nodes(project_id, name COLLATE NOCASE);
CREATE INDEX nodes_by_revision ON nodes(project_id, revision);

CREATE TABLE edges (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) > 0),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CONTAINS', 'IMPORTS', 'CALLS')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, revision) REFERENCES revisions(project_id, revision)
) STRICT;

CREATE INDEX edges_by_source ON edges(project_id, source_id, kind);
CREATE INDEX edges_by_target ON edges(project_id, target_id, kind);
CREATE INDEX edges_by_revision ON edges(project_id, revision);

CREATE TABLE diagnostics (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (length(path) > 0),
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning')),
  source TEXT NOT NULL CHECK (source IN ('parser', 'resolver')),
  code TEXT NOT NULL CHECK (length(code) > 0),
  message TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  FOREIGN KEY (project_id, revision) REFERENCES revisions(project_id, revision),
  CHECK (start_offset >= 0 AND end_offset BETWEEN start_offset AND 9007199254740991),
  CHECK (start_line >= 1 AND end_line BETWEEN start_line AND 9007199254740991),
  CHECK (start_column BETWEEN 1 AND 9007199254740991),
  CHECK (end_column BETWEEN 1 AND 9007199254740991),
  CHECK (end_line > start_line OR end_column >= start_column)
) STRICT;

CREATE INDEX diagnostics_by_path ON diagnostics(project_id, path);
CREATE INDEX diagnostics_by_revision ON diagnostics(project_id, revision);
`;
