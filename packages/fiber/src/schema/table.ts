/**
 * Table definition — a named set of column builders.
 */

 import { ColumnDef, ColumnBuilderLike } from "./column";

 /** Shape returned by the `table()` helper, before `defineSchema` assigns a name. */
 export interface TableColumns {
   columns: ColumnDef[];
   unique?: string[][];
 }

 /** Table-level options supported by `table()`. */
 export interface TableOptions {
   /**
    * Table-level unique constraints — each inner array is a set of columns
    * that must be unique together. Prefer column `.unique()` for a single
    * column.
    */
   unique?: string[][];
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Table-level unique constraints — each inner array is a set of columns. */
  unique?: string[][];
}

/**
 * Define a table from an object of column builders. Keys become column names;
 * the object form keeps the declaration concise and self-describing. The table
 * name is assigned by `defineSchema` from the containing object's key.
 */
export function table(
  columns: Record<string, ColumnBuilderLike>,
  options: TableOptions = {},
): TableColumns {
  const entries = Object.entries(columns);
  if (entries.length === 0) {
    throw new Error("Table must define at least one column");
  }
  return {
    columns: entries.map(([name, builder]) => builder.toColumnDef(name)),
    ...(options.unique ? { unique: options.unique } : {}),
  };
}
