/**
 * js-mvc/sql compiler unit tests — SQL rendering + schema-driven type
 * inference, exercised against the same query shapes the app uses.
 */

import { describe, it, expect } from "vitest";
import { defineSchema, table, col } from "./schema";
import { def, lookup, action, param, sql } from "./index";
import { compileProcs } from "./compile";

const schema = defineSchema({
  tables: {
    users: table({
      id: col.integer().primaryKey().autoIncrement(),
      github_id: col.integer().notNull().unique(),
      login: col.text().notNull(),
      avatar_url: col.text().nullable(),
      name: col.text().nullable(),
      created_at: col.text().notNull().default("(datetime('now'))"),
      last_login_at: col.text().notNull().default("(datetime('now'))"),
    }),
    tenet_statuses: table({ key: col.text().primaryKey() }),
    vote_choices: table({ key: col.text().primaryKey() }),

    tenets: table({
      id: col.integer().primaryKey().autoIncrement(),
      title: col.text().notNull(),
      slug: col.text().notNull().unique(),
      status: col
        .text("status")
        .checkRef("tenet_statuses")
        .notNull()
        .default("'draft'"),
      context: col.text().notNull(),
      proposed_by_id: col.integer().notNull().references("users", "id"),
      created_at: col.text().notNull().default("(datetime('now'))"),
      updated_at: col.text().notNull().default("(datetime('now'))"),
    }),
    tenet_options: table({
      id: col.integer().primaryKey().autoIncrement(),
      tenet_id: col.integer().notNull().references("tenets", "id"),
      title: col.text().notNull(),
      description: col.text().nullable(),
      sort_order: col.integer().notNull(),
    }),
    votes: table({
      id: col.integer().primaryKey().autoIncrement(),
      tenet_id: col.integer().notNull().references("tenets", "id"),
      user_id: col.integer().notNull().references("users", "id"),
      choice: col.text().checkRef("vote_choices").notNull(),
      reason: col.text().nullable(),
      created_at: col.text().notNull().default("(datetime('now'))"),
    }),
  },
  indexes: {},
});

const LOOKUPS = new Map<string, Record<string, unknown>[]>([
  [
    "tenet_statuses",
    [
      { key: "draft" },
      { key: "voting" },
      { key: "accepted" },
      { key: "rejected" },
      { key: "implemented" },
      { key: "superseded" },
    ],
  ],
  ["vote_choices", [{ key: "approve" }, { key: "abstain" }, { key: "block" }]],
]);

