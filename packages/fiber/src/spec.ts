/**
 * js-mvc/sql DSL — TypeScript-authored stored queries.
 *
 * A `def({ ... })` block in a `procs.ts` file describes the actions and
 * lookups a repository needs. At dev/build time `fiberPlugin` compiles it —
 * once — into a static SQL module (`procs.generated.ts`) with a typed
 * `ProcMap`, deriving result and parameter types from the schema singleton so
 * they can never drift from the database.
 *
 *   export const procs = def({
 *     getWithProposer: lookup({
 *       select: ["t.*", "u.login AS proposer_login"],
 *       from: [
 *         { table: "tenets", as: "t" },
 *         { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
 *       ],
 *       where: { "t.slug": param() },          // param type: Tenet["slug"] = string
 *     }),
 *     updateStatus: action({
 *       into: "tenets",
 *       set: { status: param(), updated_at: sql`datetime('now')` },
 *       where: { id: param() },
 *     }),
 *   });
 *
 * Parameters use `@name` placeholders in the generated SQL, so the existing
 * repository binding (`queryOne`/`queryAll`/`execute` + named-param
 * resolution) is unchanged.
 */

/** Marker for a static (author-written) SQL fragment. Interpolation is rejected. */
export interface SqlFragment {
  __sql: string;
}

/**
 * Mark an author-written SQL fragment for places the DSL leaves free-form
 * (join conditions, ORDER BY expressions, computed SET values).
 *
 *   on: sql`u.id = t.proposed_by_id`
 *   set: { updated_at: sql`datetime('now')` }
 *
 * Fragments must be static — interpolation is rejected so a build never
 * assembles SQL from dynamic parts.
 *
 * @throws If any interpolation placeholder is present.
 */
export function sql(strings: TemplateStringsArray, ...parts: unknown[]): SqlFragment {
  if (parts.length > 0) {
    throw new Error(
      "sql`` interpolation is not supported — keep fragments static",
    );
  }
  return { __sql: strings.join("") };
}

/** Marker for a bound parameter. The type is inferred from the referenced
 *  schema column when `type` is omitted; `name` overrides the placeholder.
 *  @see param */
export interface ParamSpec {
  __param: true;
  type?: string;
  name?: string;
}

/**
 * Declare a bound parameter in a lookup/action.
 *
 * The parameter's type is inferred from the schema column it binds to —
 * usually no type tag is needed (`where: { "t.slug": param() }` types the
 * param as `string`). Pass an explicit tag to override:
 *
 *   reason: param("string | null")
 *
 * Give an explicit `name` when two keys in one proc share a basename but must
 * bind independently (a join where both sides carry the same column name):
 *
 *   where: {
 *     "t.id": param("number", "tenet_id"),
 *     "u.id": param("number", "user_id"),
 *   }
 *
 * @param type Optional explicit TS type tag when not inferable from a column.
 * @param name Optional placeholder name; defaults to the unqualified key.
 */
export function param(type?: string, name?: string): ParamSpec {
  return { __param: true, type, name };
}

/** Type guard: is the value a `param()` marker? */
export function isParam(value: unknown): value is ParamSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ParamSpec).__param === true
  );
}

/** Type guard: is the value a `sql()` fragment? */
export function isSql(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SqlFragment).__sql === "string"
  );
}

/** A bare table reference: `{ table: "tenets", as: "t" }`. */
export interface TableRef {
  table: string;
  as?: string;
}

/** A join: `{ join: "users", as: "u", on: sql`...` }` (default INNER). */
export interface JoinRef {
  join: string;
  as?: string;
  on: SqlFragment;
  kind?: "inner" | "left" | "right" | "cross";
}

/** A bare, unaliased FROM entry: the table referenced by its own name. */
export function tbl<T extends string>(table: T): { table: T } {
  return { table };
}

/**
 * Declare the primary FROM entry, with an optional alias.
 *
 * Function arguments keep their literal types (object-literal properties
 * inside the config would widen and disarm the type-level column checks), so
 * the FROM entry is built with a call rather than written inline:
 *
 *   from: [from("tenets", "t")]
 *   from: [from("tenets")]           // alias = table name → bare keys allowed
 *
 * @param table The table to select from (must exist in the schema).
 * @param as    Optional alias used in projections/joins; defaults to the table name.
 */
export function from<T extends string>(table: T): { table: T };
export function from<T extends string, A extends string>(table: T, as: A): { table: T; as: A };
export function from<T extends string, A extends string>(
  table: T,
  as?: A,
): { table: T; as?: A } {
  return as === undefined ? { table } : { table, as };
}

/**
 * Declare a JOIN entry. `as` is optional — without it the joined table is
 * referenced by its own name in projections and the ON condition.
 *
 *   joins: [join("users", "u", sql`u.id = t.proposed_by_id`)]
 *   joins: [join("users", sql`users.id = t.proposed_by_id`)]
 *
 * @param join The table to join (must exist in the schema).
 * @param as   Optional alias; defaults to the table name.
 * @param on   The join condition (a static `sql()` fragment).
 */
