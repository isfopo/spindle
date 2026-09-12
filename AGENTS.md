# AGENTS.md — js-mvc

## Project

Cloudflare Worker using **Hono** with server-side JSX (`hono/jsx`). MVC architecture.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Deploy | `npm run build && wrangler deploy` |
| Build (for preview) | `npm run build` |
| Preview build | `npm run preview` |
| Generate Cloudflare binding types | `npm run cf-typegen` |
| Build CSS only | `npm run build:css` |

No linter or formatter yet.

### CSS Build Process

The CSS build is **automatic** with full HMR support:

1. **Development** (`npm run dev`):
   - CSS builds once at startup
   - Vite watches `src/views/styles/**/*.css`, `src/views/components/**/*.module.css`, and `src/views/routes/**/*.module.css`
   - On save: CSS rebuilds + Layout HMR updates instantly
   
2. **Production build** (`npm run build`): CSS builds, then Vite bundles

3. **Deploy** (`npm run deploy`): CSS builds → Vite builds → Wrangler deploys

**When to manually run `npm run build:css`:**
- To verify CSS output without starting the dev server
- In CI/CD pipelines if you need the CSS files before the main build

## Architecture

- **Entry point:** `src/index.tsx` — creates the `Hono` app, mounts controllers, and defines the root route directly.
- **Controllers** (`src/views/routes/*/controller.tsx`): Each controller extends `ControllerBase` from `js-mvc/controller/ControllerBase`, sets an override `base` string (the route prefix), declares routes via decorators, and calls `configureRendering({ layout, handleError })` in the constructor to wire up the shared layout and error handler.
- **API Controllers** (`src/views/routes/*/controller.api.tsx`): Same pattern but return JSON. Share business logic via services.
- **Views** (`src/views/routes/*/views/`): Top-level page components using `FC` from `hono/jsx` with typed ViewModel.
- **Components** (`src/views/components/`): Reusable UI pieces. Use `useHandler()` from `js-mvc/client/useHandler` for client-side handler wiring.
- **Services** (`src/domains/*/service.ts`): Business logic layer shared between HTML and API controllers. Extend `ServiceBase` from `js-mvc/service/ServiceBase`.
- **Repositories** (`src/domains/*/repo.ts`): Data access layer. Extend `RepositoryBase<T, QueryMap>` from `js-mvc/repository/RepositoryBase`. D1Database is injected via constructor; repos are created per-request using factory functions (e.g., `tenetsRepo(db)`). Inherit generic CRUD (`findById`, `findAll`, `create`, `update`, `delete`, `count`) and dynamic finders (`findOneBy`, `findAllBy`, `existsBy`, `deleteBy`). Stored queries are declared in `procs.ts` (the `js-mvc/sql` DSL) and compiled by `fiberPlugin` into a typed `ProcMap` — repos invoke them via typed `queryOne`/`queryAll`/`execute` with `@name` binding. See **Repository Security** below for validation details.
- **Models** (`src/domains/*/model.ts`): Row types matching D1 table columns.
- **Schema** (`src/domains/schema.ts`): The D1 schema source of truth, declared with the TS DSL (`defineSchema`/`table`/`col`/`index` from `js-mvc/schema`). `fiberPlugin` generates `src/domains/db-types.d.ts` (model interfaces), a derived `src/migrations/schema.sql` (gitignored), and the runtime module `src/.generated/schema.ts`. On first request `applySchema()` (`js-mvc/data/applySchema`) reconciles the live D1 DB against the desired state — adding columns in place, rebuilding tables for non-additive changes, syncing indexes. `.sql` **query** files are unaffected.
- **Dev seed** (`src/domains/seed.ts`): Declarative dev-database data via the `js-mvc/seed` DSL (`defineSeed`/`generate`/`rows` + `fake`/`pick`/`ref`/`seq`). Columns not overridden are inferred from the schema (PKs sequence, uniques stay unique, FKs sample the referenced table, CHECK columns pick from their enums, DEFAULT columns are left to the DB). `fiberPlugin` compiles the spec — the faker library (a devDependency) runs only in the plugin — into a pure-data module `src/.generated/seed.ts`; `applySeed()` (`js-mvc/seed`) sows it on DEV boot, re-sowing only when the spec's hash changes or a seeded table is empty. Runtime never imports faker.
- **Stored queries** (`src/domains/*/procs.ts`): TypeScript-authored actions & lookups via the `js-mvc/sql` DSL (`def`/`lookup`/`action`/`param`/`sql`). `fiberPlugin` compiles each `procs.ts` once into a static SQL module (`procs.generated.ts`) with a typed `ProcMap`, deriving result/parameter types from the schema singleton — projections like `t.*` expand to the model interface, aliased columns inherit their type (enums, nullability), and params infer from the columns they bind. Repos execute them via the existing `queryOne`/`queryAll`/`execute` helpers.
- **Requests** (`src/views/routes/*/requests/`): IValidatable form objects with `validate()` method.
- **Framework** (`package/src/`): Reusable framework code imported via `js-mvc/*` path aliases. Contains `ControllerBase`, `RepositoryBase`, `ServiceBase`, `BaseHandler`, validation decorators, error classes, and utilities.
- **Client entry** (`src/.generated/client-entry.ts`): Auto-generated by `fabricPlugin` (see below). It imports the generated handler registry and re-exports `hydrate`/`hydrateEvent`. Loaded by the Layout and referenced by inline hydration scripts.
- **Error handler** (`src/error-handler.tsx`): Project-specific error handling that maps `AppError` subclasses to HTML responses. Imported by controllers via `configureRendering()`.

