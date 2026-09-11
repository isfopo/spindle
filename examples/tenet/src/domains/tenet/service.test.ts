import { describe, it, expect, beforeAll } from "vitest";
import { tenetService } from "./service";
import { usersRepo } from "domains/user/repo";
import { ProposeTenetRequest } from "views/routes/Tenets/requests/ProposeTenetRequest";
import { VoteRequest } from "views/routes/Tenets/requests/VoteRequest";

import { env } from "cloudflare:workers";
import { applySchema } from "@spindle/spindle/fiber";
import { schemaDef } from "../../../src/.generated/schema";

beforeAll(async () => {
  // Reconcile the DB to the TypeScript schema definition (create tables).
  await applySchema(env.DB, schemaDef);

  // Seed a test user
  await usersRepo(env.DB).upsertFromGithub({
    id: 1,
    login: "testuser",
    avatar_url: null,
    name: "Test User",
  });
});

describe("TenetsService", () => {
  it("proposes a new tenet", async () => {
    const input = new ProposeTenetRequest({
      title: "Use React",
      context: "We need a UI framework",
      options: [
        { title: "React", pros: "Popular", cons: "Large" },
        { title: "Vue", pros: "Lightweight", cons: "Smaller" },
      ],
    });

    const detail = await tenetService.propose(env.DB, 1, input);

    expect(detail.title).toBe("Use React");
    expect(detail.options).toHaveLength(2);
    expect(detail.status).toBe("draft");
    expect(detail.proposedBy.login).toBe("testuser");
  });

  it("lists tenets", async () => {
    const result = await tenetService.list(env.DB);
    expect(result.tenets.length).toBeGreaterThanOrEqual(1);
    expect(result.tenets[0].title).toBe("Use React");
  });

  it("gets a tenet by slug", async () => {
    const detail = await tenetService.getBySlug(env.DB, "use-react");
    expect(detail).toBeDefined();
    expect(detail.title).toBe("Use React");
  });

  it("transitions from draft to voting", async () => {
    const detail = await tenetService.transitionStatus(
      env.DB,
      1,
      "use-react",
      "voting",
    );
    expect(detail.status).toBe("voting");
  });

  it("casts a vote", async () => {
    const input = new VoteRequest({ choice: "approve" });
    const detail = await tenetService.vote(env.DB, 1, "use-react", input);

    expect(detail.votes).toHaveLength(1);
    expect(detail.votes[0].choice).toBe("approve");
  });

  it("blocks require a reason", async () => {
    const input = new VoteRequest({ choice: "block" });
    expect(input.validate().valid).toBe(false);
    expect(input.validate().errors?.reason).toBeDefined();
  });

  it("rejects transition by non-proposer", async () => {
    // Create a second user
    await usersRepo(env.DB).upsertFromGithub({
      id: 2,
      login: "other",
      avatar_url: null,
      name: "Other User",
    });

    await expect(
      tenetService.transitionStatus(env.DB, 2, "use-react", "accepted"),
    ).rejects.toThrow("This transition is not allowed");
  });

  it("accepts a tenet", async () => {
    const detail = await tenetService.transitionStatus(
      env.DB,
      1,
      "use-react",
      "accepted",
    );
    expect(detail.status).toBe("accepted");
  });
});