export function join<J extends string>(join: J, on: SqlFragment): { join: J; on: SqlFragment };
export function join<J extends string, A extends string>(
  join: J,
  as: A,
  on: SqlFragment,
): { join: J; as: A; on: SqlFragment };
export function join<J extends string, A extends string>(
  join: J,
  asOrOn: A | SqlFragment,
  on?: SqlFragment,
): { join: J; as?: A; on: SqlFragment } {
  return on === undefined
    ? { join, on: asOrOn as SqlFragment }
    : { join, as: asOrOn as A, on };
}

/** A value slot: a parameter, a raw SQL fragment, or an inline literal. */
export type ValueSlots = ParamSpec | SqlFragment | string | number | boolean | null;

export interface LookupConfig {
  /** Projections, e.g. `"t.*"`, `"u.login AS proposer_login"`, or a `sql()` fragment. */
  select: (string | SqlFragment)[];
  /** The primary FROM entry, plus any joins. */
  from: (TableRef | JoinRef)[];
  /** Equality/param conditions (qualified keys like `"t.slug"` for joins). */
  where?: Record<string, ValueSlots>;
  groupBy?: (string | SqlFragment)[];
  orderBy?: string | SqlFragment | (string | SqlFragment)[];
  limit?: number | ParamSpec;
  offset?: number | ParamSpec;
}

export interface ActionConfig {
  /** INSERT target, or the table UPDATE/DELETE applies to. */
  into: string;
  /** INSERT: column → value. */
  values?: Record<string, ValueSlots>;
  /** UPDATE: column → value. */
  set?: Record<string, ValueSlots>;
  /** WHERE conditions (required for UPDATE/SET). */
  where?: Record<string, ValueSlots>;
  /** Columns returned to the caller. Only "*" or column names. */
  returning?: ("*" | string)[];
}

export interface LookupProc {
  kind: "lookup";
  config: LookupConfig;
}

export interface ActionProc {
  kind: "action";
  config: ActionConfig;
}

export type ProcConfig = LookupProc | ActionProc;
export type ProcDefs = Record<string, ProcConfig>;

/**
 * Describe a read query: which columns to select, from which table (with
 * optional joins), filtered/secorted within SQL so selection and filtering
 * never happen in application memory.
 *
 *   lookup({
 *     select: ["t.*", "u.login AS proposer_login"],
 *     from: [from("tenets", "t"), join("users", "u", sql`u.id = t.proposed_by_id`)],
 *     where: { "t.slug": param() },
 *     orderBy: sql`t.created_at DESC`,
 *   })
 *
 * Compile-time checks (when used through `defineSql`) validate projection and
 * WHERE column names against the schema; the build-time compiler infers the
 * result type from the projections.
 */
export function lookup(config: LookupConfig): ProcConfig {
  return { kind: "lookup", config };
}

/**
 * Describe a write: an INSERT (`values`) or UPDATE (`set` + `where`).
 *
 *   action({ into: "votes", values: { tenet_id: param(), choice: param() } })
 *   action({ into: "tenets", set: { status: param() }, where: { id: param() } })
 *
 * `returning` columns are typed from the schema; without it the result is void.
 * UPDATE requires a `where` clause (a guard against full-table writes).
 *
 * @throws If neither `values` nor `set` is given, or an UPDATE lacks `where`.
 */
export function action(config: ActionConfig): ProcConfig {
  if (!config.values && !config.set) {
    throw new Error("action() requires either values (INSERT) or set (UPDATE)");
  }
  if (config.set && !config.where) {
    throw new Error("action() UPDATE requires a where clause");
  }
  return { kind: "action", config };
}

/**
 * Group a set of stored queries under one name (convention: `procs`).
 *
 *   export const procs = def({ getOptions: lookup({ ... }), ... });
 */
export function def(procs: ProcDefs): ProcDefs {
  return procs;
}

// ---------------------------------------------------------------------------
// Type-level validation (spike) — editor-time checking of select/where/
// action columns against a schema index type (e.g. the generated `Database`
// interface in db-types.d.ts). `defineSql<Db>()` binds the DSL to that type.
// ---------------------------------------------------------------------------

/** Minimal shape of the schema index: table name → row interface.
 *  Ergonomic constraint only — the generated `Database` interface satisfies
 *  `object`; the machinery resolves columns from the bound concrete type. */
export type SchemaIndex = object;

/** alias → table pair for one FROM entry. */
type FromPair<R> = R extends { as: infer A; table: infer T }
  ? [A, T]
  : R extends { as: infer A; join: infer J }
    ? [A, J]
    : R extends { table: infer T }
      ? [T, T]
      : R extends { join: infer J }
        ? [J, J]
        : never;

type Distribute<U> = U extends unknown ? U : never;

