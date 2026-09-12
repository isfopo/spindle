# js-mvc

Cloudflare Worker using **Hono** with server-side JSX (`hono/jsx`). MVC architecture with framework code extracted into a reusable `js-mvc` package.

---

## Getting started

```bash
npm install
npm run dev
```

```bash
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```bash
npm run cf-typegen
```

---

## Project structure

```
├── package/              # js-mvc framework (reusable)
│   ├── src/              # Controllers, repositories, client handlers, utils
│   └── plugins/          # Vite plugins (CSS build, SQL types, client bundle)
├── src/                  # Application code
│   ├── .generated/       # Auto-generated (handlers, client entry, SQL types)
│   ├── domains/             # Repositories, models, SQL queries
│   ├── error-handler.tsx # Project-specific error handling
│   ├── middleware/      # Auth and other middleware
│   └── views/            # Controllers, views, components, handlers
├── vite.config.ts        # Vite configuration with js-mvc plugins
└── vitest.config.ts      # Test configuration
```

---

## Architecture

The project uses a two-layer structure:

- **`package/`** — Framework code (`js-mvc`). Import via `js-mvc/*` path aliases. Contains `ControllerBase`, `RepositoryBase`, `BaseHandler`, validation, error classes, and Vite plugins.
- **`src/`** — Application code. Contains controllers, views, services, repositories, and project-specific error handling.

Controllers import from `js-mvc/controller/ControllerBase` and call `configureRendering()` to wire up the shared layout and error handler.

---

## Build process

Standalone build scripts (`scripts/build-css.ts`, `scripts/build-client.ts`) have been replaced by Vite plugins, one per branch plus a unified entry:

| Plugin | Purpose |
|---|---|
| `spindlePlugin` | Unified entry — runs all three branches from one options object |
| `fiberPlugin` | Generates db-types, derived `schema.sql`, the runtime schema module, the compiled seed module, and typed `procs.generated.ts` modules |
| `fabricPlugin` | Combines, scopes, inlines SVGs, minifies CSS; auto-registers client handlers |
| `threadPlugin` | Bundles client-side TypeScript via esbuild |

All plugins are configured in `vite.config.ts` and run automatically during `npm run dev` and `npm run build`.

---

## License

MIT
