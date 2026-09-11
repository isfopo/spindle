/**
 * defineSchema — the TypeScript source of truth for the database schema.
 *
 *   export const schema = defineSchema({
 *     tables: {
 *       users: table({
 *         id: integer("id").primaryKey().autoIncrement(),
 *       }),
 *     },
 *     indexes: {
 *       idx_users_login: index({ table: "users", columns: ["login"], unique: true }),
 *     },
 *   });
 *
 * The result is a normalized, validated SchemaDef IR consumed by:
 *   - the compiler (model types + derived schema.sql), and
 *   - the runtime reconciliation layer (applySchema).
 *
 * In the `tables` object the column *key* is the default column name — an
 * explicit builder arg overrides it.
 */

 /**
  * Canonical Schema IR types shared by the DSL, generators, and the runtime
  * reconciliation layer. These are the shapes a compiled SchemaDef takes.
  */

 import type { TableColumns, TableDef } from "./table";
 import type { IndexDef, IndexInput } from "./indexes";

 export type SqliteType = "INTEGER" | "TEXT" | "REAL" | "BLOB";

 export interface SchemaInput {
   tables: Record<string, TableColumns>;
   indexes?: Record<string, IndexInput>;
 }

 export interface ReferenceDef {
   table: string;
   column: string;
   onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
 }

 /**
  * A CHECK-class constraint on a column. Either a reference to a lookup
  * table's primary key (referential enum — the typegen derives a union from
  * the lookup's seeded rows), or a numeric range.
  */
 export type CheckDef =
   | { kind: "ref"; table: string; column: string }
   | {
       kind: "range";
       greaterThan?: number;
       lessThan?: number;
       greaterThanEqual?: number;
       lessThanEqual?: number;
     };

 export interface SchemaDef {
   tables: TableDef[];
   indexes: IndexDef[];
 }


export function defineSchema(input: SchemaInput): SchemaDef {
  const tableNames = Object.keys(input.tables);
  if (tableNames.length === 0) {
    throw new Error("Schema must define at least one table");
  }

  const tables: TableDef[] = tableNames.map((name) => ({
    ...input.tables[name],
    name,
  }));

  // Validate references point at known tables (best-effort, catches typos),
  // and resolve checkRef columns to their lookup table's primary key.
  const known = new Set(tableNames);
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.references && !known.has(col.references.table)) {
        throw new Error(
          `Table "${table.name}" references unknown table "${col.references.table}"`,
        );
      }
      if (col.check?.kind === "ref") {
        const check = col.check;
        const lookup = tables.find((t) => t.name === check.table);
        if (!lookup) {
          throw new Error(
            `Table "${table.name}" column "${col.name}" references unknown lookup table "${check.table}"`,
          );
        }
        const pk = lookup.columns.find((c) => c.primaryKey);
        if (!pk) {
          throw new Error(
            `Lookup table "${check.table}" has no primary key for checkRef on "${table.name}.${col.name}"`,
          );
        }
        col.check = { kind: "ref", table: check.table, column: pk.name };
        // A checkRef is also a foreign key — seed sampling, DDL and the
        // reconciler all consume it through `references`.
        if (!col.references) {
          col.references = { table: check.table, column: pk.name };
        }
      }
    }
  }

  // A single-column UNIQUE index on a column already declared `.unique()` (or
  // the primary key) duplicates the constraint's autoindex — SQLite would
  // build both for the same column, so the explicit index is dropped.
  const indexes = Object.entries(input.indexes ?? {})
    .map(([name, def]) => ({ ...def, name }))
    .filter((ix) => {
      if (ix.unique && ix.columns.length === 1) {
        const table = tables.find((t) => t.name === ix.table);
        const col = table?.columns.find((c) => c.name === ix.columns[0]);
        if (col?.unique || col?.primaryKey) return false;
      }
      return true;
    });

  return { tables, indexes };
}
