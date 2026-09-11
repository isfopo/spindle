/**
 * RepositoryBase — abstract base for SQL repositories.
 *
 * Follows the same pattern as ControllerBase and BaseHandler.
 * Subclasses declare a table name and inherit generic CRUD.
 *
 * Database is injected via the constructor. Repos are created per-request
 * using factory functions (e.g., `tenetsRepo(db)`) rather than shared singletons.
 *
 * Named parameters: SQL files can use @paramName syntax. The helpers
 * below translate @name → ? and map named args to positional order
 * at runtime, since most SQL drivers only support positional binding.
 */

import type { Database, DbResult } from "@spindle/spindle/fiber";

export abstract class RepositoryBase<
  T extends { id: number },
  QM = {},
  DB extends Database = Database
> {
  /** Each repository declares its table name. */
  abstract readonly tableName: string;

  /** Optional query map for type-safe SQL queries. Override in subclasses that use .sql files. */
  protected readonly queries?: { [P in keyof QM]: string };

  /** The database connection for this repository instance. */
  protected readonly db: DB;

  /**
   * Subclasses inherit this constructor automatically — only override if you
   * need additional initialization logic beyond storing the db reference.
   */
  constructor(db: DB) {
    this.db = db;
  }

  // ── Static utilities ──────────────────────────────

  /**
   * Replace @paramName placeholders with ? and return the positional
   * values array. Handles repeated params (same name → same position).
   */
  static resolveNamedParams(
    sql: string,
    params: Record<string, unknown>,
  ): [string, unknown[]] {
    const paramOrder: string[] = [];
    const seen = new Set<string>();

    // Collect params in order of first appearance
    sql.replace(/@(\w+)/g, (_, name: string) => {
      if (!seen.has(name)) {
        seen.add(name);
        paramOrder.push(name);
      }
      return "";
    });

    // Replace @name with ?
    const resolved = sql.replace(/@(\w+)/g, "?");

    // Build positional array
    const values = paramOrder.map((name) => params[name]);

    return [resolved, values];
  }

  /** Check if value is a plain object (not null, array, Date, Map, Set, etc.). */
  static isPlainObject(v: unknown): v is Record<string, unknown> {
    return Object.prototype.toString.call(v) === "[object Object]";
  }

  /**
   * Validate an ORDER BY clause to prevent SQL injection.
   * Only allows column names (alphanumeric + underscore), commas,
   * spaces, and ASC/DESC keywords.
   *
   * @throws Error if the clause contains unsafe characters or patterns.
   */
  static validateOrderBy(orderBy: string): void {
    // Allow: column_name, column_name ASC, col1 DESC, col2 ASC, table.column
    const safe = /^[\w\s,.]+$/;
    if (!safe.test(orderBy)) {
      throw new Error(
        `Unsafe ORDER BY clause: "${orderBy}". ` +
        `Only column names, commas, spaces, and ASC/DESC are allowed.`,
      );
    }
    // Reject SQL keywords that could be used for injection
    const dangerous = /\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE|INTO|FROM|WHERE|HAVING|GROUP|ORDER|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AS|SET|VALUES)\b/i;
    // Allow ASC/DESC but reject other SQL keywords
    const stripped = orderBy
      .replace(/\bASC\b/gi, "")
      .replace(/\bDESC\b/gi, "");
    if (dangerous.test(stripped)) {
      throw new Error(
        `Unsafe ORDER BY clause: "${orderBy}". ` +
        `SQL keywords are not allowed in ORDER BY.`,
      );
    }
  }

  // ── Generic CRUD ──────────────────────────────────

  /** Find a single row by primary key. */
  async findById(id: number): Promise<T | null> {
    const row = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .first<T>();
    return row ?? null;
  }

  /**
   * Find all rows, optionally ordered and limited.
   *
   * @security `orderBy` is validated against a whitelist of safe patterns
   * (column names, commas, ASC/DESC). Never pass user input directly.
   */
  async findAll(options?: { orderBy?: string; limit?: number }): Promise<T[]> {
    let sql = `SELECT * FROM ${this.tableName}`;
    const params: unknown[] = [];
    if (options?.orderBy) {
      RepositoryBase.validateOrderBy(options.orderBy);
      sql += ` ORDER BY ${options.orderBy}`;
    }
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    const { results } = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return results ?? [];
  }

  /** Delete a row by primary key. Returns true if a row was deleted. */
  async delete(id: number): Promise<boolean> {
    const { meta } = await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .run();
    return (meta.changes ?? 0) > 0;
  }

  /** Count all rows in the table. */
  async count(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${this.tableName}`)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  /**
   * Generic create — builds INSERT from an object's keys.
   * Relies on the DB for defaults (auto-increment id, datetime, etc.).
   */
  async create(data: Partial<T>): Promise<T> {
    const keys = Object.keys(data as Record<string, unknown>);
    for (const key of keys) {
      RepositoryBase.validateColumnName(key);
    }
    const values = keys.map((k) => (data as Record<string, unknown>)[k]);
    const cols = keys.join(", ");
    const placeholders = keys.map(() => "?").join(", ");

    const { meta } = await this.db
      .prepare(
        `INSERT INTO ${this.tableName} (${cols}) VALUES (${placeholders})`,
      )
      .bind(...values)
      .run();

    return (await this.findById(Number(meta.last_row_id)))!;
  }

  /**
   * Generic update — builds SET from an object's keys.
   * Returns the updated row, or null if the row didn't exist.
   */
  async update(id: number, data: Partial<T>): Promise<T | null> {
    const keys = Object.keys(data as Record<string, unknown>);
    for (const key of keys) {
      RepositoryBase.validateColumnName(key);
    }
    const values = keys.map((k) => (data as Record<string, unknown>)[k]);
    const setClause = keys.map((k) => `${k} = ?`).join(", ");

    await this.db
      .prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`)
      .bind(...values, id)
      .run();

    return this.findById(id);
  }

  // ── Dynamic finders ────────────────────────────────

  /**
   * Find one row matching the given criteria.
   * Criteria keys are constrained to columns of T.
   *
   * Uses LIMIT 1 without ORDER BY — for deterministic results with non-unique
   * criteria, use `findAllBy` with explicit ordering instead.
   *
   * @throws Error if criteria is empty (prevents accidental full-table scans).
   *
   * @example
   *   await repo.findOneBy({ slug: "my-tenet" });
   *   await repo.findOneBy({ tenet_id: 1, user_id: 2 });
   */
  async findOneBy(criteria: Partial<T>): Promise<T | null> {
    const { where, values } = this._buildWhere(criteria);
    const row = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE ${where} LIMIT 1`)
      .bind(...values)
      .first<T>();
    return row ?? null;
  }

  /**
   * Find all rows matching the given criteria.
   * Criteria keys are constrained to columns of T.
   *
   * @throws Error if criteria is empty (prevents accidental full-table scans).
   *
   * @example
   *   await repo.findAllBy({ status: "voting" });
   *   await repo.findAllBy({ proposed_by_id: userId });
   */
  async findAllBy(criteria: Partial<T>): Promise<T[]> {
    const { where, values } = this._buildWhere(criteria);
    const { results } = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE ${where}`)
      .bind(...values)
      .all<T>();
    return results ?? [];
  }

  /**
   * Check if any row matches the given criteria.
   *
   * @throws Error if criteria is empty.
   *
   * @example
   *   const exists = await repo.existsBy({ slug: "my-tenet" });
   */
  async existsBy(criteria: Partial<T>): Promise<boolean> {
    const { where, values } = this._buildWhere(criteria);
    const row = await this.db
      .prepare(`SELECT 1 AS found FROM ${this.tableName} WHERE ${where} LIMIT 1`)
      .bind(...values)
      .first<{ found: number }>();
    return row?.found === 1;
  }

  /**
   * Delete all rows matching the given criteria.
   * Returns the number of rows deleted.
   *
   * @throws Error if criteria is empty (prevents accidental full-table deletes).
   *
   * @example
   *   await repo.deleteBy({ status: "draft" });
   */
  async deleteBy(criteria: Partial<T>): Promise<number> {
    const { where, values } = this._buildWhere(criteria);
    const { meta } = await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE ${where}`)
      .bind(...values)
      .run();
    return meta.changes ?? 0;
  }

  /**
   * Validate that a key is a safe SQL identifier.
   * Must start with a letter or underscore, followed by alphanumeric/underscore.
   * Prevents digit-leading names like "123abc" and injection via special characters.
   *
   * @throws Error if the key is not a safe SQL identifier.
   */
  static validateColumnName(key: string): void {
    const safeKey = /^[a-zA-Z_]\w*$/;
    if (!safeKey.test(key)) {
      throw new Error(`Unsafe column name: "${key}"`);
    }
  }

  /**
   * Build a WHERE clause and positional values from a criteria object.
   * Validates that keys are safe SQL identifiers and criteria is non-empty.
   * Handles null values correctly using IS NULL (since `col = NULL` is always false in SQL).
   */
  private _buildWhere(criteria: Partial<T>): { where: string; values: unknown[] } {
    const entries = Object.entries(criteria as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(
        "Empty criteria is not allowed. Use findAll() for unfiltered queries.",
      );
    }

    const clauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of entries) {
      RepositoryBase.validateColumnName(key);

      if (value === null) {
        // SQL: `col = NULL` is always false — use IS NULL instead
        clauses.push(`${key} IS NULL`);
      } else {
        clauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    return { where: clauses.join(" AND "), values };
  }

  // ── Typed query helpers (for use with generated QueryMap) ──

  /**
   * Type-safe SELECT returning at most one row.
   * Result and param types are inferred from the class-level QueryMap generic.
   *
   * Usage: `this.queryOne("findBySlug", { slug })`
   */
  protected queryOne<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<(QM[K] extends { result: infer R } ? R : unknown) | null> {
    if (!this.queries) {
      throw new Error("queries property not defined on this repository");
    }
    const sql = this.queries[name];
    const params = (args as unknown[])[0] as Record<string, unknown> | undefined;
    const [resolved, values] = this._resolveParams(sql, params ? [params] : []);
    return this.db
      .prepare(resolved)
      .bind(...values)
      .first<QM[K] extends { result: infer R } ? R : unknown>();
  }

  /**
   * Type-safe SELECT returning multiple rows.
   * Result and param types are inferred from the class-level QueryMap generic.
   *
   * Usage: `this.queryAll("listWithProposer")`
   */
  protected queryAll<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<(QM[K] extends { result: infer R } ? R : unknown)[]> {
    if (!this.queries) {
      throw new Error("queries property not defined on this repository");
    }
    const sql = this.queries[name];
    const params = (args as unknown[])[0] as Record<string, unknown> | undefined;
    const [resolved, values] = this._resolveParams(sql, params ? [params] : []);
    return this.db
      .prepare(resolved)
      .bind(...values)
      .all<QM[K] extends { result: infer R } ? R : unknown>()
      .then((r) => r.results);
  }

  /**
   * Type-safe INSERT/UPDATE/DELETE.
   * Param types are inferred from the class-level QueryMap generic.
   *
   * Usage: `this.execute("updateStatus", { id, status })`
   */
  protected execute<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<DbResult> {
    if (!this.queries) {
      throw new Error("queries property not defined on this repository");
    }
    const sql = this.queries[name];
    const params = (args as unknown[])[0] as Record<string, unknown> | undefined;
    const [resolved, values] = this._resolveParams(sql, params ? [params] : []);
    return this.db
      .prepare(resolved)
      .bind(...values)
      .run();
  }

  /**
   * Resolve params: if SQL uses @named syntax and a single plain-object
   * arg is passed, translate to positional. Otherwise pass through as-is.
   */
  private _resolveParams(sql: string, params: unknown[]): [string, unknown[]] {
    const hasNamed = /@\w+/.test(sql);
    const isNamedCall =
      hasNamed && params.length === 1 && RepositoryBase.isPlainObject(params[0]);

    if (isNamedCall) {
      return RepositoryBase.resolveNamedParams(sql, params[0] as Record<string, unknown>);
    }
    return [sql, params];
  }
}
