/**
 * Seed compiler unit tests — determinism, strategy resolution, uniqueness,
 * FK sampling, defaults, and literal rows. Pure (no bindings).
 */

import { describe, it, expect } from "vitest";
import { defineSchema, table, col } from "../schema";

import {
  compileSeed,
  type CompiledSeed,
} from "./compileSeed";

import { defineSeed, generate, fake, pick, ref, seq, rows } from "./index";

const schema = defineSchema({
  tables: {
    users: table({
      id: col.integer().primaryKey().autoIncrement(),
      github_id: col.integer().notNull().unique(),
      login: col.text().notNull().unique(),
      name: col.text().nullable(),
    }),
    posts: table({
      id: col.integer().primaryKey().autoIncrement(),
      user_id: col.integer().notNull().references("users", "id"),
      title: col.text().notNull(),
      rank: col.integer().notNull(),
      created_at: col.text().notNull().default("(datetime('now'))"),
    }),
    likes: table(
      {
        id: col.integer().primaryKey().autoIncrement(),
        user_id: col.integer().notNull().references("users", "id"),
        post_id: col.integer().notNull().references("posts", "id"),
      },
      { unique: [["user_id", "post_id"]] },
    ),
  },
  indexes: {},
});

function makeSpec(users = 8, posts = 5, likes = 14) {
  return defineSeed(schema, {
    users: generate(users, {
      login: fake("internet.username"),
      name: fake("person.fullName"),
    }),
    posts: generate(posts, { title: fake("lorem.sentence") }),
    likes: generate(likes),
  });
}

function compile(users = 8, posts = 5, likes = 14, opts = {}): CompiledSeed {
  return compileSeed(makeSpec(users, posts, likes), opts);
}

