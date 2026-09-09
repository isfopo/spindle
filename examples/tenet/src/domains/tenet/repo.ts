import { RepositoryBase } from "@spindle/spindle/thread";
import { procs, type ProcMap } from "./procs.generated";
import type { Tenet } from "domains/db-types";
import type { TenetStatus } from "./model";

export class TenetsRepository extends RepositoryBase<Tenet, ProcMap> {
  override readonly tableName = "tenets";
  protected override readonly queries = procs;

  async getOptions(tenetId: number) {
    return this.queryAll("getOptions", { tenet_id: tenetId });
  }

  async listWithProposer() {
    return this.queryAll("listWithProposer");
  }

  async getWithProposer(slug: string) {
    return this.queryOne("getWithProposer", { slug });
  }

  async createWithOptions(
    tenet: {
      title: string;
      slug: string;
      context: string;
      proposed_by_id: number;
    },
    options: {
      title: string;
      description?: string;
      pros?: string;
      cons?: string;
    }[],
  ) {
    const row = await this.create(tenet as Partial<Tenet>);

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      await this.execute("insertOption", {
        tenet_id: row.id,
        title: opt.title,
        description: opt.description ?? null,
        pros: opt.pros ?? null,
        cons: opt.cons ?? null,
        sort_order: i,
      });
    }

    return row;
  }

  async updateStatus(id: number, status: TenetStatus): Promise<void> {
    await this.execute("updateStatus", { id, status });
  }
}

/** Factory function to create a TenetsRepository with a database connection. */
export const tenetsRepo = (db: D1Database) => new TenetsRepository(db);

