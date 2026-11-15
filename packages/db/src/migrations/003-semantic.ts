/** Additive current-state semantic graph; structural contracts stay unchanged. */
export const semanticSchema = `
CREATE TABLE semantic_entities (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('feature', 'route', 'page', 'component', 'endpoint', 'service_operation', 'data_model', 'external_dependency')),
  name TEXT NOT NULL CHECK (length(name) > 0),
  attributes TEXT NOT NULL CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),
  provenance TEXT NOT NULL CHECK (
    CASE WHEN json_valid(provenance) THEN
      json_extract(provenance, '$.kind') IN ('deterministic', 'heuristic', 'ai')
      AND length(json_extract(provenance, '$.extractor')) > 0
      AND length(json_extract(provenance, '$.version')) > 0
      AND length(json_extract(provenance, '$.rule')) > 0
      AND json_type(provenance, '$.confidence') IN ('integer', 'real')
      AND json_extract(provenance, '$.confidence') BETWEEN 0 AND 1
      AND json_type(provenance, '$.kind') IS NOT NULL
      AND json_type(provenance, '$.extractor') IS NOT NULL
      AND json_type(provenance, '$.version') IS NOT NULL
      AND json_type(provenance, '$.rule') IS NOT NULL
      AND json_type(provenance, '$.confidence') IS NOT NULL
    ELSE 0 END
  ),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, revision) REFERENCES revisions(project_id, revision)
) STRICT;
CREATE INDEX semantic_entities_by_kind ON semantic_entities(project_id, kind, name);

CREATE TABLE semantic_relationships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) > 0),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('RENDERS', 'HANDLES', 'CALLS', 'READS', 'WRITES', 'IMPLEMENTS', 'DEPENDS_ON')),
  provenance TEXT NOT NULL CHECK (
    CASE WHEN json_valid(provenance) THEN
      json_extract(provenance, '$.kind') IN ('deterministic', 'heuristic', 'ai')
      AND length(json_extract(provenance, '$.extractor')) > 0
      AND length(json_extract(provenance, '$.version')) > 0
      AND length(json_extract(provenance, '$.rule')) > 0
      AND json_type(provenance, '$.confidence') IN ('integer', 'real')
      AND json_extract(provenance, '$.confidence') BETWEEN 0 AND 1
      AND json_type(provenance, '$.kind') IS NOT NULL
      AND json_type(provenance, '$.extractor') IS NOT NULL
      AND json_type(provenance, '$.version') IS NOT NULL
      AND json_type(provenance, '$.rule') IS NOT NULL
      AND json_type(provenance, '$.confidence') IS NOT NULL
    ELSE 0 END
  ),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES semantic_entities(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_id) REFERENCES semantic_entities(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, revision) REFERENCES revisions(project_id, revision)
) STRICT;
CREATE INDEX semantic_relationships_by_source ON semantic_relationships(project_id, source_id, kind);
CREATE INDEX semantic_relationships_by_target ON semantic_relationships(project_id, target_id, kind);

CREATE TABLE semantic_sources (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id TEXT,
  relationship_id TEXT,
  node_id TEXT NOT NULL,
  path TEXT NOT NULL CHECK (length(path) > 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  start_line INTEGER NOT NULL CHECK (start_line >= 1),
  end_line INTEGER NOT NULL CHECK (end_line >= start_line),
  start_column INTEGER NOT NULL CHECK (start_column >= 1),
  end_column INTEGER NOT NULL CHECK (end_column >= 1),
  CHECK ((entity_id IS NULL) <> (relationship_id IS NULL)),
  CHECK (end_line > start_line OR end_column >= start_column),
  FOREIGN KEY (project_id, entity_id) REFERENCES semantic_entities(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, relationship_id) REFERENCES semantic_relationships(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, node_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX semantic_sources_by_entity ON semantic_sources(project_id, entity_id);
CREATE INDEX semantic_sources_by_relationship ON semantic_sources(project_id, relationship_id);
CREATE INDEX semantic_sources_by_node ON semantic_sources(project_id, node_id);
`;
