/**
 * js-mvc/seed — declarative dev-database seeding.
 *
 *   defineSeed(schema, spec) → compiled at dev/build time by fiberPlugin into
 *   a pure-data module → applySeed(db, schema, seed) sows it on DEV boot.
 *
 * The faker library is used only by the compiler (build/dev tools); the
 * worker bundle contains plain row data.
 */

export { defineSeed, generate, rows } from "./spec";
export type {
  SeedSpec,
  TableSpec,
  TableGenerateSpec,
  TableRowsSpec,
} from "./spec";
export { fake, pick, ref, seq, isStrategy } from "./strategies";
export type {
  FakeStrategy,
  PickStrategy,
  RefStrategy,
  SeqStrategy,
  ValueStrategy,
  FakerProvider,
} from "./strategies";
export { compileSeed, seedOrder } from "./compileSeed";
export type {
  CompiledSeed,
  CompiledTable,
  CompileOptions,
} from "./compileSeed";
export { applySeed } from "./applySeed";
