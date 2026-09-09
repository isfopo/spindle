import { RepositoryBase } from "@spindle/spindle/thread";
import type { UserRow } from "./model";
import { procs, type ProcMap } from "./procs.generated";

export class UsersRepository extends RepositoryBase<UserRow, ProcMap> {
  override readonly tableName = "users";
  protected override readonly queries = procs;

  /**
   * Upsert a user from GitHub profile data.
   * Returns the user row (either newly created or updated).
   */
  async upsertFromGithub(githubUser: {
    id: number;
    login: string;
    avatar_url: string | null;
    name: string | null;
  }): Promise<UserRow> {
    const existing = await this.findOneBy({ github_id: githubUser.id });

    if (existing) {
      await this.execute("updateFromGithub", {
        id: existing.id,
        login: githubUser.login,
        avatar_url: githubUser.avatar_url,
        name: githubUser.name,
      });
      return (await this.findById(existing.id))!;
    }

    return this.create({
      github_id: githubUser.id,
      login: githubUser.login,
      avatar_url: githubUser.avatar_url,
      name: githubUser.name,
    } as Partial<UserRow>);
  }
}

/** Factory function to create a UsersRepository with a database connection. */
export const usersRepo = (db: D1Database) => new UsersRepository(db);

