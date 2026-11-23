export const agentObservationSchema = `
ALTER TABLE change_events ADD COLUMN captured_at INTEGER;
CREATE INDEX captured_file_changes_by_path
  ON change_events(project_id, path, captured_at DESC, id DESC)
  WHERE captured_at IS NOT NULL;
ALTER TABLE agent_tool_events ADD COLUMN is_observation INTEGER NOT NULL DEFAULT 0
  CHECK(is_observation IN (0, 1));
ALTER TABLE agent_tool_events ADD COLUMN observed_hash TEXT;
`;
