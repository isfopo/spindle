/** Minimal database abstraction matching D1's API surface. */

export interface Database {
  prepare(sql: string): Statement;
  /**
   * Execute statements atomically in one implicit transaction (D1 batch).
   * Optional — callers that need atomicity fall back to sequential runs
   * when this is absent.
   */
  batch?(statements: Statement[]): Promise<unknown>;
}

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<DbResult>;
}

export interface DbResult {
  meta: { last_row_id: number; changes: number };
}

export * from "./spec";
export type * from "./spec";

export * from "./compile";
export type * from "./compile";

export * from "./schema";
export type * from "./schema";

export * from "./seed";
export type * from "./seed";
