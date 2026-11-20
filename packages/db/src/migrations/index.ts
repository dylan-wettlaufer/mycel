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
];
