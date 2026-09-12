/**
 * Unit tests for the schema DSL and generators (pure — no DB required).
 * Covers: DSL → IR normalization/validation, IR → schema.sql, IR → types,
 * and table-name → type-name conversion.
 */

import { describe, it, expect } from "vitest";
import { defineSchema } from "./schema";
import { table } from "./table";
import { col } from "./column";
import { index } from "./indexes";
import { generateSchemaSqlContent } from "./generate-sql";
import { tableNameToTypeName, generateDbTypesContent } from "./generate-types";


const sampleSchema = defineSchema({
  tables: {
    users: table({
      id: col.integer().primaryKey().autoIncrement(),
      login: col.text().notNull(),
      avatar_url: col.text().nullable(),
      status: col.text().checkRef("user_statuses").notNull().default("'draft'"),
      created_at: col.text().notNull().default("(datetime('now'))"),
    }),
    user_statuses: table({
      key: col.text().primaryKey(),
    }),
    mice: table({
      id: col.integer().primaryKey().autoIncrement(),
      squeak_level: col.integer().notNull(),
    }),
  },
  indexes: [
    index({ name: "idx_users_login", table: "users", columns: ["login"], unique: true }),
    index({name: "idx_mice_level", table: "mice", columns: ["squeak_level DESC"] }),
  ],
});

describe("defineSchema", () => {
  it("falls back to the property key when no column name is given", () => {
    const schema = defineSchema({
      tables: {
        users: table({ id: col.integer().primaryKey() }),
      },
    });
    expect(schema.tables[0].name).toBe("users");
    expect(schema.tables[0].columns[0].name).toBe("id");
  });

  it("honors an explicit column name overriding the property key", () => {
    const schema = defineSchema({
      tables: {
        users: table({ id: col.integer("x").primaryKey() }),
      },
    });
    expect(schema.tables[0].columns[0].name).toBe("x");
  });

  it("assigns index names from object keys", () => {
    const schema = defineSchema({
      tables: {
        users: table({ id: col.integer().primaryKey() }),
      },
      indexes: [
        index({ name: "idx_u", table: "users", columns: ["id"] }),
      ],
    });
    expect(schema.indexes[0].name).toBe("idx_u");
  });

  it("rejects references to unknown tables", () => {
    expect(() =>
      defineSchema({
        tables: {
          users: table({
            id: col.integer().primaryKey(),
            friend_id: col.integer().references("nope", "id"),
          }),
        },
      }),
    ).toThrow(/unknown table "nope"/);
  });

  it("rejects an empty schema", () => {
    expect(() => defineSchema({ tables: {} })).toThrow(/at least one table/);
  });

  it("rejects a table without columns", () => {
    expect(() => table({})).toThrow(/at least one column/);
  });
});

describe("tableNameToTypeName", () => {
  it("converts plural underscore names to PascalCase singular", () => {
    expect(tableNameToTypeName("tenets")).toBe("Tenet");
    expect(tableNameToTypeName("tenet_options")).toBe("TenetOption");
    expect(tableNameToTypeName("users")).toBe("User");
  });

  it("respects overrides", () => {
    expect(tableNameToTypeName("mice", { mice: "Mouse" })).toBe("Mouse");
  });
});

describe("generateDbTypesContent", () => {
  it("generates model interfaces from the schema", () => {
    const content = generateDbTypesContent(sampleSchema, { mice: "Mouse" });
    expect(content).toContain("export interface User {");
    expect(content).toContain("login: string;");
    expect(content).toContain("avatar_url: string | null;");
    expect(content).toContain("export interface Mouse {");
    expect(content).toContain("squeak_level: number;");
    expect(content).toContain("export interface Database {");
    expect(content).toContain("users: User;");
    expect(content).toContain("mice: Mouse;");
    expect(content).toContain(`declare module "*.sql"`);
  });

  it("emits unions for checkRef columns from lookup rows", () => {
    const schema = defineSchema({
      tables: {
        votes: table({
          id: col.integer().primaryKey(),
          choice: col.text().checkRef("vote_choices").notNull(),
        }),
        vote_choices: table({ key: col.text().primaryKey() }),
      },
    });
    const lookups = new Map<string, Record<string, unknown>[]>();
    lookups.set("vote_choices", [{ key: "approve" }, { key: "abstain" }, { key: "block" }]);
    const content = generateDbTypesContent(schema, {}, lookups);
    expect(content).toContain(`choice: "approve" | "abstain" | "block";`);
  });

  it("falls back to the base type when a lookup has no seeded rows", () => {
    const schema = defineSchema({
      tables: {
        votes: table({
          id: col.integer().primaryKey(),
          choice: col.text().checkRef("vote_choices").notNull(),
        }),
        vote_choices: table({ key: col.text().primaryKey() }),
      },
    });
    const content = generateDbTypesContent(schema);
    expect(content).toContain("choice: string;");
  });
});

