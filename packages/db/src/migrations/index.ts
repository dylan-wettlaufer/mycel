import { initialSchema } from "./001-initial.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  { version: 1, name: "initial graph schema", sql: initialSchema },
];
