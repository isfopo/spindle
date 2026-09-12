/**
 * Seed spec — the declarative description of data to write into a dev
 * database, mirroring the schema DSL.
 *
 *   const seed = defineSeed(schema, {
 *     users: generate(24, { login: fake("internet.username") }),
 *     perks: rows([{ key: "welcome", ... }]),   // literal, content-like rows
 *   });
 *
 * Missing columns fall back to sensible defaults derived from the schema
 * (column DEFAULTs are used as-is, unique/PK/CHECK/FK rules are honored),
 * so a spec only overrides the columns whose values need shaping.
 */

import type { SchemaDef } from "../schema";
import type { ValueStrategy } from "./strategies";

export interface TableGenerateSpec {
  count: number;
  /** Column name → value strategy. Omitted columns are inferred from the schema. */
  overrides?: Record<string, ValueStrategy>;
}

export interface TableRowsSpec {
  /** Literal rows; keys are column names, absent keys fall back to defaults. */
  rows: Record<string, unknown>[];
}

export type TableSpec = TableGenerateSpec | TableRowsSpec;

export interface SeedSpec {
  /** The schema these tables belong to — used for FK order, defaults, enums. */
  schema: SchemaDef;
  /** Table name → spec. Tables not listed here are left untouched. */
  tables: Record<string, TableSpec>;
}

/** Bind a per-table seed spec to a SchemaDef. */
export function defineSeed(
  schema: SchemaDef,
  tables: Record<string, TableSpec>,
): SeedSpec {
  for (const name of Object.keys(tables)) {
    if (!schema.tables.some((t) => t.name === name)) {
      throw new Error(`Seed spec references unknown table "${name}"`);
    }
  }
  return { schema, tables };
}

/** Generate `count` rows for a table, overriding listed columns. */
export function generate(count: number, overrides?: Record<string, ValueStrategy>): TableGenerateSpec {
  if (count < 0) throw new Error(`generate() count must be >= 0, got ${count}`);
  return { count, overrides };
}

/** Literal, stable rows (content-like data). */
export function rows(rows: Record<string, unknown>[]): TableRowsSpec {
  return { rows };
}