## Routing Convention

Routes are declared with decorators from `ControllerBase`:

```ts
import { Get, Post, Delete, ControllerBase } from "./ControllerBase";

class MyController extends ControllerBase {
  override base = "api";

  @Get("/")          // GET /api
  @Get("/users")     // GET /api/users
  @Post("/users")    // POST /api/users
  @Get("/users/:id") // GET /api/users/:id
  @Delete("/users")  // DELETE /api/users
}
```

- Any valid Hono path works (`:id`, `*` wildcards, nested segments, etc.).
- The full route is `base` + decorator `path`.

## Guard Decorators

Use validation/guard decorators to handle cross-cutting concerns before route handlers:

```ts
import { Exists, Validate } from "js-mvc/validation/decorators";
import { parseRequestBody } from "js-mvc/validation";
import { ProposeTenetRequest } from "../../domains/requests/ProposeTenetRequest";

class TenetsController extends ControllerBase {
  @Get("/:slug")
  @Exists("tenet", (c) => tenetsRepo(c.env.DB).findOneBy({ slug: c.req.param("slug")! }))
  async show(c: Context) {
    const tenet = c.get("tenet"); // loaded by @Exists, throws 404 if missing
    // ...
  }

  @Post("/")
  @Validate(ProposeTenetRequest)
  async create(c: Context) {
    const input = parseRequestBody(c) as ProposeTenetRequest; // already validated
    // ...
  }
}
```

> **Body parsing:** `@Validate` reads the request body parsed by the
> `parseBody()` middleware (`js-mvc/validation`). Mount it globally
> (`app.use("*", parseBody())`) or per controller. It parses JSON as-is
> and unflattens form bodies into nested objects/arrays, storing the
> result on the context under `BODY_KEY`. Handlers read it via
> `parseRequestBody(c)` or `c.get(BODY_KEY)` — never call `c.req.json()` /
> `c.req.parseBody()` directly.

## Repository Security

`RepositoryBase` includes built-in validation to prevent SQL injection:

### Column Name Validation

All methods that build SQL from object keys (`create`, `update`, `findOneBy`, `findAllBy`, `existsBy`, `deleteBy`) validate column names using `validateColumnName()`:

```ts
// Safe — valid column names
await repo.findOneBy({ slug: "my-tenet" });
await repo.create({ title: "New Tenet", status: "draft" });

// Unsafe — throws Error: Unsafe column name: "123abc"
await repo.findOneBy({ "123abc": "value" } as any);
```

Column names must match `/^[a-zA-Z_]\w*$/` (start with letter/underscore, then alphanumeric/underscore).

### ORDER BY Validation

`findAll({ orderBy })` validates the ORDER BY clause using `validateOrderBy()`:

```ts
// Safe — valid ORDER BY
await repo.findAll({ orderBy: "created_at DESC" });
await repo.findAll({ orderBy: "status, title ASC" });

// Unsafe — throws Error: Unsafe ORDER BY clause
await repo.findAll({ orderBy: "id; DROP TABLE users" });
```

Only allows column names, commas, spaces, and ASC/DESC keywords. SQL keywords like UNION, SELECT, DROP are rejected.

### Null Handling in Dynamic Finders

Dynamic finders handle null values correctly using `IS NULL` (since `col = NULL` is always false in SQL):

```ts
// Finds users where avatar_url IS NULL
await usersRepo(db).findOneBy({ avatar_url: null });

// Generates: WHERE avatar_url IS NULL AND login = ?
await usersRepo(db).findOneBy({ avatar_url: null, login: "alice" });
```

