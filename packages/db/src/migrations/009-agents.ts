export const agentSchema = `
CREATE TABLE agent_tool_events (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  tool TEXT NOT NULL CHECK(tool IN ('Edit', 'Write')),
  path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT NOT NULL CHECK(outcome IN ('started', 'succeeded', 'failed')),
  expected_hash TEXT,
  change_id INTEGER REFERENCES change_events(id) ON DELETE CASCADE,
  PRIMARY KEY(project_id, provider, session_id, tool_use_id)
) STRICT;
CREATE INDEX unassigned_agent_tools_by_path
  ON agent_tool_events(project_id, path, started_at)
  WHERE change_id IS NULL AND outcome <> 'failed';
CREATE INDEX agent_tools_by_change ON agent_tool_events(change_id);
`;
