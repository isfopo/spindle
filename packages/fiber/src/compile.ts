/**
 * Compiles a ProcDefs block into a typed SQL module.
 *
 * Runs only at dev/build time (inside fiberPlugin, or node-side in tests). For
 * each proc it renders the SQL string (parameters use `@name` so the existing
 * repository binding resolves them) and derives the TypeScript `params` and
 * `result` types from the schema singleton — projections like `t.*` expand to
 * the whole model interface, `t.col AS alias` inherits the column's type
 * (enums, nullability), and parameters infer their type from the column they
 * bind to.
 */

import type { ColumnDef, SchemaDef, TableDef } from "./schema";
import { tableNameToTypeName, columnToTsType } from "./schema/generate-types";
import type {
  ProcDefs,
  LookupConfig,
  ActionConfig,
  ParamSpec,
} from "./spec";

import { isParam, isSql } from "./spec";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CompiledProcs {
  /** Full text of the generated `procs.generated.ts` module. */
  moduleText: string;
  /** Query name → rendered SQL (with @name placeholders). */
  queries: Record<string, string>;
}

interface ProcTypes {
  paramsTs: string;
  resultTs: string;
  dbTypes: Set<string>;
  modelTypes: Set<string>;
}

interface CompiledProc extends ProcTypes {
  sql: string;
}

