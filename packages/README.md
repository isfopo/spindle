# js-mvc

MVC framework for Cloudflare Workers built on Hono with server-side JSX

---

## Features

- **Decorator-based routing** — Stage 3 TC39 decorators (`@Get`, `@Post`, etc.) on controller methods
- **Guard pipeline** — `@Exists`, `@Authorize`, `@Validate` decorators run before handlers
- **SQL repository layer** — Generic CRUD, dynamic finders, typed `.sql` file queries, injection-safe
- **Client-side handlers** — `useHandler()` factory wires server JSX to client controllers without manual attributes
- **CSS-only interactivity** — `useHide()`/`useDisable()` factories generate scoped CSS rules for show/hide/disable based on form state
- **Vite plugins** — SQL transform, SQL type generation, CSS build, client bundle

---

## Installation

Requires `hono` as a peer dependency.

---

## Quick start

### Controller

```ts
import { ControllerBase, Get, Post } from "js-mvc/controller/ControllerBase"
import { Exists, Validate } from "js-mvc/validation/decorators"
import { parseRequestBody } from "js-mvc/validation"
import { MyRequest } from "./requests"

class TenetsController extends ControllerBase {
  override base = "/tenets"

  @Get("/:slug")
  @Exists("tenet", (c) => repo(c.env.DB).findOneBy({ slug: c.req.param("slug")! }))
  async show(c) {
    const tenet = c.get("tenet")
    return c.render(<TenetView tenet={tenet} />)
  }

  @Post("/")
  @Validate(MyRequest)
  async create(c) {
    const input = parseRequestBody(c) as MyRequest
    // ...
  }
}
```

> **Body parsing:** `@Validate` reads the request body parsed by the
> `parseBody()` middleware from `js-mvc/validation` — mount it globally
> (`app.use("*", parseBody())`) or per controller. It parses JSON as-is
> and unflattens form bodies into nested objects/arrays, storing the
> result on the context under `BODY_KEY`. Handlers read it via
> `parseRequestBody(c)` or `c.get(BODY_KEY)` — never call `c.req.json()` /
> `c.req.parseBody()` directly.

### Repository

```ts
import { RepositoryBase } from "js-mvc/repository/RepositoryBase"

interface Tenet { id: number; slug: string; title: string; status: string }

class TenetRepo extends RepositoryBase<Tenet> {
  override readonly tableName = "tenets"
}

// Per-request factory
const repo = (db) => new TenetRepo(db)

// Usage
const tenet = await repo(db).findOneBy({ slug: "my-tenet" })
const drafts = await repo(db).findAllBy({ status: "draft" })
```

### Client handler

```tsx
import { BaseHandler } from "js-mvc/client/BaseHandler"
import { useHandler } from "js-mvc/client/useHandler"

class DismissHandler extends BaseHandler {
  hide() {
    // called when a Trigger fires with method="hide"
  }
}

const Dismiss = useHandler(DismissHandler)

<Dismiss>
  <div class="card">
    <p>Notification content</p>
    <Dismiss.Trigger event="click" method="hide">
      <button>Close</button>
    </Dismiss.Trigger>
  </div>
</Dismiss>
```

Handlers are registered automatically: `fabricPlugin` glob-discovers
every `*Handler.ts` file and generates the registration module at build time,
so you never write a `register(...)` call or enumerate handler imports.

### CSS-only interactivity

```tsx
import { useHide } from "js-mvc/client/useHide"
import { useDisable } from "js-mvc/client/useDisable"

// Show/hide content based on a condition (animate = "fade", "slide-up", ...)
const Plan = useHide<"free" | "pro">({ scope: "plan" })

<Plan>
  <Plan.Trigger value="free">
    <input type="radio" name="plan" value="free" />
  </Plan.Trigger>
  <Plan.Trigger value="pro">
    <input type="radio" name="plan" value="pro" />
  </Plan.Trigger>
  <Plan.Show when="free" animate="fade">Free tier content</Plan.Show>
  <Plan.Show when="pro" animate="fade">Pro tier content</Plan.Show>
</Plan>

// Dim & block an element until a condition is met (no animation presets)
const Confirm = useDisable({ scope: "confirm" })

<Confirm>
  <Confirm.Trigger value="agree">
    <input type="checkbox" name="agree" />
  </Confirm.Trigger>
  <Confirm.Disable when="unchecked">
    <button type="submit">Submit</button>
  </Confirm.Disable>
</Confirm>
```

