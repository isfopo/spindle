import { resolve } from "path";

/** Options shared by the fiber data-layer generation (schema, seed, procs). */
export interface FiberPluginOptions {
  /**
   * Path to the TypeScript schema module (source of truth).
   * @default "src/domains/schema.ts"
   */
  schemaPath?: string;

  /**
   * Path to the seed spec, whose literal `rows()` type `checkRef` columns.
   * @default "src/domains/seed.ts"
   */
  seedPath?: string;

  /**
   * Directories scanned recursively for `procs.ts` files.
   * @default ["src/domains"]
   */
  procsDirs?: string[];

  /**
   * Output path for the generated model types.
   * @default "src/domains/db-types.d.ts"
   */
  dbTypesPath?: string;

  /**
   * Output path for the derived schema.sql (tooling / manual wrangler use).
   * @default "src/migrations/schema.sql"
   */
  schemaSqlPath?: string;

  /**
   * Output path for the generated runtime schema module the Worker imports.
   * @default "src/.generated/schema.ts"
   */
  runtimeSchemaPath?: string;

  /**
   * Output path for the compiled seed data module.
   * @default "src/.generated/seed.ts"
   */
  runtimeSeedPath?: string;

  /** Override automatic table name → type name conversions. */
  tableNameOverrides?: Record<string, string>;
}

export interface ResolvedFiberPaths {
  projectRoot: string;
  schemaPath: string;
  seedPath: string;
  procsDirs: string[];
  dbTypesPath: string;
  schemaSqlPath: string;
  runtimeSchemaPath: string;
  runtimeSeedPath: string;
  tableNameOverrides: Record<string, string>;
}

export function resolveFiberPaths(
  projectRoot: string,
  options: FiberPluginOptions = {},
): ResolvedFiberPaths {
  const toAbs = (p: string | undefined, fallback: string) =>
    p && p.startsWith("/") ? p : resolve(projectRoot, p ?? fallback);
  return {
    projectRoot,
    schemaPath: toAbs(options.schemaPath, "src/domains/schema.ts"),
    seedPath: toAbs(options.seedPath, "src/domains/seed.ts"),
    procsDirs: (options.procsDirs ?? ["src/domains"]).map((d) =>
      d.startsWith("/") ? d : resolve(projectRoot, d),
    ),
    dbTypesPath: toAbs(options.dbTypesPath, "src/domains/db-types.d.ts"),
    schemaSqlPath: toAbs(options.schemaSqlPath, "src/migrations/schema.sql"),
    runtimeSchemaPath: toAbs(
      options.runtimeSchemaPath,
      "src/.generated/schema.ts",
    ),
    runtimeSeedPath: toAbs(options.runtimeSeedPath, "src/.generated/seed.ts"),
    tableNameOverrides: options.tableNameOverrides ?? {},
  };
}