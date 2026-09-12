/**
 * Column builder — the building block of a TypeScript-declared SQLite schema.
 *
 * Columns are composed with chained modifiers rather than raw SQL strings:
 *
 *   col.integer().primaryKey().autoIncrement()
 *   col.text().notNull().unique()
 *   col.text().checkRef("statuses").notNull().default("'draft'")
 *   col.integer().between(0, 100).notNull()
 *   col.integer().references("users", "id", { onDelete: "CASCADE" })
 *
 * Every modifier returns a new builder, so columns are immutable and safe to
 * reuse/derive in a declarative schema.
 */

import type { SqliteType, CheckDef, ReferenceDef } from "./schema";

export interface ColumnDef {
  name: string;
  sqliteType: SqliteType;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  default?: string;
  check?: CheckDef;
  references?: ReferenceDef;
  /**
   * If this column was renamed from an older name, the previous name. The
   * reconciliation layer uses this to map old data onto the new column during
   * a table rebuild — without it, a rename is indistinguishable from
   * add+drop and risks data loss.
   */
  renamedFrom?: string;
}

/** Minimal structural interface accepted as a column value. */
export interface ColumnBuilderLike {
  toColumnDef(name: string): ColumnDef;
}

export class ColumnBuilder {
  def: ColumnDef;

  private constructor(name: string, sqliteType: SqliteType) {
    this.def = {
      name,
      sqliteType,
      notNull: false,
      primaryKey: false,
    };
  }

  /** Create a new column builder. */
  static create(name: string, sqliteType: SqliteType): ColumnBuilder {
    return new ColumnBuilder(name, sqliteType);
  }

  /** Produce a copy of this builder with an updated definition. */
  private with(patch: Partial<ColumnDef>): ColumnBuilder {
    const next = new ColumnBuilder(this.def.name, this.def.sqliteType);
    next.def = { ...this.def, ...patch };
    return next;
  }

  notNull(): ColumnBuilder {
    return this.with({ notNull: true });
  }

  nullable(): ColumnBuilder {
    return this.with({ notNull: false });
  }

  primaryKey(): ColumnBuilder {
    return this.with({ primaryKey: true });
  }

  autoIncrement(): ColumnBuilder {
    return this.with({ autoIncrement: true });
  }

  unique(): ColumnBuilder {
    return this.with({ unique: true });
  }

  /** Raw default expression, e.g. `"'draft'"` or `"(datetime('now'))"`. */
  default(value: string): ColumnBuilder {
    return this.with({ default: value });
  }

  /**
   * Reference a lookup table's primary key — a referential enum. The DDL
   * emits a foreign key, the seed samples the lookup's rows, and typegen
   * derives a union from the lookup's seeded keys.
   * The referenced column is resolved to the lookup's PK at defineSchema time.
   */
  checkRef(table: string): ColumnBuilder {
    return this.with({ check: { kind: "ref", table, column: "" } });
  }

  /** Inclusive numeric bounds, e.g. between(0, 100) → CHECK (col >= 0 AND col <= 100). */
  between(min: number, max: number): ColumnBuilder {
    if (min > max) {
      throw new Error(`between(${min}, ${max}) — min must be <= max`);
    }
    return this.mergeRange({ greaterThanEqual: min, lessThanEqual: max });
  }

  /** CHECK (col > n) */
  greaterThan(n: number): ColumnBuilder {
    return this.mergeRange({ greaterThan: n });
  }

  /** CHECK (col < n) */
  lessThan(n: number): ColumnBuilder {
    return this.mergeRange({ lessThan: n });
  }

  /** CHECK (col >= n) */
  greaterThanEqual(n: number): ColumnBuilder {
    return this.mergeRange({ greaterThanEqual: n });
  }

  /** CHECK (col <= n) */
  lessThanEqual(n: number): ColumnBuilder {
    return this.mergeRange({ lessThanEqual: n });
  }

