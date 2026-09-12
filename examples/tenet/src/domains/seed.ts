/**
 * Dev seed spec — describes the data sowed into the local D1 database.
 *
 * Compiled at dev/build time by fiberPlugin into a pure-data module
 * (src/.generated/seed.ts) and applied once on worker boot via applySeed().
 * The dataset only changes when this spec changes; reboots stay stable.
 *
 * Columns not listed here are inferred from the schema:
 *   - id (PK)                   → deterministic sequence
 *   - github_id / slug (unique) → unique generated values
 *   - proposed_by_id etc. (FK)  → sampled from the referenced table's rows
 *   - status / choice (checkRef)→ sampled from the lookup table's rows
 *   - created_at (DEFAULT)      → left to the column default
 *   - context, avatar_url, ...  → column-name heuristics (faker)
 *
 * Lookup tables use literal `rows()` — stable, content-like data that also
 * types checkRef columns as unions of their primary-key values.
 */
import { defineSeed, generate, rows, fake, seq } from "@spindle/spindle/fiber";
import { schemaDef } from "../.generated/schema";

export const seed = defineSeed(schemaDef, {
  tenet_statuses: rows([
    { key: "draft" },
    { key: "voting" },
    { key: "accepted" },
    { key: "rejected" },
    { key: "implemented" },
    { key: "superseded" },
  ]),

  vote_choices: rows([
    { key: "approve" },
    { key: "abstain" },
    { key: "block" },
  ]),

  users: generate(24, {
    login: fake("internet.username"),
    name: fake("person.fullName"),
  }),

  tenets: generate(12, {
    title: fake("lorem.sentence"),
  }),

  tenet_options: generate(36, {
    title: fake("word.noun"),
    sort_order: seq(),
  }),

  votes: generate(48),
});

export default seed;
