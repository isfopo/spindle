import { ServiceBase } from "@spindle/spindle/thread";
import { tenetsRepo } from "./repo";
import { votesRepo } from "domains/vote/repo";
import type { TenetRow, TenetOptionRow, TenetStatus } from "./model";
import type { VoteRow } from "domains/vote/model";
import type { ProposeTenetRequest } from "views/routes/Tenets/requests/ProposeTenetRequest";
import type { VoteRequest } from "views/routes/Tenets/requests/VoteRequest";

// ── Shared DTOs (consumed by HTML ViewBuilders and API controllers) ──

export interface UserInfo {
  id: number;
  login: string;
  avatarUrl: string | null;
  name: string | null;
}

export interface TenetSummary {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  proposedBy: UserInfo;
  createdAt: string;
}

export interface TenetDetail {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  context: string;
  decision: string | null;
  rationale: string | null;
  options: TenetOptionDetail[];
  votes: VoteDetail[];
  proposedBy: UserInfo;
  createdAt: string;
  updatedAt: string;
}

export interface TenetOptionDetail {
  id: number;
  title: string;
  description: string | null;
  pros: string | null;
  cons: string | null;
  sortOrder: number;
}

export interface VoteDetail {
  userId: number;
  user: UserInfo;
  choice: "approve" | "abstain" | "block";
  reason: string | null;
}

export interface TenetListResult {
  tenets: TenetSummary[];
}

// ── Service ──────────────────────────────────────

class TenetsService extends ServiceBase {
  async list(db: D1Database): Promise<TenetListResult> {
    const repo = tenetsRepo(db);
    const rows = await repo.listWithProposer();
    return {
      tenets: rows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        proposedBy: {
          id: r.proposed_by_id,
          login: r.proposer_login,
          avatarUrl: r.proposer_avatar,
          name: null,
        },
        createdAt: r.created_at,
      })),
    };
  }

  async getBySlug(db: D1Database, slug: string): Promise<TenetDetail> {
    const tenets = tenetsRepo(db);
    const votes = votesRepo(db);

    const row = await tenets.getWithProposer(slug);
    if (!row) this.notFound("Tenet not found");

    const options = await tenets.getOptions(row.id);
    const voteRows = await votes.listForTenet(row.id);

    return this.toDetail(row, options, voteRows);
  }

  async propose(
    db: D1Database,
    userId: number,
    input: ProposeTenetRequest,
  ): Promise<TenetDetail> {
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const tenet = await tenetsRepo(db).createWithOptions(
      {
        title: input.title,
        slug,
        context: input.context,
        proposed_by_id: userId,
      },
      input.options,
    );

    return this.getBySlug(db, tenet.slug);
  }

  async vote(
    db: D1Database,
    userId: number,
    slug: string,
    input: VoteRequest,
  ): Promise<TenetDetail> {
    const tenet = await tenetsRepo(db).findOneBy({ slug });
    if (!tenet) this.notFound("Tenet not found");
    this.require(tenet.status === "voting", "Tenet is not in voting phase");

    await votesRepo(db).upsert(
      tenet.id,
      userId,
      input.choice as "approve" | "abstain" | "block",
      input.reason || null,
    );

    return this.getBySlug(db, slug);
  }

  async transitionStatus(
    db: D1Database,
    userId: number,
    slug: string,
    newStatus: TenetStatus,
  ): Promise<TenetDetail> {
    const tenet = await tenetsRepo(db).findOneBy({ slug });
    if (!tenet) this.notFound("Tenet not found");
    this.require(
      this.canTransition(tenet, userId, newStatus),
      "This transition is not allowed",
    );

    await tenetsRepo(db).updateStatus(tenet.id, newStatus);
    return this.getBySlug(db, slug);
  }

  // ── Private helpers ────────────────────────────

  private canTransition(
    tenet: TenetRow,
    userId: number,
    to: TenetStatus,
  ): boolean {
    const isProposer = tenet.proposed_by_id === userId;
    const transitions: Record<TenetStatus, TenetStatus[]> = {
      draft: ["voting"],
      voting: ["accepted", "rejected"],
      accepted: ["implemented", "superseded"],
      rejected: [],
      implemented: ["superseded"],
      superseded: [],
    };
    const allowed = transitions[tenet.status] ?? [];
    return allowed.includes(to) && (to === "implemented" || isProposer);
  }

  private toDetail(
    row: TenetRow & { proposer_login: string; proposer_avatar: string | null },
    options: TenetOptionRow[],
    votes: VoteRow[],
  ): TenetDetail {
    const proposer: UserInfo = {
      id: row.proposed_by_id,
      login: row.proposer_login,
      avatarUrl: row.proposer_avatar,
      name: null,
    };

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      context: row.context,
      decision: row.decision,
      rationale: row.rationale,
      options: options.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        pros: o.pros,
        cons: o.cons,
        sortOrder: o.sort_order,
      })),
      votes: votes.map((v) => ({
        userId: v.user_id,
        user: { id: v.user_id, login: "", avatarUrl: null, name: null },
        choice: v.choice,
        reason: v.reason,
      })),
      proposedBy: proposer,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const tenetService = new TenetsService();

