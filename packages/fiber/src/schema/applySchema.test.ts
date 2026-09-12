/**
 * applySchema reconciliation tests against a real D1 binding (the actual
 * runtime target) via the Cloudflare Workers vitest pool.
 *
 * Verifies the core behavior:
 *   - fresh DB  → full schema applied (and idempotent)
 *   - additive  → new column added in place, data preserved
 *   - rename    → renamedFrom maps old column, data preserved
 *   - change    → auto table-rebuild, data preserved
 *   - indexes   → created / dropped to match desired state
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { applySchema } from "./applySchema";
import { defineSchema, SchemaDef } from "./schema";
import { table } from "./table";
import { col } from "./column";
import { index } from "./indexes";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drop every non-internal table so each test starts from a clean DB. */
async function resetDb(): Promise<void> {
  const tables = (
    await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    ).all<{ name: string }>()
  ).results.map((t) => t.name);
  // sqlite_master lists creation order (parents first), so drop in reverse —
  // children before parents — to satisfy D1's foreign-key enforcement.
  for (const name of [...tables].reverse()) {
    await env.DB.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
  }
}

async function scalar<T>(sql: string): Promise<T> {
  const row = await env.DB.prepare(sql).first();
  const values = row as Record<string, T>;
  return values[Object.keys(values)[0]];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseSchema = defineSchema({
  tables: {
    users: table({
      id: col.integer().primaryKey().autoIncrement(),
      login: col.text().notNull(),
      name: col.text().nullable(),
    }),
    posts: table({
      id: col.integer().primaryKey().autoIncrement(),
      user_id: col.integer().notNull().references("users", "id"),
      title: col.text().notNull(),
    }),
  },
  indexes: [
    index({ name: "idx_posts_user", table: "posts", columns: ["user_id"] }),
    index({ name: "idx_posts_title", table: "posts", columns: ["title"], unique: true }),
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applySchema", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the full schema on a fresh database and is idempotent", async () => {
    await applySchema(env.DB, baseSchema);

    const tableCount = await scalar<number>(
      `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    );
    expect(tableCount).toBe(2);

    const cols = (
      await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>()
    ).results.map((c) => c.name);
    expect(cols).toEqual(["id", "login", "name"]);

    const foreignKeys = (
      await env.DB.prepare("PRAGMA foreign_key_list(posts)").all<{
        table: string;
        from: string;
      }>()
    ).results;
    expect(foreignKeys[0]).toMatchObject({ table: "users", from: "user_id" });

    const idxNames = (
      await env.DB.prepare("PRAGMA index_list(posts)").all<{ name: string }>()
    ).results.map((i) => i.name);
    expect(idxNames).toContain("idx_posts_user");
    expect(idxNames).toContain("idx_posts_title");

    // Idempotent — a second apply is a no-op (no new tables, no errors).
    await applySchema(env.DB, baseSchema);
    const count2 = await scalar<number>(
      `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    );
    expect(count2).toBe(2);
  });

  it("adds a new column in place and preserves data", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(
      `INSERT INTO users (login, name) VALUES ('alice', 'Alice')`,
    ).run();

    const next = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          login: col.text().notNull(),
          name: col.text().nullable(),
          email: col.text().nullable(),
        }),
        posts: baseSchema.tables.find((t) => t.name === "posts")!,
      },
      indexes: baseSchema.indexes,
    });

    await applySchema(env.DB, next);

    const cols = (
      await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>()
    ).results.map((c) => c.name);
    expect(cols).toContain("email");

    const login = await scalar<string>(`SELECT login AS login FROM users`);
    expect(login).toBe("alice");
  });

  it("renames a column via renamedFrom and preserves data", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(
      `INSERT INTO users (login, name) VALUES ('bob', 'Bob')`,
    ).run();

    const next = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          username: col.text().notNull().renamedFrom("login"),
          name: col.text().nullable(),
        }),
        posts: baseSchema.tables.find((t) => t.name === "posts")!,
      },
      indexes: baseSchema.indexes,
    });

    await applySchema(env.DB, next);

    const cols = (
      await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>()
    ).results.map((c) => c.name);
    expect(cols).toEqual(["id", "username", "name"]);

    const username = await scalar<string>(
      `SELECT username AS username FROM users`,
    );
    expect(username).toBe("bob");
  });

  it("rebuilds a table for a constraint change and preserves data", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(
      `INSERT INTO users (login, name) VALUES ('carol', 'Carol')`,
    ).run();

    // name: nullable → NOT NULL (not addable/renameable in place → rebuild).
    const next = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          login: col.text().notNull(),
          name: col.text().notNull(),
        }),
        posts: baseSchema.tables.find((t) => t.name === "posts")!,
      },
      indexes: baseSchema.indexes,
    });

    await applySchema(env.DB, next);

    const cols = (
      await env.DB.prepare("PRAGMA table_info(users)").all<{
        name: string;
        notnull: number;
      }>()
    ).results;
    expect(cols.find((c) => c.name === "name")?.notnull).toBe(1);

    // Data survives the rebuild.
    const login = await scalar<string>(`SELECT login AS login FROM users`);
    expect(login).toBe("carol");
  });

  it("does not rebuild for defaults that differ only in parens (idempotent boot)", async () => {
    // SQLite un-parenthesizes stored DEFAULT expressions, so a desired
    // `(datetime('now'))` must compare equal to the live `datetime('now')` —
    // otherwise every boot rebuilds the table (and DROPs wedged parents).
    const withDefaults = defineSchema({
      tables: {
        events: table({
          id: col.integer().primaryKey().autoIncrement(),
          name: col.text().notNull(),
          created_at: col
            .text("created_at")
            .notNull()
            .default("(datetime('now'))"),
        }),
      },
      indexes: [],
    });

    await applySchema(env.DB, withDefaults);
    await env.DB.prepare(
      `INSERT INTO events (name) VALUES ('first')`,
    ).run();

    // Re-apply: must be a no-op (no rebuild), not "FOREIGN KEY / already exists".
    await applySchema(env.DB, withDefaults);

    const name = await scalar<string>(`SELECT name AS name FROM events`);
    expect(name).toBe("first");
    const staging = await scalar<number>(
      `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='events__new'`,
    );
    expect(staging).toBe(0);
  });

  it("rebuilds a referenced table without tripping FK enforcement", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(
      `INSERT INTO users (id, login, name) VALUES (1, 'erin', 'Erin')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO posts (user_id, title) VALUES (1, 'FK post')`,
    ).run();

    // Force a rebuild of users (name: nullable → NOT NULL) while posts rows
    // still reference it — this used to fail on DROP users with an FK error.
    const next = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          login: col.text().notNull(),
          name: col.text().notNull(),
        }),
        posts: baseSchema.tables.find((t) => t.name === "posts")!,
      },
      indexes: baseSchema.indexes,
    });

    await applySchema(env.DB, next);

    const post = await env.DB
      .prepare(`SELECT p.user_id AS uid, u.login AS login FROM posts p JOIN users u ON u.id = p.user_id LIMIT 1`)
      .first<{ uid: number; login: string }>();
    expect(post).toMatchObject({ uid: 1, login: "erin" });

    const staging = await scalar<number>(
      `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='users__new'`,
    );
    expect(staging).toBe(0);
  });

  it("recovers from a stale staging table left by an interrupted rebuild", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(
      `INSERT INTO users (login, name) VALUES ('dana', 'Dana')`,
    ).run();

    // Simulate a crashed rebuild: the __new staging table is left behind.
    await env.DB.prepare(
      `CREATE TABLE "users__new" (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL)`,
    ).run();

    // The change forces a rebuild; applySchema must drop the stale staging
    // table first instead of failing with "table users__new already exists".
    const next = defineSchema({
      tables: {
        users: table({
          id: col.integer().primaryKey().autoIncrement(),
          login: col.text().notNull(),
          name: col.text().notNull(),
        }),
        posts: baseSchema.tables.find((t) => t.name === "posts")!,
      },
      indexes: baseSchema.indexes,
    });

    await applySchema(env.DB, next);

    const login = await scalar<string>(`SELECT login AS login FROM users`);
    expect(login).toBe("dana");

    // The staging table is gone after the rebuild.
    const leftover = await scalar<number>(
      `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='users__new'`,
    );
    expect(leftover).toBe(0);
  });

  it("creates missing indexes and drops extra ones", async () => {
    await applySchema(env.DB, baseSchema);
    await env.DB.prepare(`CREATE INDEX idx_legacy_extra ON users(login)`).run();

    const next: SchemaDef = {
      tables: baseSchema.tables,
      indexes: [
        baseSchema.indexes.find((i) => i.name === "idx_posts_title")!,
        { name: "idx_posts_title2", table: "posts", columns: ["title"] },
      ],
    };

    await applySchema(env.DB, next);

    const postIdx = (
      await env.DB.prepare("PRAGMA index_list(posts)").all<{ name: string }>()
    ).results.map((i) => i.name);
    expect(postIdx).toContain("idx_posts_title");
    expect(postIdx).not.toContain("idx_posts_user");

    const userIdx = (
      await env.DB.prepare("PRAGMA index_list(users)").all<{ name: string }>()
    ).results.map((i) => i.name);
    expect(userIdx).not.toContain("idx_legacy_extra");
  });

  it("recreates a same-name index whose shape changed", async () => {
    await applySchema(env.DB, baseSchema); // idx_posts_title: UNIQUE(title)

    // Same name, different columns and unique flag. Comparing by name alone
    // would skip the change and leave the stale UNIQUE(title) in place.
    const next: SchemaDef = {
      tables: baseSchema.tables,
      indexes: [
        baseSchema.indexes.find((i) => i.name === "idx_posts_user")!,
        { name: "idx_posts_title", table: "posts", columns: ["user_id", "title"] },
      ],
    };

    await applySchema(env.DB, next);

    // The recreated index has the new column set ...
    const xinfo = async () => {
      const res = await env.DB
        .prepare(`PRAGMA index_xinfo("idx_posts_title")`)
        .all<{ seqno: number; name: string | null; desc: number; key: number }>();
      return (res.results ?? [])
        .filter((r) => r.key === 1)
        .sort((a, b) => a.seqno - b.seqno)
        .map((r) => ({ name: r.name, desc: r.desc }));
    };
    expect(await xinfo()).toEqual([
      { name: "user_id", desc: 0 },
      { name: "title", desc: 0 },
    ]);

    // ... and the UNIQUE flag from the old definition is gone.
    const list = await env.DB
      .prepare(`PRAGMA index_list(posts)`)
      .all<{ name: string; unique: number }>();
    expect(list.results?.find((i) => i.name === "idx_posts_title")?.unique).toBe(0);
  });
});
