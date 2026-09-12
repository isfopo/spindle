import type { Database } from "../index";

/**
 * Apply the schema migration. Safe to call multiple times (uses IF NOT EXISTS).
 * Strips SQL comments (single-line --) then splits on semicolons and executes
 * each statement individually.
 */
export async function applySql(
  db: Database,
  schemaSql: string,
): Promise<void> {
  // Remove single-line comments (--) before splitting on semicolons,
  // so that semicolons appearing inside comments don't create empty statements.
  const noComments = schemaSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  const statements = noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}