  /** Accumulate a numeric range constraint (immutable copy). Redundant looser
   *  bounds are consolidated away as tighter ones arrive (`between(0, 100)
   *  .greaterThan(5)` keeps only `> 5` below), and a range whose bounds can
   *  never be satisfied throws immediately. */
  private mergeRange(
    patch: Partial<Extract<CheckDef, { kind: "range" }>>,
  ): ColumnBuilder {
    const existing = this.def.check;
    const base: Extract<CheckDef, { kind: "range" }> =
      existing && existing.kind === "range"
        ? existing
        : { kind: "range" };

    let lower: Bound | undefined;
    let upper: Bound | undefined;
    const consider = (
      kind: "greaterThan" | "greaterThanEqual" | "lessThan" | "lessThanEqual",
      value: number | undefined,
    ) => {
      if (value === undefined) return;
      const bound: Bound = { kind, value };
      if (kind.startsWith("greater")) lower = addBound(lower, bound, true);
      else upper = addBound(upper, bound, false);
    };
    consider("greaterThan", base.greaterThan);
    consider("greaterThanEqual", base.greaterThanEqual);
    consider("lessThan", base.lessThan);
    consider("lessThanEqual", base.lessThanEqual);
    consider("greaterThan", patch.greaterThan);
    consider("greaterThanEqual", patch.greaterThanEqual);
    consider("lessThan", patch.lessThan);
    consider("lessThanEqual", patch.lessThanEqual);

    return this.with({ check: finalizeRange(lower, upper) });
  }

  references(
    table: string,
    column: string,
    opts: { onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION" } = {},
  ): ColumnBuilder {
    return this.with({
      references: { table, column, onDelete: opts.onDelete },
    });
  }

  /** Declare this column as a rename of a previous column name. */
  renamedFrom(previousName: string): ColumnBuilder {
    return this.with({ renamedFrom: previousName });
  }

  /**
   * Produce the final ColumnDef. An explicit name passed to the builder wins;
   * otherwise (no arg) the column takes the property key it was declared
   * under — so `table({ id: col.integer() })` is equivalent to
   * `table({ id: col.integer("id") })`.
   */
  toColumnDef(name: string): ColumnDef {
    return this.def.name ? { ...this.def } : { ...this.def, name };
  }
}

const make =
  (sqliteType: SqliteType) =>
  (name?: string): ColumnBuilder =>
    ColumnBuilder.create(name ?? "", sqliteType);

export const integer = make("INTEGER");
export const text = make("TEXT");
export const real = make("REAL");
export const blob = make("BLOB");

/** Convenience namespace: `col.integer("id")`. */
export const col = {
  integer,
  text,
  real,
  blob,
};

// ---------------------------------------------------------------------------
// Numeric-range consolidation
// ---------------------------------------------------------------------------

/** One numeric bound: which side and where, with its strictness. */
interface Bound {
  kind: "greaterThan" | "greaterThanEqual" | "lessThan" | "lessThanEqual";
  value: number;
}

function isStrict(b: Bound): boolean {
  return b.kind === "greaterThan" || b.kind === "lessThan";
}

function isInclusive(b: Bound): boolean {
  return !isStrict(b);
}

/**
 * Combine two bounds on the same side, keeping the tighter one. The floor of
 * `x >= 5` is higher than the floor of `x > 4`, and `x > 5 ∩ x >= 5` is
 * exactly `x > 5` — so on a boundary tie the strict form wins.
 */
function addBound(current: Bound | undefined, next: Bound, isLower: boolean): Bound {
  if (!current) return next;
  if (isLower ? current.value > next.value : current.value < next.value) return current;
  if (isLower ? next.value > current.value : next.value < current.value) return next;
  return isStrict(next) ? next : current;
}

/**
 * Validate the merged floor/ceiling pair and emit the canonical CheckDef.
 * Throws when no value can satisfy both (floor above ceiling, or the bounds
 * meet at a single point neither permits).
 */
function finalizeRange(
  lower: Bound | undefined,
  upper: Bound | undefined,
): Extract<CheckDef, { kind: "range" }> {
  if (lower && upper) {
    if (lower.value > upper.value) {
      throw new Error(
        `Contradictory numeric range: lower bound ${lower.value} exceeds upper bound ${upper.value}`,
      );
    }
    if (lower.value === upper.value && !(isInclusive(lower) && isInclusive(upper))) {
      throw new Error(
        `Contradictory numeric range: bounds meet at ${lower.value} but neither permits it`,
      );
    }
  }
  return {
    kind: "range",
    ...(lower?.kind === "greaterThan" ? { greaterThan: lower.value } : {}),
    ...(lower?.kind === "greaterThanEqual" ? { greaterThanEqual: lower.value } : {}),
    ...(upper?.kind === "lessThan" ? { lessThan: upper.value } : {}),
    ...(upper?.kind === "lessThanEqual" ? { lessThanEqual: upper.value } : {}),
  };
}