describe("generateSchemaSqlContent", () => {
  it("emits range CHECKs for numeric constraints", () => {
    const s = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey(),
          score: col.integer().between(0, 100).notNull(),
          stock: col.integer().greaterThan(0).notNull(),
        }),
      },
      indexes: [],
    });
    const sql = generateSchemaSqlContent(s);
    expect(sql).toContain('CHECK("score" >= 0 AND "score" <= 100)');
    expect(sql).toContain('CHECK("stock" > 0)');
  });

  it("emits idempotent CREATE TABLE/INDEX statements", () => {
    const sql = generateSchemaSqlContent(sampleSchema);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('REFERENCES "user_statuses"("key")');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_login"');
    expect(sql).toContain('ON "users"("login")');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_mice_level"');
  });

  it("emits FK references with ON DELETE CASCADE", () => {
    const schema = defineSchema({
      tables: {
        users: table({ id: col.integer().primaryKey() }),
        posts: table({
          id: col.integer().primaryKey(),
          user_id: col
            .integer("user_id")
            .notNull()
            .references("users", "id", { onDelete: "CASCADE" }),
        }),
      },
    });
    const sql = generateSchemaSqlContent(schema);
    expect(sql).toContain(
      'REFERENCES "users"("id") ON DELETE CASCADE',
    );
  });

  it("emits table-level unique constraints", () => {
    const schema = defineSchema({
      tables: {
        votes: table(
          {
            id: col.integer().primaryKey(),
            tenet_id: col.integer().notNull(),
            user_id: col.integer().notNull(),
          },
          { unique: [["tenet_id", "user_id"]] },
        ),
      },
    });
    const sql = generateSchemaSqlContent(schema);
    expect(sql).toContain('UNIQUE("tenet_id", "user_id")');
  });

  it("emits a bare range check with no bounds as a plain column", () => {
    const schema = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey(),
          score: col.integer(),
        }),
      },
    });
    const sql = generateSchemaSqlContent(schema);
    expect(sql).toContain('"score" INTEGER');
  });
});

describe("numeric range consolidation", () => {
  it("keeps the tightest bound when one side is constrained twice", () => {
    const s = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey(),
          score: col.integer().between(0, 100).greaterThan(5).notNull(),
          years: col.integer().greaterThan(5).between(0, 100).notNull(),
          stock: col.integer().between(1, 5).between(3, 8).notNull(),
        }),
      },
    });
    const find = (name: string) =>
      s.tables[0].columns.find((c) => c.name === name)!.check;

    const score = find("score");
    expect(score).toMatchObject({ kind: "range", greaterThan: 5, lessThanEqual: 100 });
    expect(score).not.toHaveProperty("greaterThanEqual");

    const years = find("years");
    expect(years).toMatchObject({ kind: "range", greaterThan: 5, lessThanEqual: 100 });
    expect(years).not.toHaveProperty("greaterThanEqual");

    const stock = find("stock");
    expect(stock).toMatchObject({ kind: "range", greaterThanEqual: 3, lessThanEqual: 5 });
    expect(stock).not.toHaveProperty("greaterThan");
    expect(stock).not.toHaveProperty("lessThan");
  });

  it("prefers an inclusive bound whose floor is strictly higher", () => {
    const s = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey(),
          score: col.integer().greaterThan(5).greaterThanEqual(10).notNull(),
        }),
      },
    });
    const check = s.tables[0].columns.find((c) => c.name === "score")!.check;
    expect(check).toMatchObject({ kind: "range", greaterThanEqual: 10 });
    expect(check).not.toHaveProperty("greaterThan");
  });

  it("rejects contradictory ranges at define time", () => {
    expect(() =>
      defineSchema({
        tables: {
          events: table({
            id: col.integer().primaryKey(),
            score: col.integer().greaterThan(10).lessThan(5),
          }),
        },
      }),
    ).toThrow(/lower bound 10 exceeds upper bound 5/);

    expect(() =>
      defineSchema({
        tables: {
          events: table({
            id: col.integer().primaryKey(),
            score: col.integer().greaterThanEqual(5).lessThan(5),
          }),
        },
      }),
    ).toThrow(/neither permits it/);
  });

  it("allows the bounds to meet when both are inclusive", () => {
    const s = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey(),
          score: col.integer().greaterThanEqual(5).lessThanEqual(5),
        }),
      },
    });
    const check = s.tables[0].columns.find((c) => c.name === "score")!.check;
    expect(check).toMatchObject({ kind: "range", greaterThanEqual: 5, lessThanEqual: 5 });
  });
});

describe("index normalization", () => {
  it("dedupes single-column unique indexes that repeat a column UNIQUE or PK", () => {
    const s = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          login: col.text().notNull().unique(),
          name: col.text().notNull(),
        }),
      },
      indexes: [
        // Dropped: UNIQUE repeats a column constraint (or the PK autoindex).
        index({ name: "idx_users_login", table: "users", columns: ["login"], unique: true }),
        index({ name: "idx_users_id", table: "users", columns: ["id"], unique: true }),
        // Kept: non-unique (query accelerator) and multi-column forms.
        index({ name: "idx_users_login_plain", table: "users", columns: ["login"] }),
        index({ name: "idx_users_name_id", table: "users", columns: ["login", "name"], unique: true }),
      ],
    });
    expect(s.indexes.map((i) => i.name)).toEqual([
      "idx_users_login_plain",
      "idx_users_name_id",
    ]);
  });
});
