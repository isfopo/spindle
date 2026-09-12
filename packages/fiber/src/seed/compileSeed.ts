/**
 * Seed compiler — turns a SeedSpec into concrete, deterministic literal rows.
 *
 * Runs only at dev/build time (inside fiberPlugin, or Node-side in tests); the
 * emitted module is pure data with no faker import, so the worker bundle never
 * contains the faker library.
 *
 * Values are inferred per column, in priority order:
 *   1. explicit strategy override (fake/pick/ref/seq/literal)
 *   2. column has an SQL DEFAULT → column is omitted (DB fills it)
 *   3. primary key → deterministic sequence (1, 2, 3, ...)
 *   4. unique column → generated value, uniqueness enforced (suffix/retry)
 *   5. CHECK enum → uniform pick from the allowed values
 *   6. foreign key → sampled from the referenced table's generated rows
 *   7. column-name heuristic (login, email, name, slug, ...) → faker provider
 *   8. fallback by SQLite type (nullable columns sometimes get null)
 */

import { faker } from "@faker-js/faker";
import type { ColumnDef, SchemaDef, CheckDef, TableDef } from "../schema";
import type { SeedSpec, TableGenerateSpec, TableRowsSpec } from "./spec";
import { isStrategy, type ValueStrategy, type FakerProvider } from "./strategies";

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface CompiledTable {
  name: string;
  rows: Record<string, unknown>[];
}

export interface CompiledSeed {
  /** Stable fingerprint of the dataset (gates re-sowing). */
  hash: string;
  tables: CompiledTable[];
}

export interface CompileOptions {
  /** Determinism seed for faker. Defaults to 42. */
  seed?: number;
}

// ---------------------------------------------------------------------------
// FK ordering
// ---------------------------------------------------------------------------