/** Schema + naming context shared across a compile pass. */
interface CompileContext {
  schema: SchemaDef;
  overrides: Record<string, string>;
  /** Literal lookup rows → checkRef columns type as unions of their PK values. */
  lookups: Map<string, Record<string, unknown>[]>;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

interface ParamsCollector {
  /** name → TS type source. Insertion-ordered. */
  params: Map<string, string>;
}

/**
 * Compile a ProcDefs block into a typed SQL module.
 *
 * Runs at dev/build time (inside fiberPlugin, or node-side in tests). For each
 * proc it renders the SQL statements (named `@param` placeholders resolved by
 * the repository binding) and derives `params`/`result` types from the schema,
 * so repository method signatures can never drift from the database.
 *
 * @param schema              The SchemaDef serving as the type/column source.
 * @param procs               The `def({ ... })` block to compile.
 * @param tableNameOverrides  Optional table → model-type name overrides.
 * @param options.sourcePath  Path to display in the generated module header.
 */
export function compileProcs(
  schema: SchemaDef,
  procs: ProcDefs,
  tableNameOverrides: Record<string, string> = {},
  options: { sourcePath?: string; lookups?: Map<string, Record<string, unknown>[]> } = {},
): CompiledProcs {
  const ctx: CompileContext = {
    schema,
    overrides: tableNameOverrides,
    lookups: options.lookups ?? new Map(),
  };
  const entries = Object.entries(procs);

  const queries: Record<string, string> = {};
  const typeLines: string[] = [];
  const dbTypes = new Set<string>();
  const modelTypes = new Set<string>();

  for (const [name, proc] of entries) {
    const compiled =
      proc.kind === "lookup"
        ? compileLookup(ctx, name, proc.config)
        : compileAction(ctx, name, proc.config);
    queries[name] = compiled.sql;
    typeLines.push(
      `  ${name}: { params: ${compiled.paramsTs}; result: ${compiled.resultTs} };`,
    );
    for (const t of compiled.dbTypes) dbTypes.add(t);
    for (const t of compiled.modelTypes) modelTypes.add(t);
  }

  return {
    queries,
    moduleText: renderModule(
      options.sourcePath ?? "src/domains/<domain>/procs.ts",
      typeLines,
      queries,
      dbTypes,
      modelTypes,
    ),
  };
}

// ---------------------------------------------------------------------------
// Table / column resolution
// ---------------------------------------------------------------------------

function resolveTable(
  ctx: CompileContext,
  name: string,
  forProc: string,
): TableDef {
  const table = ctx.schema.tables.find((t) => t.name === name);
  if (!table) {
    throw new Error(`[${forProc}] references unknown table "${name}"`);
  }
  return table;
}

function resolveColumn(
  ctx: CompileContext,
  tableName: string,
  columnName: string,
  forProc: string,
): ColumnDef {
  const table = resolveTable(ctx, tableName, forProc);
  const col = table.columns.find((c) => c.name === columnName);
  if (!col) {
    throw new Error(
      `[${forProc}] table "${tableName}" has no column "${columnName}"`,
    );
  }
  return col;
}

function tableModelType(ctx: CompileContext, tableName: string): string {
  return tableNameToTypeName(tableName, ctx.overrides);
}

function columnTs(ctx: CompileContext, table: string, column: string, proc: string): string {
  return columnToTsType(resolveColumn(ctx, table, column, proc), ctx.lookups);
}

// ---------------------------------------------------------------------------
// Param collection
// ---------------------------------------------------------------------------

/** Validate a parameter name (explicit `param(type, name)` or key-derived)
 *  against the placeholder grammar. Returns it unchanged. */
function assertParamName(name: string, proc: string): string {
  if (!/^\w+$/.test(name)) {
    throw new Error(
      `[${proc}] parameter name "${name}" is not a valid identifier`,
    );
  }
  return name;
}

/** Register a param, returning its SQL placeholder. Infers its type when the
 *  spec carries none, using the column the key resolves to (if it can). */
function paramPlaceholder(
  collect: ParamsCollector,
  key: string,
  spec: ParamSpec,
  resolveType: () => string | null,
  proc: string,
): string {
  // An explicit param(type, name) overrides the basename-derived name, so a
  // join where both sides share a column name can bind independently.
  const name = assertParamName(spec.name ?? key.split(".").pop()!, proc);
  if (collect.params.has(name)) {
    throw new Error(
      `[${proc}] duplicate parameter name "@${name}" — qualify or rename the key, or give the param an explicit name: param(type, "name")`,
    );
  }
  const type = spec.type ?? resolveType();
  if (!type) {
    throw new Error(
      `[${proc}] cannot infer the type of "@${name}" — use param("type"|"type | null")`,
    );
  }
  collect.params.set(name, type);
  return `@${name}`;
}

/** Serialize a non-param, non-fragment value as an inline SQL literal. */
function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function compileLookup(
  ctx: CompileContext,
  name: string,
  cfg: LookupConfig,
): CompiledProc {
  if (cfg.from.length === 0) throw new Error(`[${name}] lookup requires from`);
  const collect: ParamsCollector = { params: new Map() };

  // alias/table map for projections and WHERE type resolution.
  const tableOf = new Map<string, string>();
  for (const ref of cfg.from) {
    const table = "join" in ref ? ref.join : ref.table;
    resolveTable(ctx, table, name); // fail fast on typos
    const alias = ref.as ?? table;
    tableOf.set(alias, table);
  }

  // FROM / JOIN clauses.
  const fromSql: string[] = [];
  for (const ref of cfg.from) {
    if ("join" in ref) {
      const kind = (ref.kind ?? "inner").toUpperCase();
      const alias = ref.as ? ` ${ref.as}` : "";
      fromSql.push(`${kind} JOIN ${ref.join}${alias} ON ${ref.on.__sql}`);
    } else {
      fromSql.push(`${ref.table}${ref.as ? ` ${ref.as}` : ""}`);
    }
  }

  // Projections → result members; `x.*` references whole model interfaces.
  const wildcards: string[] = [];
  const members: { name: string; type: string }[] = [];
  const dbTypes = new Set<string>();

  for (const projection of cfg.select) {
    const text = isSql(projection) ? projection.__sql : projection;
    const m = text.trim().match(/^(.*?)\s+AS\s+(\w+)$/i);
    const expr = (m?.[1] ?? text).trim();
    const alias = m?.[2];

    if (expr === "*") {
      if (tableOf.size > 1) {
        throw new Error(
          `[${name}] bare "*" projection in a multi-table lookup would type as one table only — qualify it (e.g. "t.*") or list explicit columns`,
        );
      }
      const table = [...tableOf.values()][0];
      const t = tableModelType(ctx, table);
      dbTypes.add(t);
      wildcards.push(t);
    } else if (/^(\w+)\.\*$/.test(expr)) {
      const table = tableOf.get(expr.replace(/\.\*$/, ""));
      if (!table) throw new Error(`[${name}] unknown alias in projection "${expr}"`);
      const t = tableModelType(ctx, table);
      dbTypes.add(t);
      wildcards.push(t);
    } else if (/^(\w+)\.(\w+)$/.test(expr)) {
      const [, a, col] = expr.match(/^(\w+)\.(\w+)$/)!;
      const table = tableOf.get(a);
      if (!table) throw new Error(`[${name}] unknown alias "${a}" in projection "${expr}"`);
      members.push({ name: alias ?? col, type: columnTs(ctx, table, col, name) });
    } else if (alias) {
      members.push({ name: alias, type: "unknown" });
    }
    // Unaliased bare expressions contribute no typed member.
  }

  let resultTs: string;
  if (wildcards.length > 0) {
    const base = wildcards.join(" & ");
    resultTs = members.length > 0
      ? `${base} & { ${members.map((x) => `${x.name}: ${x.type}`).join("; ")} }`
      : base;
  } else if (members.length > 0) {
    resultTs = `{ ${members.map((x) => `${x.name}: ${x.type}`).join("; ")} }`;
  } else {
    resultTs = "unknown";
  }

  // WHERE.
  const whereSql: string[] = [];
  if (cfg.where) {
    for (const [key, slot] of Object.entries(cfg.where)) {
      if (isParam(slot)) {
        const resolveType = () => {
          if (key.includes(".")) {
            const [a, col] = key.split(".");
            const table = tableOf.get(a);
            return table ? columnTs(ctx, table, col, name) : null;
          }
          // Unqualified — only usable if exactly one FROM table has the column.
          const matches = [...tableOf.entries()].filter(
            ([, t]) => ctx.schema.tables
              .find((td) => td.name === t)?.columns.some((c) => c.name === key),
          );
          return matches.length === 1
            ? columnTs(ctx, matches[0][1], key, name)
            : null;
        };
        whereSql.push(`${key} = ${paramPlaceholder(collect, key, slot, resolveType, name)}`);
      } else if (isSql(slot)) {
        whereSql.push(`${key} ${slot.__sql}`);
      } else if (slot === null) {
        whereSql.push(`${key} IS NULL`);
      } else {
        whereSql.push(`${key} = ${sqlLiteral(slot)}`);
      }
    }
  }

  // GROUP BY / ORDER BY / LIMIT / OFFSET.
  const groupBy = cfg.groupBy
    ? ` GROUP BY ${cfg.groupBy.map((g) => (isSql(g) ? g.__sql : g)).join(", ")}`
    : "";
  const orderParts = Array.isArray(cfg.orderBy) ? cfg.orderBy : cfg.orderBy ? [cfg.orderBy] : [];
  const orderBy = orderParts.length > 0
    ? ` ORDER BY ${orderParts.map((o) => (isSql(o) ? o.__sql : o)).join(", ")}`
    : "";
  const limit = cfg.limit !== undefined
    ? (isParam(cfg.limit)
        ? ` LIMIT ${paramPlaceholder(collect, "limit", cfg.limit, () => "number", name)}`
        : ` LIMIT ${cfg.limit}`)
    : "";
  const offset = cfg.offset !== undefined
    ? (isParam(cfg.offset)
        ? ` OFFSET ${paramPlaceholder(collect, "offset", cfg.offset, () => "number", name)}`
        : ` OFFSET ${cfg.offset}`)
    : "";

  const where = whereSql.length > 0 ? `\nWHERE ${whereSql.join(" AND ")}` : "";
  const sql =
    `SELECT ${cfg.select.map((s) => (isSql(s) ? s.__sql : s)).join(", ")}\n` +
    `FROM ${fromSql.join(" ")}${where}${groupBy}${orderBy}${limit}${offset}`;

  return {
    sql,
    paramsTs: renderParamsTs(collect),
    resultTs,
    dbTypes,
    modelTypes: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function compileAction(
  ctx: CompileContext,
  name: string,
  cfg: ActionConfig,
): CompiledProc {
  const collect: ParamsCollector = { params: new Map() };
  const dbTypes = new Set<string>();
  const table = resolveTable(ctx, cfg.into, name);

  const assertColumn = (col: string) => {
    if (!table.columns.some((c) => c.name === col)) {
      throw new Error(`[${name}] table "${cfg.into}" has no column "${col}"`);
    }
  };

  const valueSql = (col: string, slot: unknown): string => {
    if (isParam(slot)) {
      return paramPlaceholder(collect, col, slot, () => columnTs(ctx, cfg.into, col, name), name);
    }
    if (isSql(slot)) return slot.__sql;
    return sqlLiteral(slot as string | number | boolean | null);
  };

  let sql: string;
  const insertValues = cfg.values;
  if (insertValues) {
    const cols = Object.keys(insertValues);
    if (cols.length === 0) throw new Error(`[${name}] action INSERT requires values`);
    for (const c of cols) assertColumn(c);
    const vals = cols.map((c) => valueSql(c, insertValues[c]));
    sql = `INSERT INTO ${cfg.into} (${cols.join(", ")})\nVALUES (${vals.join(", ")})`;
  } else {
    const cols = Object.keys(cfg.set!);
    if (cols.length === 0) throw new Error(`[${name}] action UPDATE requires set`);
    for (const c of cols) assertColumn(c);
    const sets = cols.map((c) => `${c} = ${valueSql(c, cfg.set![c])}`);
    const wheres = renderWhere(
      cfg.where!,
      collect,
      (key: string) => columnTs(ctx, cfg.into, key, name),
      name,
    );
    sql = `UPDATE ${cfg.into}\nSET ${sets.join(", ")}\nWHERE ${wheres.join(" AND ")}`;
  }

  // Result: RETURNING columns → typed row; otherwise void.
  let resultTs = "void";
  if (cfg.returning && cfg.returning.length > 0) {
    if (cfg.returning.length === 1 && cfg.returning[0] === "*") {
      resultTs = tableModelType(ctx, cfg.into);
      dbTypes.add(resultTs);
    } else {
      const members = cfg.returning.map((col) => {
        if (col === "*") throw new Error(`[${name}] mix "*" with named columns in returning`);
        assertColumn(col);
        return `${col}: ${columnTs(ctx, cfg.into, col, name)}`;
      });
      resultTs = `{ ${members.join("; ")} }`;
    }
    sql += ` RETURNING ${cfg.returning.join(", ")}`;
  }

  return {
    sql,
    paramsTs: renderParamsTs(collect),
    resultTs,
    dbTypes,
    modelTypes: new Set(),
  };
}

function renderWhere(
  where: Record<string, unknown>,
  collect: ParamsCollector,
  columnTsFor: (key: string) => string | null,
  proc: string,
): string[] {
  const out: string[] = [];
  for (const [key, slot] of Object.entries(where)) {
    if (isParam(slot)) {
      out.push(`${key} = ${paramPlaceholder(collect, key, slot, () => columnTsFor(key), proc)}`);
    } else if (isSql(slot)) {
      out.push(`${key} ${slot.__sql}`);
    } else if (slot === null) {
      out.push(`${key} IS NULL`);
    } else {
      out.push(`${key} = ${sqlLiteral(slot as string | number | boolean)}`);
    }
  }
  return out;
}

function renderParamsTs(collect: ParamsCollector): string {
  if (collect.params.size === 0) return "{}";
  const body = [...collect.params.entries()]
    .map(([n, t]) => `${n}: ${t}`)
    .join("; ");
  return `{ ${body} }`;
}

// ---------------------------------------------------------------------------
// Module emission
// ---------------------------------------------------------------------------

/** Map a param/result type tag to possible origins: primitives inline, other
 *  capitalized names imported from the domain's model. */
const INLINE_TYPES = new Set([
  "string", "number", "boolean", "null", "unknown", "any", "void", "ArrayBuffer",
]);

export function isInlineType(t: string): boolean {
  if (INLINE_TYPES.has(t)) return true;
  return /["`[|]/.test(t); // unions, literals, arrays, generics
}

function tsImportMap(
  dbTypes: Set<string>,
  modelTypes: Set<string>,
  fromPath: string,
): string {
  const lines: string[] = [];
  if (dbTypes.size > 0) lines.push(`import type { ${[...dbTypes].sort().join(", ")} } from "${fromPath}/db-types";`);
  if (modelTypes.size > 0) lines.push(`import type { ${[...modelTypes].sort().join(", ")} } from "${fromPath}/model";`);
  return lines.join("\n");
}

function renderModule(
  sourcePath: string,
  typeLines: string[],
  queries: Record<string, string>,
  dbTypes: Set<string>,
  modelTypes: Set<string>,
): string {
  const header = `// AUTO-GENERATED by @spindle/spindle/fiber — do not edit\n// Derived from a TS procs block (${sourcePath})\n\n`;
  const imports = tsImportMap(dbTypes, modelTypes, "..");
  const procLines = Object.entries(queries)
    // Multi-line template literals render real newlines natively — no \n escapes.
    .map(([n, sql]) => `${n}: \`${sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`,`)
    .join("\n  ");

  return `${header}${imports ? imports + "\n" : ""}export interface ProcMap {\n${typeLines.join("\n")}\n}\n\nexport const procs = {\n  ${procLines}\n} as const;\n`;
}
