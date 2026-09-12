/**
 * Stored-query compilation helpers for fiberPlugin.
 *
 *   src/domains/<domain>/procs.ts  →  src/domains/<domain>/procs.generated.ts
 *
 * For each `procs.ts`: bundle + execute the procs block, run compileProcs to
 * render SQL + ProcMap (schema-derived types), validate the rendered SQL with
 * node-sql-parser (warnings only), and write the module atomically.
 */

import { dirname, join, relative } from "path";
import { readdir, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build as esbuild } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import sqlParserPkg from "node-sql-parser";
import { compileProcs, type ProcDefs, type SchemaDef } from "../src";
import type { ResolvedFiberPaths } from "./options";

const { Parser } = sqlParserPkg;

/** Find every `procs.ts` under the given roots. */
export async function findProcsFiles(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules" &&
          entry.name !== ".generated"
        ) {
          await walk(full);
        }
      } else if (entry.isFile() && entry.name === "procs.ts") {
        out.push(full);
      }
    }
  }
  for (const root of roots) await walk(root);
  return out;
}

/** Bundle + execute a procs.ts (resolving the fiber DSL) to the ProcDefs. */
async function loadProcs(
  procsPath: string,
  projectRoot: string,
): Promise<ProcDefs> {
  const result = await esbuild({
    entryPoints: [procsPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const code = result.outputFiles[0].text;
  const tmpFile = join(
    tmpdir(),
    `spindle-procs-${createHash("sha1").update(procsPath).digest("hex").slice(0, 12)}-${Date.now()}.mjs`,
  );
  await writeFile(tmpFile, code, "utf-8");
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      procs?: ProcDefs;
      default?: ProcDefs;
    };
    const procs = mod.procs ?? mod.default;
    if (!procs) throw new Error(`No "procs" export found in ${procsPath}`);
    return procs;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

const sqlParser = new Parser();

/** Best-effort validation of the rendered SQL (warnings only — node-sql-parser
 *  has SQLite coverage gaps, so a failure may be a parser gap, not bad SQL). */
function validateSql(queries: Record<string, string>): void {
  for (const [name, sql] of Object.entries(queries)) {
    try {
      sqlParser.astify(sql.replace(/@\w+/g, "0"), { database: "SQLite" });
    } catch (e) {
      console.warn(
        `⚠ [fiber] "${name}" did not parse cleanly (may be a parser gap): ${(e as Error).message}`,
      );
    }
  }
}

/** The generated module path for a given procs source file. */
export function procsOutputFor(procsPath: string): string {
  return join(dirname(procsPath), "procs.generated.ts");
}

/** Compile every `procs.ts` under the configured dirs. */
export async function generateProcs(
  paths: ResolvedFiberPaths,
  schema: SchemaDef,
  lookups: Map<string, Record<string, unknown>[]>,
): Promise<string[]> {
  const files = await findProcsFiles(paths.procsDirs);
  const outputs: string[] = [];
  for (const file of files) {
    outputs.push(await generateForFile(paths, schema, file, lookups));
  }
  return outputs;
}

async function generateForFile(
  paths: ResolvedFiberPaths,
  schema: SchemaDef,
  procsPath: string,
  lookups: Map<string, Record<string, unknown>[]>,
): Promise<string> {
  const procs = await loadProcs(procsPath, paths.projectRoot);
  const sourcePath = relative(paths.projectRoot, procsPath).replace(/\\/g, "/");

  const compiled = compileProcs(schema, procs, {}, { sourcePath, lookups });
  validateSql(compiled.queries);

  const outputPath = procsOutputFor(procsPath);
  await mkdir(dirname(outputPath), { recursive: true });
  // Sweep orphaned temp files from interrupted writers, then write atomically.
  const dir = dirname(outputPath);
  for (const entry of await readdir(dir)) {
    if (entry.startsWith("procs.generated.ts.tmp-")) {
      await unlink(join(dir, entry)).catch(() => {});
    }
  }
  const tmp = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, compiled.moduleText, "utf-8");
  await rename(tmp, outputPath);
  console.log(
    `✓ Generated ${relative(paths.projectRoot, outputPath).replace(/\\/g, "/")}`,
  );
  return outputPath;
}