describe("compileSeed", () => {
  it("is deterministic for a given spec and faker seed", () => {
    const a = compile();
    const b = compile();
    expect(a).toEqual(b);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("honors the faker seed option (different seed → different data)", () => {
    const a = compile(8, 5, 14, { seed: 1 });
    const b = compile(8, 5, 14, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("emits the requested row counts with sequential primary keys", () => {
    const out = compile();
    const users = out.tables.find((t) => t.name === "users")!.rows;
    expect(users).toHaveLength(8);
    expect(users.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("covers every column or omits only defaulted ones", () => {
    const out = compile();
    const post = out.tables.find((t) => t.name === "posts")!.rows[0];
    expect(post).toHaveProperty("id");
    expect(post).toHaveProperty("user_id");
    expect(post).toHaveProperty("title");
    expect(post).not.toHaveProperty("created_at"); // column DEFAULT
  });

  it("keeps unique columns unique", () => {
    const out = compile();
    const users = out.tables.find((t) => t.name === "users")!.rows;
    const logins = users.map((r) => r.login as string);
    const githubIds = users.map((r) => r.github_id as number);
    expect(new Set(logins).size).toBe(logins.length);
    expect(new Set(githubIds).size).toBe(githubIds.length);
  });

  it("samples FKs from referenced tables", () => {
    const out = compile();
    const userIds = out.tables.find((t) => t.name === "users")!.rows.map((r) => r.id);
    const posts = out.tables.find((t) => t.name === "posts")!.rows;
    for (const p of posts) expect(userIds).toContain(p.user_id);
  });

  it("enforces table-level unique groups (user_id, post_id)", () => {
    const out = compile();
    const likes = out.tables.find((t) => t.name === "likes")!.rows;
    const keys = likes.map((r) => `${r.user_id}:${r.post_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves explicit strategies (literals, pick)", () => {
    const spec = defineSeed(schema, {
      users: generate(2, {
        login: pick(["alpha", "beta", "gamma"]),
        name: "Alice Chen", // literal on a non-unique column
      }),
      posts: generate(0),
      likes: generate(0),
    });
    const out = compileSeed(spec);
    const users = out.tables.find((t) => t.name === "users")!.rows;

    expect(users.map((r) => r.id)).toEqual([1, 2]);
    expect(users.every((r) => r.name === "Alice Chen")).toBe(true);
    // pick() can repeat, so assert membership rather than a permutation.
    expect(users.every((r) => ["alpha", "beta", "gamma"].includes(r.login as string))).toBe(true);
    // Unique columns still produce unique values alongside overrides.
    expect(new Set(users.map((r) => r.github_id)).size).toBe(2);
  });

  it("resolves ref() and seq() strategies", () => {
    const spec = defineSeed(schema, {
      users: generate(3),
      posts: generate(4, {
        user_id: ref("users"),
        rank: seq(),
      }),
      likes: generate(0),
    });
    const out = compileSeed(spec);
    const users = out.tables.find((t) => t.name === "users")!.rows;
    const posts = out.tables.find((t) => t.name === "posts")!.rows;

    expect(posts.map((r) => r.rank)).toEqual([0, 1, 2, 3]); // seq() runs per table
    for (const p of posts) {
      expect(users.map((u) => u.id)).toContain(p.user_id);
    }
  });

  it("passes literal rows() through", () => {
    const spec = defineSeed(schema, {
      users: rows([
        { id: 1, github_id: 1001, login: "alice", name: "Alice Chen" },
        { id: 2, github_id: 1002, login: "bob", name: null },
      ]),
      posts: generate(0),
      likes: generate(0),
    });
    const out = compileSeed(spec);
    const users = out.tables.find((t) => t.name === "users")!.rows;
    expect(users).toEqual([
      { id: 1, github_id: 1001, login: "alice", name: "Alice Chen" },
      { id: 2, github_id: 1002, login: "bob", name: null },
    ]);
  });

  it("rejects literal rows with unknown columns", () => {
    const spec = defineSeed(schema, {
      users: rows([{ id: 1, login: "alice", nope: 1 }]),
      posts: generate(0),
      likes: generate(0),
    });
    expect(() => compileSeed(spec)).toThrow(/unknown column "nope"/);
  });

  it("projects self-referencing FKs to scalar PKs of earlier rows", () => {
    const s = defineSchema({
      tables: {
        cats: table({
          id: col.integer().primaryKey().autoIncrement(),
          name: col.text().notNull(),
          parent_id: col.integer().references("cats", "id"),
        }),
      },
      indexes: {},
    });
    const out = compileSeed(defineSeed(s, { cats: generate(6) }));
    const rows = out.tables.find((t) => t.name === "cats")!.rows;

    for (let i = 0; i < rows.length; i++) {
      const v = rows[i].parent_id;
      if (v === null || v === undefined) continue;
      expect(typeof v).toBe("number"); // a scalar PK, not the whole row object
      // FK-safe insert order: only rows generated earlier may be referenced.
      expect(rows.slice(0, i).map((r) => r.id)).toContain(v);
    }
    // The first row cannot reference anything (empty pool → null).
    expect(rows[0].parent_id).toBeNull();
  });

  it("rejects specs referencing unknown tables", () => {
    expect(() =>
      defineSeed(schema, { ghosts: generate(1) }),
    ).toThrow(/unknown table "ghosts"/);
  });

  it("fails fast when table-unique rows cannot satisfy the count", () => {
    const s = defineSchema({
      tables: {
        pairs: table(
          {
            id: col.integer().primaryKey().autoIncrement(),
            a: col.text().notNull(),
            b: col.text().notNull(),
          },
          { unique: [["a", "b"]] },
        ),
      },
      indexes: {},
    });
    // A 2x2 pick space has at most 4 distinct (a, b) pairs — 10 rows are
    // unsatisfiable. The compiler must throw instead of retrying forever.
    expect(() =>
      compileSeed(
        defineSeed(s, {
          pairs: generate(10, { a: pick(["x", "y"]), b: pick(["p", "q"]) }),
        }),
      ),
    ).toThrow(/Unable to generate 10 rows for "pairs"/);
  });

  it("rejects generate() overrides on primary key columns", () => {
    const spec = defineSeed(schema, {
      users: generate(2, { id: 100 }),
      posts: generate(0),
      likes: generate(0),
    });
    expect(() => compileSeed(spec)).toThrow(/Cannot override primary key "users\.id"/);
  });

  it("generates numeric range columns within their bounds", () => {
    const s = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey().autoIncrement(),
          score: col.integer().between(1, 10).notNull(),
        }),
      },
      indexes: {},
    });
    const out = compileSeed(defineSeed(s, { events: generate(30) }));
    const rows = out.tables.find((t) => t.name === "events")!.rows;
    for (const r of rows) {
      const score = Number(r.score);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
  });

  it("samples a checkRef column even when it has a column default", () => {
    const s = defineSchema({
      tables: {
        widgets: table({
          id: col.integer().primaryKey().autoIncrement(),
          status: col
            .text()
            .checkRef("widget_statuses")
            .notNull()
            .default("'draft'"),
        }),
        widget_statuses: table({ key: col.text().primaryKey() }),
      },
      indexes: {},
    });
    const out = compileSeed(
      defineSeed(s, {
        widget_statuses: rows([{ key: "draft" }, { key: "live" }, { key: "archived" }]),
        widgets: generate(40),
      }),
    );
    const statuses = out.tables
      .find((t) => t.name === "widgets")!.rows
      .map((r) => r.status as string);
    // Not everything flattens to the default — the lookup is sampled.
    expect(new Set(statuses).size).toBeGreaterThan(1);
    expect(statuses.every((v) => ["draft", "live", "archived"].includes(v))).toBe(true);
  });
});
