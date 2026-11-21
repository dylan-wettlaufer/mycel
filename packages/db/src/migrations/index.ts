import { semanticSchema } from "./003-semantic.js";
import { historySchema } from "./002-history.js";
import { initialSchema } from "./001-initial.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  { version: 1, name: "initial graph schema", sql: initialSchema },
  {
    version: 2,
    name: "change history and monitoring sessions",
    sql: historySchema,
  },
  { version: 3, name: "semantic application graph", sql: semanticSchema },
  {
    version: 4,
    name: "structural edge source lines",
    sql: "ALTER TABLE edges ADD COLUMN source_lines TEXT;",
  },
  {
    version: 5,
    name: "type-only import source lines",
    sql: "ALTER TABLE edges ADD COLUMN type_only_import_lines TEXT;",
  },
  {
    version: 6,
    name: "multiline structural edge locations",
    sql: "ALTER TABLE edges ADD COLUMN source_end_lines TEXT;",
  },
  {
    version: 7,
    name: "recorded relationship evidence",
    sql: `ALTER TABLE change_events ADD COLUMN relationship TEXT
      CHECK(relationship IS NULL OR json_valid(relationship));
      CREATE INDEX relationship_events_by_project
        ON change_events(project_id, timestamp, id) WHERE relationship IS NOT NULL;`,
  },
  {
    version: 8,
    name: "activity history lookup indexes",
    sql: `CREATE INDEX change_events_by_entity ON change_events(project_id, entity_type, entity_id, id);
      CREATE INDEX change_events_by_file_revision
        ON change_events(project_id, path, COALESCE(after_revision, before_revision + 1));`,
  },
];
