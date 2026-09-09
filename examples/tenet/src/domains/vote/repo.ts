import { RepositoryBase } from "@spindle/spindle/thread";
import type { VoteRow, VoteChoice } from "./model";
import { procs, type ProcMap } from "./procs.generated";

export interface VoteWithUserRow extends VoteRow {
  user_login: string;
  user_avatar: string | null;
}

export class VotesRepository extends RepositoryBase<VoteRow, ProcMap> {
  override readonly tableName = "votes";
  protected override readonly queries = procs;

  async listForTenet(tenetId: number): Promise<VoteWithUserRow[]> {
    return this.queryAll("listForTenet", { tenet_id: tenetId });
  }

  async upsert(
    tenetId: number,
    userId: number,
    choice: VoteChoice,
    reason: string | null,
  ): Promise<void> {
    const existing = await this.findOneBy({ tenet_id: tenetId, user_id: userId });

    if (existing) {
      await this.execute("updateVote", {
        id: existing.id,
        choice,
        reason,
      });
    } else {
      await this.execute("insertVote", {
        tenet_id: tenetId,
        user_id: userId,
        choice,
        reason,
      });
    }
  }
}

/** Factory function to create a VotesRepository with a database connection. */
export const votesRepo = (db: D1Database) => new VotesRepository(db);