### Empty Criteria Protection

Dynamic finders throw on empty criteria to prevent accidental full-table operations:

```ts
// Throws: Empty criteria is not allowed. Use findAll() for unfiltered queries.
await repo.findOneBy({});
await repo.deleteBy({});
```

## Client-Side Handlers — Use `useHandler()` Always

**Never write `data-controller`, `data-action`, or hydration scripts by hand.** Always use the `useHandler()` component factory from `js-mvc/client/useHandler`. It renders the element, generates a unique id, and emits an inline `<script type="module">` that hydrates the handler onto that element — the handler ships with its HTML, and no handler name appears in the markup.

```tsx
import { useHandler } from "js-mvc/client";
import { AddOptionHandler } from "views/handlers/AddOptionHandler";

const AddOption = useHandler(AddOptionHandler);

// Wrapper + Trigger — handler scoped to a container
<AddOption start="2">
  <div data-option-container>{content}</div>
  <AddOption.Trigger event="click" method="add">
    <button>Add</button>
  </AddOption.Trigger>
</AddOption>

// Trigger-only — handler lives on the element itself
const Confirm = useHandler(ConfirmHandler);
<Confirm.Trigger event="click" method="ask" message="Are you sure?">
  <button class="primary">Approve</button>
</Confirm.Trigger>
```

Extra props passed to `Wrapper` or `Trigger` are automatically converted to `data-{key}` attributes on the element (read in the handler via `this.data("key")`). Known HTML attributes (`class`, `style`, `data-*`, `aria-*`, ...) pass through unchanged. The handler name is derived from the class name and used only internally to key the client registry — you never write it.

### Creating a New Handler

Handlers extend `BaseHandler`. The name is derived from the class name (`DismissHandler` → `"dismiss"`) at runtime — no decorator or static declaration is needed:

```ts
import { BaseHandler } from "js-mvc/client";

export class DismissHandler extends BaseHandler {
  override connect(): void {
    // Called when the handler is hydrated onto its element
  }

  hide(): void {
    // Called when data-action="click->hide" fires
  }
}
```

New client handlers are auto-registered by `fabricPlugin` at build
time. The plugin glob-discovers any file under `src/views/handlers/` whose
name ends in `*Handler.ts`, generates a registration module
(`src/.generated/handlers.ts`) and a client entry module
(`src/.generated/client-entry.ts`, which imports the handlers and re-exports
the framework's `hydrate`/`hydrateEvent`). There is no manual `register(...)`
step and no hand-written client entry file — just drop a new `*Handler.ts`
file in the handlers directory and it will be picked up automatically.

## Layout / Rendering

Controllers wrap every route response in a layout automatically via `configureRendering()`:

```ts
import { ControllerBase, Get } from "js-mvc/controller/ControllerBase";
import { Layout } from "views/routes/Shared/Layout";
import { handleError } from "error-handler";

class MyController extends ControllerBase {
  override base = "my";

  constructor() {
    super();
    this.configureRendering({ layout: Layout, handleError });
  }
}
```

- Use `c.render(<View />)` to render JSX wrapped in Layout
- Controllers that need auth call `this._app.use("*", requireAuth())` in their constructor
- The Layout receives all values set via `c.set()` (e.g., `user`) plus `currentPath`

## Conventions

- `"type": "module"` in package.json — always use ESM imports.
- `noImplicitOverride: true` in tsconfig — `override` keyword required on derived class members.
- `wrangler.jsonc` is gitignored (contains real D1/KV IDs). Use `wrangler.jsonc.example` as template.
- `worker-configuration.d.ts` is auto-generated by `npm run cf-typegen`; do not hand-edit.
- Decorators follow the **Stage 3 TC39 proposal** (not `experimentalDecorators`).
  `reflect-metadata` is **not** used — metadata is stored via `context.metadata`
  and read back via `Constructor[Symbol.metadata]`. A `Symbol.metadata` polyfill
  is included in `ControllerBase.tsx` for environments that lack it.
- Views use **semantic HTML** and rely on **Pico CSS defaults** for styling. Inline styles are prohibited.
  Custom layouts use CSS Modules in the same directory (e.g., `index.module.css`, `new.module.css`).
- Framework code lives in `package/` and is imported via `js-mvc/*` path aliases.
  Application code lives in `src/` and imports framework code, never the reverse.
- Build scripts have been replaced by Vite plugins (`fabricPlugin`, `threadPlugin`, `fiberPlugin`, `fiberPlugin`, `fiberPlugin`, `fabricPlugin`).