/** All aliases (or bare table names) used in a FROM array. */
export type AllAliases<F> = F extends readonly (infer R)[]
  ? Distribute<FromPair<R>[0]>
  : never;

/** One valid select projection for a single FROM element. */
type OneProj<R, Db extends SchemaIndex> = FromPair<R> extends [infer A, infer T]
  ? [A, T] extends [string, string]
    ? `*`
      | `${A & string}.*`
      | `${A & string}.${Extract<keyof Db[T & keyof Db], string>}`
      | `${A & string}.${Extract<keyof Db[T & keyof Db], string>} AS ${string}`
    : never
  : never;

/** Distribute OneProj over each FROM element (keeps alias/table literals). */
type DistributeProj<R, Db extends SchemaIndex> = R extends unknown
  ? OneProj<R, Db>
  : never;

/** Union of valid select projections for FROM array F. */
export type TypedSelect<F, Db extends SchemaIndex> = F extends readonly (infer R)[]
  ? DistributeProj<R, Db> | BareKeys<F, Db> | `${BareKeys<F, Db>} AS ${string}`
  : never;

/** Bare (unqualified) column keys of UNALIASED from entries — unambiguous
 *  only when an entry is referenced by its own table name. */
export type BareKeys<F, Db extends SchemaIndex> = F extends readonly (infer R)[]
  ? (R extends unknown
      ? FromPair<R> extends [infer A, infer T]
        ? [A, T] extends [string, string]
          ? (A extends T ? Extract<keyof Db[T & keyof Db], string> : never)
          : never
        : never
      : never)
  : never;

/** One valid qualified WHERE key for a single FROM element. */
type OneQualifiedKey<R, Db extends SchemaIndex> = FromPair<R> extends [infer A, infer T]
  ? [A, T] extends [string, string]
    ? `${A & string}.${Extract<keyof Db[T & keyof Db], string>}`
    : never
  : never;

/** Valid qualified WHERE keys (alias.column), e.g. `t.slug`. */
export type TypedQualifiedKey<F, Db extends SchemaIndex> = F extends readonly (infer R)[]
  ? (R extends unknown ? OneQualifiedKey<R, Db> : never)
  : never;

/** Valid WHERE keys for FROM F: qualified, plus bare columns of unaliased
 *  entries (e.g. a single-tbl(`tenet_options`) lookup). */
export type TypedWhereKey<F, Db extends SchemaIndex> =
  TypedQualifiedKey<F, Db> | BareKeys<F, Db>;

/** Typed lookup config: from + select (+ where keys) validated against Db. */
export type TypedLookupConfig<F, Db extends SchemaIndex> = {
  from: F;
  select: readonly (TypedSelect<F, Db> | SqlFragment)[];
  where?: Partial<Record<TypedWhereKey<F, Db>, ValueSlots>>;
  groupBy?: (string | SqlFragment)[];
  orderBy?: string | SqlFragment | (string | SqlFragment)[];
  limit?: number | ParamSpec;
  offset?: number | ParamSpec;
};

/** Typed action config: into/values/set/where keys validated against Db. */
export type TypedActionConfig<I extends string, Db extends SchemaIndex> = {
  into: I;
  values?: Partial<Record<keyof Db[I & keyof Db] & string, ValueSlots>>;
  set?: Partial<Record<keyof Db[I & keyof Db] & string, ValueSlots>>;
  where?: Partial<Record<keyof Db[I & keyof Db] & string, ValueSlots>>;
  returning?: ("*" | (keyof Db[I & keyof Db] & string))[];
};

/**
 * Bind the SQL DSL to a schema index type so lookups/actions validate their
 * column strings at compile time. Runtime no-op — returns the same functions.
 *
 *   const { def, lookup, action, param, sql } = defineSql<Database>();
 */
export function defineSql<Db extends SchemaIndex>() {
  return {
    def,
    tbl,
    from,
    join,
    lookup<F extends readonly (TableRef | JoinRef)[]>(
      cfg: TypedLookupConfig<F, Db>,
    ): LookupProc {
      return { kind: "lookup", config: cfg as unknown as LookupConfig };
    },
    action<I extends string>(cfg: TypedActionConfig<I, Db>): ActionProc {
      const runtime: ActionConfig = {
        into: cfg.into,
        ...(cfg.values ? { values: cfg.values as Record<string, ValueSlots> } : {}),
        ...(cfg.set ? { set: cfg.set as Record<string, ValueSlots> } : {}),
        ...(cfg.where ? { where: cfg.where as Record<string, ValueSlots> } : {}),
        ...(cfg.returning ? { returning: cfg.returning } : {}),
      };
      if (!runtime.values && !runtime.set) {
        throw new Error("action() requires either values (INSERT) or set (UPDATE)");
      }
      if (runtime.set && !runtime.where) {
        throw new Error("action() UPDATE requires a where clause");
      }
      return { kind: "action", config: runtime };
    },
    param,
    sql,
  };
}
