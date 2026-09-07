/**
 * Database schema — the single source of truth, declared in TypeScript.
 *
 * From this definition the build generates:
 *   - model interfaces (src/domains/db-types.d.ts)
 *   - a derived schema.sql (for tooling / manual wrangler d1 execute)
 *   - a runtime schema module consumed by applySchema() to reconcile the
 *     live D1 DB against this desired state (initialize or update in place).
 */
import { defineSchema, table, index, col } from "@spindle/spindle";

export const schema = defineSchema({
  tables: {
    users: table({
      id: col.integer().primaryKey().autoIncrement(),
      github_id: col.integer().notNull().unique(),
      login: col.text().notNull(),
      avatar_url: col.text().nullable(),
      name: col.text().nullable(),
      created_at: col
        .text()
        .notNull()
        .default("(datetime('now'))"),
      last_login_at: col
        .text()
        .notNull()
        .default("(datetime('now'))"),
    }),

    tenet_statuses: table({
      key: col.text().primaryKey(),
      label: col.text().nullable(),
    }),

    vote_choices: table({
      key: col.text().primaryKey(),
      label: col.text().nullable(),
    }),

    tenets: table({
      id: col.integer().primaryKey().autoIncrement(),
      title: col.text().notNull(),
      slug: col.text().notNull().unique(),
      status: col
        .text()
        .checkRef("tenet_statuses")
        .notNull()
        .default("'draft'"),
      context: col.text().notNull(),
      decision: col.text().nullable(),
      rationale: col.text().nullable(),
      proposed_by_id: col
        .integer()
        .notNull()
        .references("users", "id"),
      created_at: col
        .text()
        .notNull()
        .default("(datetime('now'))"),
      updated_at: col
        .text()
        .notNull()
        .default("(datetime('now'))"),
      superseded_by_id: col
        .integer()
        .references("tenets", "id"),
    }),

    tenet_options: table({
      id: col.integer().primaryKey().autoIncrement(),
      tenet_id: col
        .integer()
        .notNull()
        .references("tenets", "id", { onDelete: "CASCADE" }),
      title: col.text().notNull(),
      description: col.text().nullable(),
      pros: col.text().nullable(),
      cons: col.text().nullable(),
      sort_order: col.integer().notNull(),
    }),

    votes: table(
      {
        id: col.integer().primaryKey().autoIncrement(),
        tenet_id: col
          .integer()
          .notNull()
          .references("tenets", "id", { onDelete: "CASCADE" }),
        user_id: col
          .integer()
          .notNull()
          .references("users", "id"),
        choice: col
          .text()
          .checkRef("vote_choices")
          .notNull(),
        reason: col.text().nullable(),
        created_at: col
          .text()
          .notNull()
          .default("(datetime('now'))"),
        updated_at: col
          .text()
          .notNull()
          .default("(datetime('now'))"),
      },
      { unique: [["tenet_id", "user_id"]] },
    ),
  },

  indexes: {
    idx_tenets_slug: index({
      table: "tenets",
      columns: ["slug"],
      unique: true,
    }),
    idx_tenets_status: index({ table: "tenets", columns: ["status"] }),
    idx_votes_tenet: index({ table: "votes", columns: ["tenet_id"] }),
    idx_votes_user: index({ table: "votes", columns: ["user_id"] }),
    idx_options_tenet: index({ table: "tenet_options", columns: ["tenet_id"] }),
  },
});

/** The exported SchemaDef value is what the build/plugin serializes. */
export default schema;
