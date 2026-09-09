/**
 * Vote stored queries — compiled once by sqlPlugin into static SQL with
 * schema-derived types (procs.generated.ts).
 */
import { defineSql } from "@spindle/spindle/fiber";
import type { Database } from "domains/db-types";

const { def, lookup, action, param, sql, from, join } = defineSql<Database>();

export const procs = def({
  insertVote: action({
    into: "votes",
    values: {
      tenet_id: param(),
      user_id: param(),
      choice: param(),
      reason: param(),
    },
  }),

  listForTenet: lookup({
    select: ["v.*", "u.login AS user_login", "u.avatar_url AS user_avatar"],
    from: [from("votes", "v"), join("users", "u", sql`u.id = v.user_id`)],
    where: { "v.tenet_id": param() },
    orderBy: sql`v.created_at`,
  }),

  updateVote: action({
    into: "votes",
    set: { choice: param(), reason: param(), updated_at: sql`datetime('now')` },
    where: { id: param() },
  }),
});

export default procs;
