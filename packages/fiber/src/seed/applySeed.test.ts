/**
 * applySeed integration tests against a real D1 binding via the Cloudflare
 * Workers test pool — the same runtime target as the worker boot path.
 *
 * Covers: sowing a fresh DB, idempotency (quiet reboots), recovery after data
 * loss (e.g. a schema rebuild), and re-sowing when the seed spec changes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { applySchema } from "../schema/applySchema";
import { defineSeed, generate, fake, pick, seq, ref } from "./index";
import { compileSeed, type CompiledSeed } from "./compileSeed";
import { applySeed } from "./applySeed";
import { col, defineSchema, table } from "../schema";

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

/** Drop every non-internal table so each test starts from a clean DB. */
async function resetDb(): Promise<void> {
  const tables = (
    await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    ).all<{ name: string }>()
  ).results.map((t) => t.name);
  // sqlite_master lists creation order (parents created first), so drop in
  // reverse — children before parents — to satisfy foreign-key enforcement.
  for (const name of [...tables].reverse()) {
    await env.DB.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
  }
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).first<{ c: number }>();
  return row?.c ?? 0;
}

function makeSeed(users = 8, posts = 5, likes = 14): CompiledSeed {
  return compileSeed(
    defineSeed(schema, {
      users: generate(users, {
        login: fake("internet.username"),
        name: fake("person.fullName"),
      }),
      posts: generate(posts, { title: pick(["Hono", "D1", "CSS", "Zod", "Vite"]) }),
      likes: generate(likes, {
        user_id: ref("users"),
        post_id: ref("posts"),
      }),
    }),
  );
}

describe("applySeed", () => {
  beforeEach(async () => {
    await resetDb();
    // Mirror the worker boot order: schema first, then seed.
    await applySchema(env.DB, schema);
  });

  it("sows a fresh database and fills DB-defaulted columns", async () => {
    const seed = makeSeed();
    await applySeed(env.DB, schema, seed);

    expect(await count("users")).toBe(8);
    expect(await count("posts")).toBe(5);
    expect(await count("likes")).toBe(14);

    // created_at was omitted from rows → the DB default filled it.
    const post = await env.DB.prepare(`SELECT created_at AS c FROM posts LIMIT 1`).first<{ c: string }>();
    expect(post?.c).toBeTruthy();

    const state = await env.DB
      .prepare(`SELECT hash FROM _seed_state WHERE name = 'seed'`)
      .first<{ hash: string }>();
    expect(state?.hash).toBe(seed.hash);
  });

  it("is idempotent — a second apply changes nothing", async () => {
    const seed = makeSeed();
    await applySeed(env.DB, schema, seed);

    const before = (
      await env.DB.prepare(`SELECT id, login FROM users ORDER BY id`).all<{ id: number; login: string }>()
    ).results;

    await applySeed(env.DB, schema, seed);

    expect(await count("users")).toBe(8);
    const after = (
      await env.DB.prepare(`SELECT id, login FROM users ORDER BY id`).all<{ id: number; login: string }>()
    ).results;
    expect(after).toEqual(before);
  });

  it("re-sows when a seeded table loses data (e.g. schema rebuild)", async () => {
    const seed = makeSeed();
    await applySeed(env.DB, schema, seed);

    // Simulate data loss on the leaf table (no children reference it — a
    // plain DELETE from a parent would trip FK enforcement by design).
    await env.DB.prepare(`DELETE FROM likes`).run();
    expect(await count("likes")).toBe(0);

    await applySeed(env.DB, schema, seed);
    expect(await count("users")).toBe(8);
    expect(await count("posts")).toBe(5);
    expect(await count("likes")).toBe(14);
  });

  it("re-sows with new data when the seed spec changes", async () => {
    const first = makeSeed(6, 3, 6);
    await applySeed(env.DB, schema, first);
    expect(await count("users")).toBe(6);

    const second = makeSeed(10, 7, 20);
    await applySeed(env.DB, schema, second);

    expect(await count("users")).toBe(10);
    expect(await count("posts")).toBe(7);
    expect(await count("likes")).toBe(20);

    const state = await env.DB
      .prepare(`SELECT hash FROM _seed_state WHERE name = 'seed'`)
      .first<{ hash: string }>();
    expect(state?.hash).toBe(second.hash);
  });

  it("keeps foreign keys intact after re-sowing", async () => {
    const seed = makeSeed();
    await applySeed(env.DB, schema, seed);

    const userIds = (
      await env.DB.prepare(`SELECT id FROM users`).all<{ id: number }>()
    ).results.map((r) => r.id);
    const likes = (
      await env.DB.prepare(`SELECT user_id, post_id FROM likes`).all<{ user_id: number; post_id: number }>()
    ).results;

    for (const l of likes) {
      expect(userIds).toContain(l.user_id);
      const post = await env.DB
        .prepare(`SELECT id FROM posts WHERE id = ?`)
        .bind(l.post_id)
        .first();
      expect(post).not.toBeNull();
    }
  });
});