/** Order table names so referenced tables come before referencing ones. */
export function seedOrder(schema: SchemaDef, names: string[]): string[] {
  const set = new Set(names);
  const deps = new Map<string, Set<string>>();
  for (const t of schema.tables) {
    if (!set.has(t.name)) continue;
    const d = new Set<string>();
    for (const c of t.columns) {
      if (
        c.references &&
        set.has(c.references.table) &&
        c.references.table !== t.name
      ) {
        d.add(c.references.table);
      }
    }
    deps.set(t.name, d);
  }

  const remaining = new Set(names);
  const out: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter(
      (n) => ![...(deps.get(n) ?? [])].some((d) => remaining.has(d)),
    );
    if (ready.length === 0) {
      throw new Error("Seed spec has a cyclic foreign-key dependency");
    }
    for (const r of ready) {
      out.push(r);
      remaining.delete(r);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

function formatSqliteDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const HEURISTICS: Record<string, () => unknown> = {
  login: () => faker.internet.username(),
  username: () => faker.internet.username(),
  email: () => faker.internet.email(),
  name: () => faker.person.fullName(),
  firstname: () => faker.person.firstName(),
  lastname: () => faker.person.lastName(),
  avatarurl: () => faker.image.avatar(),
  avatar: () => faker.image.avatar(),
  picture: () => faker.image.avatar(),
  url: () => faker.internet.url(),
  website: () => faker.internet.url(),
  title: () => faker.lorem.sentence().replace(/\.$/, ""),
  slug: () => faker.helpers.slugify(faker.lorem.words(3)),
  context: () => faker.lorem.paragraphs(2),
  description: () => faker.lorem.sentences(2),
  rationale: () => faker.lorem.paragraphs(1),
  decision: () => faker.lorem.paragraphs(1),
  reason: () => faker.lorem.sentence(),
  pros: () => faker.lorem.sentences(2),
  cons: () => faker.lorem.sentences(2),
  bio: () => faker.person.bio(),
  jobtitle: () => faker.person.jobTitle(),
  city: () => faker.location.city(),
  country: () => faker.location.country(),
};

/** Find a heuristic for a column name, or undefined. */
function heuristicFor(column: ColumnDef): (() => unknown) | undefined {
  const n = column.name.replace(/[^a-z0-9]/g, "").toLowerCase();
  if (n.endsWith("at") || n.includes("date")) {
    return () => formatSqliteDate(faker.date.recent({ days: 365 }));
  }
  return HEURISTICS[n];
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(path: FakerProvider): () => unknown {
  const parts = path.split(".");
  let fn: unknown = faker;
  for (const part of parts) {
    if (typeof fn !== "object" || fn === null || !(part in fn)) {
      throw new Error(
        `Unknown faker provider path "${path}" (missing "${part}")`,
      );
    }
    fn = (fn as Record<string, unknown>)[part];
  }
  if (typeof fn !== "function") {
    throw new Error(`Faker provider "${path}" is not a function`);
  }
  return () => (fn as () => unknown)();
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

interface CompileContext {
  schema: SchemaDef;
  /** Table name → PK values of all generated rows (for FK sampling). */
  pools: Map<string, unknown[]>;
  /** PK column name per table. */
  pkCols: Map<string, string>;
  /** Per-column uniqueness sets: "table\0column" → serialized values seen. */
  seen: Map<string, Set<string>>;
  /** Per-table sequence counter for seq(). */
  seqCounters: Map<string, number>;
  /** Table currently being generated (drives self-reference sampling). */
  currentTable: string;
}

export function compileSeed(
  spec: SeedSpec,
  options: CompileOptions = {},
): CompiledSeed {
  faker.seed(options.seed ?? 42);

  const ctx: CompileContext = {
    schema: spec.schema,
    pools: new Map(),
    pkCols: new Map(),
    seen: new Map(),
    seqCounters: new Map(),
    currentTable: "",
  };

  for (const t of spec.schema.tables) {
    const pk = t.columns.find((c) => c.primaryKey);
    if (pk) ctx.pkCols.set(t.name, pk.name);
  }

  const tables: CompiledTable[] = [];
  const order = seedOrder(spec.schema, Object.keys(spec.tables));

  for (const name of order) {
    const tableDef = spec.schema.tables.find((t) => t.name === name)!;
    ctx.currentTable = name;
    const entry = spec.tables[name];
    const rows =
      "rows" in entry
        ? compileLiteralRows(tableDef, entry as TableRowsSpec)
        : compileGeneratedRows(tableDef, entry as TableGenerateSpec, ctx);
    ctx.pools.set(name, rows.map((r) => rowKeyValue(tableDef, r)));
    tables.push({ name, rows });
  }

  const hash = fnv1a(JSON.stringify(tables));

  return { hash, tables };
}

/**
 * FNV-1a 32-bit hash — deterministic, dependency-free (no node:crypto) so the
 * compiler also runs in the workerd test pool. The hash only gates re-sowing;
 * it is not a security primitive.
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Literal rows
// ---------------------------------------------------------------------------

function compileLiteralRows(
  table: TableDef,
  spec: TableRowsSpec,
): Record<string, unknown>[] {
  const known = new Set(table.columns.map((c) => c.name));
  for (const row of spec.rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        throw new Error(
          `Literal row for "${table.name}" has unknown column "${key}"`,
        );
      }
    }
  }
  return spec.rows.map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Generated rows
// ---------------------------------------------------------------------------

function compileGeneratedRows(
  table: TableDef,
  spec: TableGenerateSpec,
  ctx: CompileContext,
): Record<string, unknown>[] {
  const overrides = spec.overrides ?? {};
  const sawSeq = Object.values(overrides).some(
    (v) => isStrategy(v) && v.kind === "seq",
  );
  const rows: Record<string, unknown>[] = [];

  let i = 0;
  let failures = 0;
  while (i < spec.count) {
    // A table-unique conflict redraws the row, but an under-constrained space
    // (e.g. UNIQUE(a, b) over two tiny pick() pools) can never satisfy the
    // count — bound the retries so the compiler errors instead of hanging.
    if (failures > spec.count * 100 + 500) {
      throw new Error(
        `Unable to generate ${spec.count} rows for "${table.name}" — table-unique constraints cannot be satisfied with the given overrides`,
      );
    }
    const snapshot = snapshotSeen(ctx, table.name);
    const row = buildRow(
      table,
      ctx,
      rows,
      overrides,
      i,
      sawSeq,
      ctx.seqCounters.get(table.name) ?? 0,
    );
    if (tableHasUniqueConflict(table, row, rows)) {
      restoreSeen(ctx, snapshot);
      failures++;
      continue; // redo this row with fresh draws (bounded by the guard above)
    }
    failures = 0;
    rows.push(row);
    if (sawSeq) ctx.seqCounters.set(table.name, (ctx.seqCounters.get(table.name) ?? 0) + 1);
    i++;
  }
  return rows;
}

/** Build one row, claiming column-unique keys as it goes. */
function buildRow(
  table: TableDef,
  ctx: CompileContext,
  priorRows: Record<string, unknown>[],
  overrides: Record<string, ValueStrategy>,
  index: number,
  sawSeq: boolean,
  seqCounter: number,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of table.columns) {
    const value = resolveColumn(column, table, ctx, priorRows, overrides[column.name], index, seqCounter, sawSeq);
    if (value !== OMIT) row[column.name] = value;
  }
  return row;
}

/** Sentinel for "omit this column — the DB has a DEFAULT for it". */
const OMIT = Symbol("omit");

function resolveColumn(
  column: ColumnDef,
  table: TableDef,
  ctx: CompileContext,
  priorRows: Record<string, unknown>[],
  strategy: ValueStrategy | undefined,
  index: number,
  seqCounter: number,
  sawSeq: boolean,
): unknown {
  const gen = rawGenerator(column, table, ctx, priorRows, strategy, index, seqCounter, sawSeq);
  if (gen === null) return OMIT; // column has a DEFAULT
  if (column.primaryKey) {
    if (strategy !== undefined) {
      throw new Error(
        `Cannot override primary key "${table.name}.${column.name}" in generate() — PKs are sequential and referenced by foreign keys; use rows() for fixed ids`,
      );
    }
    return index + 1;
  }
  if (column.unique) return makeUnique(column, table, ctx, gen);
  return gen();
}

/**
 * A fresh-candidate generator for a column, or null when the column should be
 * omitted (has an SQL DEFAULT). Used directly, or as the retry source for
 * unique columns.
 */
function rawGenerator(
  column: ColumnDef,
  table: TableDef,
  ctx: CompileContext,
  priorRows: Record<string, unknown>[],
  strategy: ValueStrategy | undefined,
  index: number,
  seqCounter: number,
  sawSeq: boolean,
): (() => unknown) | null {
  if (strategy !== undefined) {
    if (!isStrategy(strategy)) return () => strategy; // literal value
    switch (strategy.kind) {
      case "fake":
        return resolveProvider(strategy.provider);
      case "pick":
        return () => faker.helpers.arrayElement(strategy.values);
      case "ref":
        if (!ctx.pools.has(strategy.table) && strategy.table !== table.name) {
          throw new Error(
            `ref("${strategy.table}") from "${table.name}" — target is not in the seed spec`,
          );
        }
        return () => sampleFromPool(strategy.table, ctx, column, priorRows);
      case "seq":
        return () => (sawSeq ? seqCounter : 0);
    }
  }
  if (column.primaryKey) return () => index + 1;
  const ref = column.references;
  if (ref) {
    if (!ctx.pools.has(ref.table) && ref.table !== table.name) {
      throw new Error(
        `Column "${table.name}.${column.name}" references "${ref.table}" but it is not in the seed spec`,
      );
    }
    return () => sampleFromPool(ref.table, ctx, column, priorRows);
  }
  if (column.check?.kind === "range") {
    const range = column.check;
    return () => rangeNumberFor(range);
  }
  // Data-driven inference wins over the column default: a references/checkRef
  // column samples its lookups, a range column varies within bounds. The
  // DEFAULT is only relied on for genuinely DB-owned columns (timestamps).
  if (column.default !== undefined) return null;
  const heuristic = heuristicFor(column);
  if (heuristic) return heuristic;
  return () => randomForType(column, !column.notNull);
}

function sampleFromPool(
  target: string,
  ctx: CompileContext,
  column: ColumnDef,
  priorRows: Record<string, unknown>[],
): unknown {
  const pkCol = ctx.pkCols.get(target);
  if (!pkCol) {
    throw new Error(`Seed target "${target}" has no primary key column`);
  }
  // Other tables draw from the scalar PK pool; self-references draw from the
  // rows already built, projected down to their PK values.
  const pool =
    target === ctx.currentTable
      ? priorRows.map((r) => r[pkCol] ?? null)
      : (ctx.pools.get(target) ?? []);
  if (pool.length === 0) {
    if (column.notNull) {
      throw new Error(
        `Cannot sample "${target}" for "${column.name}": no rows generated yet`,
      );
    }
    return null;
  }
  if (!column.notNull && faker.number.int({ min: 0, max: 99 }) < 30) return null;
  return faker.helpers.arrayElement(pool);
}

function makeUnique(
  column: ColumnDef,
  table: TableDef,
  ctx: CompileContext,
  gen: () => unknown,
): unknown {
  const set = findSeenSet(ctx, table.name, column.name);
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = gen();
    if (value === undefined || value === null) return value;
    const key = serializeKey(value);
    if (!set.has(key)) {
      set.add(key);
      return value;
    }
    if (typeof value === "string" && column.sqliteType === "TEXT") {
      for (let n = 2; n < 50; n++) {
        const suffixed = `${value}-${n}`;
        if (!set.has(suffixed)) {
          set.add(suffixed);
          return suffixed;
        }
      }
    }
  }
  throw new Error(
    `Could not generate a unique value for "${table.name}.${column.name}"`,
  );
}

/** Random number honoring a range constraint's bounds (inclusive defaults). */
function rangeNumberFor(check: Extract<CheckDef, { kind: "range" }>): number {
  const { greaterThan, greaterThanEqual, lessThan, lessThanEqual } = check;
  const min = greaterThan !== undefined ? greaterThan + 1 : (greaterThanEqual ?? 0);
  const max = lessThan !== undefined ? lessThan - 1 : (lessThanEqual ?? 1_000_000);
  return faker.number.int({ min, max: Math.max(max, min) });
}

function randomForType(column: ColumnDef, allowNull: boolean): unknown {
  if (allowNull && faker.number.int({ min: 0, max: 99 }) < 35) return null;
  switch (column.sqliteType) {
    case "INTEGER":
      return faker.number.int({ min: 1, max: 1_000_000 });
    case "REAL":
      return faker.number.float({ min: 0, max: 1000 });
    case "TEXT":
      return faker.lorem.sentence();
    case "BLOB":
      if (allowNull) return null;
      throw new Error(
        `No way to generate a BLOB value for "${column.name}" without an override`,
      );
  }
}

function serializeKey(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function findSeenSet(ctx: CompileContext, table: string, column: string): Set<string> {
  const key = `${table}\u0000${column}`;
  let set = ctx.seen.get(key);
  if (!set) {
    set = new Set();
    ctx.seen.set(key, set);
  }
  return set;
}

/** Snapshot a table's column-unique sets so a failed row can be rolled back. */
function snapshotSeen(
  ctx: CompileContext,
  table: string,
): Map<string, string[]> {
  const snapshot = new Map<string, string[]>();
  for (const [key, set] of ctx.seen) {
    if (key.startsWith(`${table}\u0000`)) snapshot.set(key, [...set]);
  }
  return snapshot;
}

/** Restore the sets to a snapshot taken before the failed row. */
function restoreSeen(ctx: CompileContext, snapshot: Map<string, string[]>): void {
  for (const [key, keys] of snapshot) {
    const set = ctx.seen.get(key);
    if (!set) continue;
    set.clear();
    for (const k of keys) set.add(k);
  }
}

function rowKeyValue(table: TableDef, row: Record<string, unknown>): unknown {
  const pk = table.columns.find((c) => c.primaryKey)?.name;
  return pk !== undefined ? row[pk] ?? null : null;
}

/** Check table-level unique groups (e.g. UNIQUE(tenet_id, user_id)). */
function tableHasUniqueConflict(
  table: TableDef,
  row: Record<string, unknown>,
  rows: Record<string, unknown>[],
): boolean {
  if (!table.unique) return false;
  for (const group of table.unique) {
    const key = JSON.stringify(group.map((c) => row[c]));
    if (rows.some((r) => JSON.stringify(group.map((c) => r[c])) === key)) {
      return true;
    }
  }
  return false;
}
