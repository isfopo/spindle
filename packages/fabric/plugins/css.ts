/**
 * CSS bundling logic for fabricPlugin.
 *
 * Combines all CSS source files (priority-ordered), inlines SVGs referenced
 * as `url("inline-svg:...")`, scopes `.module.css` class names, minifies with
 * clean-css, and writes a single bundle.
 */

import CleanCSS from "clean-css";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

export interface CssOptions {
  /**
   * Source directories to scan for CSS files (relative to project root or absolute).
   * @default ["src/views/styles", "src/views/components", "src/views/routes"]
   */
  sourceDirs?: string[];

  /**
   * Output directory for the bundled CSS (relative to project root or absolute).
   * @default "public/.generated/styles"
   */
  outDir?: string;

  /**
   * Output filename.
   * @default "index.css"
   */
  outFile?: string;

  /**
   * Priority files that should be included first (matched by basename).
   * @default ["variables.css", "themes.css", "reset.css", "layout.css"]
   */
  priorityFiles?: string[];

  /**
   * Paths to exclude from scanning.
   * @default ["/public/", "/.generated/"]
   */
  excludePaths?: string[];

  /**
   * SVG icon directory for inlining (relative to project root or absolute).
   * @default "src/assets"
   */
  svgIconDir?: string;

  /**
   * Whether to run the build during dev mode (configureServer).
   * When false, only runs during production builds (closeBundle).
   * @default true
   */
  runInDev?: boolean;

  /**
   * File path to touch after CSS rebuild to trigger HMR.
   * Set to false to disable HMR triggering.
   * @default "src/views/routes/Shared/Layout.tsx"
   */
  hmrTriggerFile?: string | false;
}

export interface ResolvedCssPaths {
  sourceDirs: string[];
  outDir: string;
  outFile: string;
  priorityFiles: string[];
  excludePaths: string[];
  svgIconDir: string;
  runInDev: boolean;
  hmrTriggerFile: string | false;
}

export function resolveCssPaths(
  projectRoot: string,
  options: CssOptions = {},
): ResolvedCssPaths {
  const toAbsolute = (p: string | undefined, fallback: string) =>
    p && p.startsWith("/") ? p : resolve(projectRoot, p ?? fallback);

  return {
    sourceDirs: (
      options.sourceDirs ?? [
        "src/views/styles",
        "src/views/components",
        "src/views/routes",
      ]
    ).map((d) => toAbsolute(d, d)),
    outDir: toAbsolute(options.outDir, "public/.generated/styles"),
    outFile: options.outFile ?? "index.css",
    priorityFiles: options.priorityFiles ?? [
      "variables.css",
      "themes.css",
      "reset.css",
      "layout.css",
    ],
    excludePaths: options.excludePaths ?? ["/public/", "/.generated/"],
    svgIconDir: toAbsolute(options.svgIconDir, "src/assets"),
    runInDev: options.runInDev ?? true,
    hmrTriggerFile:
      options.hmrTriggerFile === false
        ? false
        : toAbsolute(options.hmrTriggerFile, "src/views/routes/Shared/Layout.tsx"),
  };
}

function getFiles(dir: string, ext: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      getFiles(fullPath, ext, files);
    } else if (entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function inlineSVGs(
  css: string,
  cssFilePath: string,
  svgIconDir: string,
): string {
  const svgRefRegex = /url\(\s*["']?inline-svg:([^"')]+)["']?\s*\)/gi;

  return css.replace(svgRefRegex, (match, svgPath: string) => {
    try {
      let resolvedPath: string;
      if (svgPath.startsWith("./") || svgPath.startsWith("../")) {
        resolvedPath = resolve(dirname(cssFilePath), svgPath);
      } else {
        resolvedPath = resolve(svgIconDir, svgPath);
      }

      let svg = readFileSync(resolvedPath, "utf-8");

      svg = svg
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/>\s+</g, "><")
        .trim();

      const encoded = encodeURIComponent(svg)
        .replace(/%20/g, " ")
        .replace(/%3D/g, "=")
        .replace(/%3A/g, ":")
        .replace(/%2F/g, "/");

      return `url("data:image/svg+xml,${encoded}")`;
    } catch {
      console.warn(
        `Warning: Could not inline SVG ${svgPath} from ${cssFilePath}`,
      );
      return match;
    }
  });
}

function scopeCSSModules(css: string, filePath: string): string {
  const componentName = basename(dirname(filePath));

  const parts = css.split(/(url\([\s\S]*?\))/g);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;

      return part.replace(
        /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g,
        `.${componentName}_$1`,
      );
    })
    .join("");
}

function getCSSFiles(paths: ResolvedCssPaths): string[] {
  let cssFiles: string[] = [];

  for (const dir of paths.sourceDirs) {
    try {
      const found = getFiles(dir, ".css").filter(
        (f) => !paths.excludePaths.some((p) => f.includes(p)),
      );
      cssFiles = cssFiles.concat(found);
    } catch {
      // Directory doesn't exist yet
    }
  }

  return cssFiles.sort((a, b) => {
    const aName = basename(a);
    const bName = basename(b);

    const aPriority = paths.priorityFiles.indexOf(aName);
    const bPriority = paths.priorityFiles.indexOf(bName);

    if (aPriority !== -1 && bPriority !== -1) {
      return aPriority - bPriority;
    }
    if (aPriority !== -1) return -1;
    if (bPriority !== -1) return 1;

    return a.localeCompare(b);
  });
}

function combineCSS(paths: ResolvedCssPaths): string {
  const cssFiles = getCSSFiles(paths);

  console.log(`Found ${cssFiles.length} CSS source files:`);
  cssFiles.forEach((f) => console.log(`  - ${basename(f)}`));

  return cssFiles
    .map((f) => {
      try {
        let content = readFileSync(f, "utf-8");

        content = inlineSVGs(content, f, paths.svgIconDir);

        if (f.endsWith(".module.css")) {
          content = scopeCSSModules(content, f);
        }

        return content;
      } catch {
        console.warn(`Warning: Could not read ${f}`);
        return "";
      }
    })
    .join("\n\n");
}

/**
 * Build the CSS bundle and write it to the output directory.
 * Returns the minified CSS string.
 */
export function buildCss(paths: ResolvedCssPaths): string {
  mkdirSync(paths.outDir, { recursive: true });

  const fullCSS = combineCSS(paths);
  const minified = new CleanCSS().minify(fullCSS).styles;
  writeFileSync(resolve(paths.outDir, paths.outFile), minified);
  console.log(`\n✓ Full bundle: ${minified.length} bytes (minified)\n`);

  return minified;
}