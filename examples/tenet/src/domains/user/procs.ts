/**
 * User stored queries — compiled once by sqlPlugin into static SQL with
 * schema-derived types (procs.generated.ts).
 */
import { defineSql } from "@spindle/spindle/fiber";
import type { Database } from "domains/db-types";

const { def, action, param, sql } = defineSql<Database>();

export const procs = def({
  updateFromGithub: action({
    into: "users",
    set: {
      login: param(),
      avatar_url: param(),
      name: param(),
      last_login_at: sql`datetime('now')`,
    },
    where: { id: param() },
  }),
});

export default procs;
