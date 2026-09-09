/**
 * Procs integration tests — the generated procs.generated.ts modules
 * executed against a real D1 binding, exercised through the repositories.
 *
 * This is the runtime proof for the TS-authored stored queries: the SQL
 * strings compiled by sqlPlugin must produce exactly the behavior the old
 * .sql files did (joins, named-param binding, RETURNING, updates).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { applySchema } from "@spindle/spindle/fiber";
import { applySeed } from "@spindle/spindle/fiber";
import { schemaDef } from "../../.generated/schema";
import { seedDef } from "../../.generated/seed";
import { tenetsRepo } from "./repo";
import { usersRepo } from "../user/repo";
import { votesRepo } from "../vote/repo";

/** Drop every non-internal table so each test starts from a clean DB. */
async function resetDb(): Promise<void> {
  const tables = (
    await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    ).all<{ name: string }>()
  ).results.map((t) => t.name);
  for (const name of [...tables].reverse()) {
    await env.DB.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
  }
}

beforeEach(async () => {
  await resetDb();
  await applySchema(env.DB, schemaDef);
});

describe("tenet procs", () => {
  it("lists tenets joined with their proposer", async () => {
    await applySeed(env.DB, schemaDef, seedDef);
    const rows = await tenetsRepo(env.DB).listWithProposer();
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(typeof r.proposer_login).toBe("string");
      expect(typeof r.id).toBe("number");
    }
  });

  it("fetches a single tenet by slug with its proposer", async () => {
    await applySeed(env.DB, schemaDef, seedDef);
    const slug = (await tenetsRepo(env.DB).findAll({ limit: 1 }))[0].slug;
    const row = await tenetsRepo(env.DB).getWithProposer(slug);
    expect(row).not.toBeNull();
    expect(row!.slug).toBe(slug);
  });

  it("returns a tenet's options ordered by sort_order", async () => {
    await applySeed(env.DB, schemaDef, seedDef);
    const tenet = (await tenetsRepo(env.DB).findAll({ limit: 1 }))[0];
    const options = await tenetsRepo(env.DB).getOptions(tenet.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].tenet_id).toBe(tenet.id);
  });

  it("creates a tenet with options via the generated insert returning ids", async () => {
    // Lookup tables (tenet_statuses, vote_choices) must be seeded — their rows
    // back the checkRef foreign keys on tenets.status / votes.choice.
    await applySeed(env.DB, schemaDef, seedDef);
    const user = await usersRepo(env.DB).create({
      github_id: 1001,
      login: "dev",
      name: null,
    });
    const row = await tenetsRepo(env.DB).createWithOptions(
      {
        title: "Use RPC over REST",
        slug: "use-rpc-over-rest",
        context: "We keep fetching too much data.",
        proposed_by_id: user.id,
      },
      [
        { title: "RPC", description: "Direct calls", pros: "Simple", cons: "Coupling" },
        { title: "REST", description: "Resources", pros: "Familiar", cons: "Verbose" },
      ],
    );
    expect(row.id).toBeGreaterThan(0);
    const options = await tenetsRepo(env.DB).getOptions(row.id);
    expect(options.map((o) => o.title).sort()).toEqual(["REST", "RPC"]);
    expect(options.map((o) => o.sort_order)).toEqual([0, 1]);
  });

  it("transitions status and stamps updated_at via the sql fragment", async () => {
    await applySeed(env.DB, schemaDef, seedDef);
    const tenet = (await tenetsRepo(env.DB).findAll({ limit: 1 }))[0];
    const before = tenet.status;
    await tenetsRepo(env.DB).updateStatus(tenet.id, "rejected");

    const after = (await tenetsRepo(env.DB).findById(tenet.id))!;
    expect(after.status).toBe("rejected");
    expect(after.status).not.toBe(before);
    expect(after.updated_at).toBeTruthy(); // datetime('now') from the DSL fragment
  });
});

describe("vote procs", () => {
  it("inserts then updates a vote, and lists with user info", async () => {
    await applySeed(env.DB, schemaDef, seedDef);
    const tenet = (await tenetsRepo(env.DB).findAll({ limit: 1 }))[0];
    const user = (await usersRepo(env.DB).findAll({ limit: 1 }))[0];

    await votesRepo(env.DB).upsert(tenet.id, user.id, "approve", null);
    const afterInsert = (await votesRepo(env.DB).findOneBy({
      tenet_id: tenet.id,
      user_id: user.id,
    }))!;
    expect(afterInsert.choice).toBe("approve");

    // Changing the vote exercises the UPDATE proc.
    await votesRepo(env.DB).upsert(tenet.id, user.id, "block", "Serious objection");
    const afterChange = (await votesRepo(env.DB).findOneBy({
      tenet_id: tenet.id,
      user_id: user.id,
    }))!;
    expect(afterChange.id).toBe(afterInsert.id);
    expect(afterChange.choice).toBe("block");
    expect(afterChange.reason).toBe("Serious objection");

    const listed = await votesRepo(env.DB).listForTenet(tenet.id);
    const ours = listed.find((v) => v.user_id === user.id)!;
    expect(ours.user_login).toBe(user.login);
    expect(ours.choice).toBe("block");
  });
});
