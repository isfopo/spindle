// D1Database already satisfies the Database interface — no adapter code required.
// This file exists for discoverability and future adapter documentation.
//
// Usage:
//   import type { D1Database } from "@cloudflare/workers-types";
//   import type { Database } from "js-mvc/types";
//
//   // D1Database is structurally compatible with Database
//   const db: Database = env.DB; // works directly
//
// No re-export is provided here to avoid coupling the package to
// @cloudflare/workers-types. Consumers should import D1Database directly
// from the Cloudflare types package.

