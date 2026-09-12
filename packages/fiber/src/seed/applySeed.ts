/**
 * applySeed — runtime applier for compiled seed data.
 *
 * Runs lazily in the worker during DEV boot (after applySchema has ensured the
 * tables exist). It is an idempotent "sow once until the spec changes":
 *
 *   - reads a stored hash of the last successful seed
 *   - if it matches the compiled seed's hash AND every seeded table still has
 *     rows, it does nothing (boots stay quiet — no data churn)
 *   - otherwise it clears the seeded tables in FK-safe order and inserts the
 *     compiled rows, then records the hash
 *
 * A table rebuild by applySchema (which drops data) naturally triggers a
 * re-sow, because the "tables have rows" check fails.
 */

import type { Database, Statement } from "../index";
import type { SchemaDef } from "../schema";
import type { CompiledSeed } from "./compileSeed";
import { seedOrder } from "./compileSeed";

const STATE_TABLE = "_seed_state";
const STATE_NAME = "seed";

export async function applySeed(
  db: Database,
  schema: SchemaDef,
  seed: CompiledSeed,
): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS "${STATE_TABLE}" (name TEXT PRIMARY KEY, hash TEXT NOT NULL)`,
    )
    .run();

  const stored = await db
    .prepare(`SELECT hash FROM "${STATE_TABLE}" WHERE name = ?`)
    .bind(STATE_NAME)
    .first<{ hash: string }>();

  const names = seed.tables.map((t) => t.name);
  if (
    stored?.hash === seed.hash &&
    (await seededTablesIntact(db, seed))
  ) {
    return;
  }

  // Clear in reverse-FK order (children before parents), insert forward, and
  // record the marker hash — atomically when the binding supports batch, so an
  // interrupted sow can never leave the DB half-cleared with a stale hash.
  const statements: Statement[] = [];
  const order = seedOrder(schema, names);
  for (const name of [...order].reverse()) {
    statements.push(db.prepare(`DELETE FROM "${name}"`));
  }

  for (const table of seed.tables) {
    for (const row of table.rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const sql = `INSERT INTO "${table.name}" (${columns
        .map((c) => `"${c}"`)
        .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      statements.push(
        db
          .prepare(sql)
          .bind(...columns.map((c) => row[c] ?? null)),
      );
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT OR REPLACE INTO "${STATE_TABLE}" (name, hash) VALUES (?, ?)`,
      )
      .bind(STATE_NAME, seed.hash),
  );

  if (db.batch) {
    await db.batch(statements);
  } else {
    for (const stmt of statements) await stmt.run();
  }
}

async function seededTablesIntact(
  db: Database,
  seed: CompiledSeed,
): Promise<boolean> {
  for (const table of seed.tables) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS c FROM "${table.name}"`)
      .first<{ c: number }>();
    if ((row?.c ?? 0) === 0) return false;
  }
  return true;
}
