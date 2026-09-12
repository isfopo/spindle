/**
 * Pure DDL string builders shared by the derived schema.sql generator and the
 * runtime reconciliation layer (applySchema). Keeping these as pure functions
 * makes them unit-testable and guarantees the bootstrap and the rebuild paths
 * emit the same dialect.
 */

import type { ColumnDef } from "./column";
import { TableDef } from "./table";

/** Quote a SQLite identifier with double quotes (escaping embedded quotes). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Escape a single-quoted SQLite string literal. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Render a single column definition clause for a CREATE TABLE. */
export function renderColumnDef(col: ColumnDef): string {
  const parts = [quoteIdent(col.name), col.sqliteType];

  if (col.primaryKey) {
    parts.push("PRIMARY KEY");
    if (col.autoIncrement) parts.push("AUTOINCREMENT");
  }
  if (col.unique) parts.push("UNIQUE");
  if (col.notNull) parts.push("NOT NULL");
  if (col.default !== undefined) parts.push(`DEFAULT ${col.default}`);

  if (col.check) {
    if (col.check.kind === "range") {
      const bounds: string[] = [];
      const n = quoteIdent(col.name);
      if (col.check.greaterThan !== undefined) bounds.push(`${n} > ${col.check.greaterThan}`);
      if (col.check.greaterThanEqual !== undefined) bounds.push(`${n} >= ${col.check.greaterThanEqual}`);
      if (col.check.lessThan !== undefined) bounds.push(`${n} < ${col.check.lessThan}`);
      if (col.check.lessThanEqual !== undefined) bounds.push(`${n} <= ${col.check.lessThanEqual}`);
      if (bounds.length > 0) parts.push(`CHECK(${bounds.join(" AND ")})`);
    }
    // check.kind === "ref" renders as the FOREIGN KEY below (via `references`).
  }

  if (col.references) {
    const ref = col.references;
    let clause = `REFERENCES ${quoteIdent(ref.table)}(${quoteIdent(ref.column)})`;
    if (ref.onDelete) clause += ` ON DELETE ${ref.onDelete}`;
    parts.push(clause);
  }

  return parts.join(" ");
}

/** Render a CREATE TABLE statement. `ifNotExists` controls the IF NOT EXISTS clause. */
export function renderCreateTable(table: TableDef, ifNotExists = true): string {
  const lines = table.columns.map((c) => `    ${renderColumnDef(c)}`);

  for (const group of table.unique ?? []) {
    if (group.length === 0) continue;
    lines.push(`    UNIQUE(${group.map(quoteIdent).join(", ")})`);
  }

  const body = lines.join(",\n");
  const guard = ifNotExists ? "IF NOT EXISTS " : "";
  return `CREATE TABLE ${guard}${quoteIdent(table.name)} (\n${body}\n);`;
}

/** Render an ALTER TABLE ... ADD COLUMN statement (SQLite restrictions apply). */
export function renderAddColumn(table: string, col: ColumnDef): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${renderColumnDef(col)};`;
}

/** Render an ALTER TABLE ... RENAME COLUMN statement. */
export function renderRenameColumn(
  table: string,
  oldName: string,
  newName: string,
): string {
  return `ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(oldName)} TO ${quoteIdent(newName)};`;
}

export interface IndexLike {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
}

/** Render a CREATE INDEX statement. */
export function renderCreateIndex(index: IndexLike, ifNotExists = true): string {
  const prefix = index.unique
    ? "CREATE UNIQUE INDEX"
    : "CREATE INDEX";
  const guard = ifNotExists ? "IF NOT EXISTS " : "";
  const cols = index.columns
    .map((c) => {
      // Preserve a sort-direction suffix like `created_at DESC`.
      const [ident, ...rest] = c.trim().split(/\s+/);
      return [quoteIdent(ident), ...rest].join(" ");
    })
    .join(", ");
  return `${prefix} ${guard}${quoteIdent(index.name)} ON ${quoteIdent(index.table)}(${cols});`;
}

/** Render a DROP INDEX statement. */
export function renderDropIndex(name: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdent(name)};`;
}