---

## Philosophy

### Domain-Driven Design

- **Repository pattern** — `RepositoryBase` abstracts data access behind a domain-facing interface. Controllers and services never touch raw SQL
- **Service layer** — `ServiceBase` holds business logic, shared between HTML and API controllers
- **Request objects** — `IValidatable` encapsulates input validation as domain concepts, not scattered controller checks
- **Per-request factories** — Repos are instantiated per-request (`tenetsRepo(db)`), not shared singletons. No stale state, trivial to test
- **Domain errors** — Typed error hierarchy (`NotFoundError`, `ValidationError`, `ForbiddenError`, `ConflictError`) maps directly to HTTP status codes

### Separation of Concerns

- **Strict MVC layers** — Controllers handle routing/rendering, services handle business rules, repositories handle data access
- **HTML vs API controllers** — Same pattern, different output. Business logic lives in services
- **Server vs client** — `useHandler()` generates `data-*` attributes server-side; `BaseHandler` consumes them client-side. No manual strings to keep in sync
- **CSS-only vs JS interactivity** — `useHide()`/`useDisable()` generate scoped CSS rules. `useHandler()` wires JS handlers. Choose the right tool per interaction

### Convention Over Configuration

- **Decorator routing** — `@Get("/users")` on a method with `base = "api"` produces `GET /api/users`. No route table
- **Guard pipeline** — `@Exists`, `@Authorize`, `@Validate` stack declaratively. Execution order matches declaration order
- **Generic CRUD** — Extend `RepositoryBase<T>`, declare `tableName`, inherit `findById`, `findAll`, `create`, `update`, `delete`, `count`
- **Dynamic finders** — `findOneBy({ slug })`, `findAllBy({ status })`. No query builder, no ORM DSL

### Small Deliveries

- **Thin base classes** — `ServiceBase` is 46 lines. `ControllerBase` is 161 lines. Each does one thing well
- **No heavy ORM** — Parameterized SQL with injection guards. Complex queries live in `.sql` files
- **No frontend framework** — `hono/jsx` for server rendering. Lightweight client handler dispatcher. No hydration, no bundle bloat
- **No magic** — Decorators store metadata on `Symbol.metadata`, read back explicitly. No reflection, no runtime code generation

### Developer Experience

- **Declarative over imperative** — `@Validate(Request)` instead of manual checks. `useHandler("dismiss")` instead of hand-written `data-*` attributes
- **Type safety by default** — `noImplicitOverride: true`, generic repositories, typed request objects, Stage 3 decorators
- **Safety nets built in** — Column name validation, ORDER BY validation, empty criteria protection, correct null handling
- **Instant feedback** — Vite HMR for CSS. Layout updates without full reload

---

## Architecture

| Layer | Base class | Purpose |
|---|---|---|
| Controllers | `ControllerBase` | Route handling, rendering, guard execution |
| Services | `ServiceBase` | Business logic, validation helpers |
| Repositories | `RepositoryBase` | Data access, CRUD, typed SQL queries |
| Client handlers | `BaseHandler` | DOM event wiring, target resolution |

### Request flow

1. Decorators collect route metadata on the class via `Symbol.metadata`
2. `ControllerBase.register()` reads metadata and mounts routes on Hono
3. Guards execute in declaration order before the handler
4. `c.render()` wraps JSX in the shared layout

---

## API reference

### Exports

