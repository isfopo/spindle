/**
 * Compile-time regression guard for the typed SQL DSL (no runtime tests).
 *
 * tsc (`npm run check:type`) covers this file; vitest ignores it. The
 * `@ts-expect-error` lines fail the build if the checks stop firing — e.g. a
 * literal-widening regression in the FROM helpers would silently disarm the
 * column validation, and an "unused @ts-expect-error" error would flag it.
 */

import { defineSql } from "./spec";
import type { Database } from "./index";

const { lookup, action, param, sql, from, join} = defineSql<Database>();

// Positive cases must compile.
const ok = lookup({
  select: ["t.*", "u.login AS proposer_login", "*"],
  from: [from("tenets", "t"), join("users", "u", sql`u.id = t.proposed_by_id`)],
  where: { "t.slug": param(), "u.id": param() },
  orderBy: sql`t.created_at DESC`,
});
void ok;

const okBare = lookup({
  select: ["*", "title AS t"],
  from: [from("tenets")],
  where: { slug: param() },
});
void okBare;

const okAction = action({ into: "votes", values: { tenet_id: param(), choice: param() } });
void okAction;

// Unaliased join (2-arg form) uses its table name as the alias.
const okUnaliasedJoin = lookup({
  select: ["v.*", "users.login AS user_login"],
  from: [from("votes", "v"), join("users", sql`users.id = v.user_id`)],
  where: { "v.tenet_id": param() },
});
void okUnaliasedJoin;

// Positive: explicit param(type, name) disambiguates same-named join keys.
const okNamedParams = lookup({
  select: ["t.title", "u.login"],
  from: [from("tenets", "t"), join("users", "u", sql`u.id = t.proposed_by_id`)],
  where: {
    "t.id": param("number", "tenet_id"),
    "u.id": param("number", "user_id"),
  },
});
void okNamedParams;

// Negative cases must keep erroring.

// @ts-expect-error typo'd column on an aliased table
lookup({ select: ["u.logi"], from: [from("tenets", "t"), join("users", "u", sql`u.id = t.proposed_by_id`)], where: { "t.slug": param() } });

// @ts-expect-error unknown alias
lookup({ select: ["z.title"], from: [from("tenets", "t")], where: { "t.slug": param() } });

// @ts-expect-error bare where key on an aliased table
lookup({ select: ["t.*"], from: [from("tenets", "t")], where: { slug: param() } });

// @ts-expect-error qualified key not in the table's columns
lookup({ select: ["t.*"], from: [from("tenets", "t")], where: { "t.nope": param() } });

// @ts-expect-error unknown column on an unaliased join
lookup({ select: ["v.*", "users.logi"], from: [from("votes", "v"), join("users", sql`users.id = v.user_id`)], where: { "v.tenet_id": param() } });

// @ts-expect-error unknown column in action values
action({ into: "votes", values: { bogus: param() } });

// @ts-expect-error unknown column in action wheres
action({ into: "votes", set: { choice: param() }, where: { nope: param() } });

// @ts-expect-error unknown column in action returning
action({ into: "votes", values: { choice: param() }, returning: ["bogus"] });

// Positive: returning a real column of the target table compiles.
const okReturning = action({ into: "votes", values: { choice: param() }, returning: ["id"] });
void okReturning;