const procs = def({
  listWithProposer: lookup({
    select: ["t.*", "u.login AS proposer_login", "u.avatar_url AS proposer_avatar"],
    from: [
      { table: "tenets", as: "t" },
      { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
    ],
    orderBy: sql`t.created_at DESC`,
  }),
  getWithProposer: lookup({
    select: ["t.*", "u.login AS proposer_login"],
    from: [
      { table: "tenets", as: "t" },
      { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
    ],
    where: { "t.slug": param() },
  }),
  getOptions: lookup({
    select: ["*"],
    from: [{ table: "tenet_options" }],
    where: { tenet_id: param() },
    orderBy: sql`sort_order`,
  }),
  insertOption: action({
    into: "tenet_options",
    values: {
      tenet_id: param(),
      title: param(),
      description: param(),
      sort_order: param(),
    },
    returning: ["id"],
  }),
  updateStatus: action({
    into: "tenets",
    set: { status: param(), updated_at: sql`datetime('now')` },
    where: { id: param() },
  }),
  listVoteChoices: lookup({
    select: ["v.*", "u.login AS user_login"],
    from: [
      { table: "votes", as: "v" },
      { join: "users", as: "u", on: sql`u.id = v.user_id` },
    ],
    where: { "v.tenet_id": param() },
    orderBy: ["v.created_at", sql`v.id`],
    limit: 10,
  }),
});

const out = compileProcs(schema, procs, {}, { sourcePath: "src/domains/test/procs.ts", lookups: LOOKUPS });

describe("compileProcs SQL rendering", () => {
  it("renders a parameterless lookup with joins and ordering", () => {
    expect(out.queries.listWithProposer).toBe(
      "SELECT t.*, u.login AS proposer_login, u.avatar_url AS proposer_avatar\nFROM tenets t INNER JOIN users u ON u.id = t.proposed_by_id ORDER BY t.created_at DESC",
    );
  });

  it("renders a parameterized lookup with @name placeholders", () => {
    expect(out.queries.getWithProposer).toContain("WHERE t.slug = @slug");
  });

  it("renders INSERT with typed params and RETURNING", () => {
    expect(out.queries.insertOption).toBe(
      "INSERT INTO tenet_options (tenet_id, title, description, sort_order)\nVALUES (@tenet_id, @title, @description, @sort_order) RETURNING id",
    );
  });

  it("renders UPDATE with a raw sql fragment value", () => {
    expect(out.queries.updateStatus).toBe(
      "UPDATE tenets\nSET status = @status, updated_at = datetime('now')\nWHERE id = @id",
    );
  });

  it("renders ORDER BY arrays and LIMIT", () => {
    expect(out.queries.listVoteChoices).toContain("ORDER BY v.created_at, v.id LIMIT 10");
  });
});

describe("compileProcs type inference", () => {
  it("merges wildcard model type with aliased column types", () => {
    expect(out.moduleText).toContain(
      "listWithProposer: { params: {}; result: Tenet & { proposer_login: string; proposer_avatar: string | null } };",
    );
  });

  it("infers param types from the bound columns", () => {
    expect(out.moduleText).toContain("getWithProposer: { params: { slug: string }");
    expect(out.moduleText).toContain("insertOption: { params: { tenet_id: number; title: string; description: string | null; sort_order: number }");
  });

  it("types RETURNING rows and leaves void actions alone", () => {
    expect(out.moduleText).toContain("updateStatus: { params: { status: \"draft\" | \"voting\" | \"accepted\" | \"rejected\" | \"implemented\" | \"superseded\"; id: number }; result: void };");
  });

  it("imports referenced model types from db-types", () => {
    expect(out.moduleText).toContain('import type { Tenet, TenetOption, Vote } from "../db-types";');
  });

  it("emits a procs const with the SQL as template literals", () => {
    expect(out.moduleText).toContain("export const procs = {");
    expect(out.moduleText).toContain("listWithProposer: `SELECT t.*, u.login AS proposer_login, u.avatar_url AS proposer_avatar");
  });
});

describe("compileProcs errors", () => {
  it("rejects unknown tables", () => {
    expect(() =>
      compileProcs(schema, def({ bad: lookup({ select: ["*"], from: [{ table: "ghosts" }] }) })),
    ).toThrow(/unknown table "ghosts"/);
  });

  it("rejects unknown columns", () => {
    expect(() =>
      compileProcs(schema, def({ bad: action({ into: "tenets", set: { nope: param() }, where: { id: param() } }) })),
    ).toThrow(/has no column "nope"/);
  });

  it("rejects a bare * projection on a multi-table lookup", () => {
    expect(() =>
      compileProcs(
        schema,
        def({
          bad: lookup({
            select: ["*"],
            from: [
              { table: "tenets", as: "t" },
              { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
            ],
          }),
        }),
      ),
    ).toThrow(/qualify it/);
  });

  it("rejects duplicate bare param names", () => {
    expect(() =>
      compileProcs(
        schema,
        def({
          bad: lookup({
            select: ["t.*"],
            from: [
              { table: "tenets", as: "t" },
              { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
            ],
            where: { "t.id": param(), "u.id": param() },
          }),
        }),
      ),
    ).toThrow(/duplicate parameter name "@id"/);
  });

  it("binds same-named join keys independently via explicit param names", () => {
    const dual = compileProcs(
      schema,
      def({
        dual: lookup({
          select: ["t.title", "u.login"],
          from: [
            { table: "tenets", as: "t" },
            { join: "users", as: "u", on: sql`u.id = t.proposed_by_id` },
          ],
          where: {
            "t.id": param("number", "tenet_id"),
            "u.id": param("number", "user_id"),
          },
        }),
      }),
      {},
      { sourcePath: "src/domains/test/procs.ts", lookups: LOOKUPS },
    );
    expect(dual.queries.dual).toContain("WHERE t.id = @tenet_id AND u.id = @user_id");
    expect(dual.moduleText).toContain(
      "dual: { params: { tenet_id: number; user_id: number }",
    );
  });

  it("rejects sql() interpolation", () => {
    expect(() => sql`u.id = ${"x"}`).toThrow(/interpolation/);
  });

  it("rejects UPDATE without where", () => {
    expect(() =>
      action({ into: "tenets", set: { status: param() } }),
    ).toThrow(/requires a where/);
  });
});