| Subpath | What it provides |
|---|---|
| `js-mvc/controller/ControllerBase` | `ControllerBase`, `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch` |
| `js-mvc/repository/RepositoryBase` | `RepositoryBase` with CRUD and dynamic finders |
| `js-mvc/service/ServiceBase` | `ServiceBase` with error helpers |
| `js-mvc/validation/decorators` | `@Exists`, `@Authorize`, `@Validate` |
| `js-mvc/validation` | `parseBody()` middleware, `parseRequestBody()`, `unflattenFormBody()`, `BODY_KEY` |
| `js-mvc/validation/IValidatable` | `IValidatable` interface for request objects |
| `js-mvc/errors` | `AppError`, `NotFoundError`, `ValidationError`, etc. |
| `js-mvc/client/useHandler` | `useHandler()` factory for client handlers |
| `js-mvc/client/useHide` | `useHide()` factory for CSS-only show/hide (animated) |
| `js-mvc/client/useDisable` | `useDisable()` factory for CSS-only disable/enable |
| `js-mvc/client/BaseHandler` | `BaseHandler` for custom client controllers |
| `js-mvc/client/dispatcher` | Client-side handler dispatcher |
| `js-mvc/adapters/d1` | Cloudflare D1 database adapter |
| `js-mvc/plugins` | Vite plugins (`spindlePlugin`, `fiberPlugin`, `fabricPlugin`, `threadPlugin`) |

---

## Security

### Column name validation

All repository methods that build SQL from object keys validate column names against `/^[a-zA-Z_]\w*$/`:

```ts
// Safe
await repo.findOneBy({ slug: "my-tenet" })

// Throws: Unsafe column name: "123abc"
await repo.findOneBy({ "123abc": "value" } as any)
```

### ORDER BY validation

`findAll({ orderBy })` rejects clauses containing SQL keywords:

```ts
await repo.findAll({ orderBy: "created_at DESC" })  // OK
await repo.findAll({ orderBy: "id; DROP TABLE x" }) // Throws
```

### Empty criteria protection

Dynamic finders reject empty objects to prevent accidental full-table operations:

```ts
await repo.findOneBy({}) // Throws
```

---

## Decorators

### Route decorators

```ts
@Get("/")          // GET /base
@Post("/users")    // POST /base/users
@Put("/users/:id") // PUT /base/users/:id
@Delete("/users")  // DELETE /base/users
```

### Guard decorators

Stack guards above handlers. They execute in declaration order:

```ts
@Get("/:id")
@Exists("user", (c) => usersRepo(c.env.DB).findById(Number(c.req.param("id"))))
@Authorize((c) => {
  if (c.get("user").role !== "admin") throw new ForbiddenError()
})
async adminView(c) {
  const user = c.get("user") // loaded by @Exists
  // ...
}
```

---

## Vite plugins

One plugin per branch, plus a unified `spindlePlugin` for all three. Every
plugin takes a single options object grouped by concern; all paths have
convention defaults, so `{}` works out of the box.

```ts
import { spindlePlugin, fiberPlugin } from "js-mvc/plugins"

// Everything in one call:
export default {
  plugins: [
    spindlePlugin({
      fabric: {
        css: {
          sourceDirs: ["src/styles", "src/components"],
        },
        handlers: {
          // Handlers are glob-discovered (default: src/views/handlers/**/*.ts)
          // and auto-registered; no per-handler paths in source.
          include: "src/views/handlers/**/*Handler.ts",
        },
      },
    }),
  ],
}

// Or just the data layer (schema, seed, stored queries):
export default {
  plugins: [fiberPlugin()],
}
```

`fiberPlugin` runs schema, seed, and stored-query compilation in one ordered
pass: `src/domains/schema.ts` → `src/.generated/schema.ts`, the derived
`schema.sql` + `db-types.d.ts`, `src/domains/seed.ts` → `src/.generated/seed.ts`,
and every `procs.ts` → `procs.generated.ts`.

`fabricPlugin` bundles CSS (combine, scope `.module.css`, inline SVGs, minify)
and generates `src/.generated/handlers.ts` — which imports and registers every
discovered `*Handler` class with the hydration runtime — plus
`src/.generated/client-entry.ts`, the module the browser loads. There is no
hand-written client entry file; adding a new handler requires dropping a
`*Handler.ts` file into the handlers directory and nothing else.

`threadPlugin` bundles the generated client entry into a static JS asset via
esbuild (production builds only).

---

## TypeScript

The package uses `noImplicitOverride: true` and Stage 3 decorators. Your `tsconfig.json` should include:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "noImplicitOverride": true,
    "lib": ["ESNext", "DOM"]
  }
}
```

> **Note:** `"DOM"` is required in `lib` for client-side features (`BaseHandler`, `useHandler`, `useHide`, `useDisable`).
> Server-only projects can omit it, but most projects will need it.
