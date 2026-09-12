import { Hono } from "hono";
import { parseBody } from "@spindle/spindle/thread";

import TenetsController from "views/routes/Tenets/controller";
import TenetsApiController from "views/routes/Tenets/controller.api";
import WellKnownController from "views/routes/WellKnown/controller";
import AuthController from "views/routes/Auth/controller";

import { applySchema } from "@spindle/spindle/fiber";
import { applySeed } from "@spindle/spindle/fiber";
import { schemaDef } from "./.generated/schema";
import { seedDef } from "./.generated/seed";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Run DB schema initialization once on first request
let initialized = false;
let initFailed = false;
let initPromise: Promise<void> | null = null;

app.use("*", async (c, next) => {
  // If a previous initialization attempt failed, reject all requests
  // rather than serving with an uninitialized database
  if (initFailed) {
    return c.text("Database unavailable — check server logs", 503);
  }

  if (!initialized) {
    if (!initPromise) {
      initPromise = (async () => {
        const env = c.env as unknown as Record<string, unknown>;
        if (!env.DB) {
          console.error(
            "DB binding is not available. Available keys:",
            Object.keys(env),
          );
          initFailed = true;
          return;
        }
        try {
          await applySchema(env.DB as D1Database, schemaDef);
          if (import.meta.env.DEV) {
            await applySeed(env.DB as D1Database, schemaDef, seedDef);
            console.log("Database seeded");
          }
          initialized = true;
          console.log("Database initialized");
        } catch (e) {
          console.error("Database init failed:", e);
          initFailed = true;
        }
      })();
    }
    await initPromise;

    // Check again after awaiting — init may have failed
    if (initFailed) {
      return c.text("Database unavailable — check server logs", 503);
    }
  }
  await next();
});

// Parse request bodies once, correctly (JSON as-is, forms unflattened)
// so every route and guard reads a canonical body from the context —
// circumventing Hono's gotcha of the body being readable only once and
// only through the parser matching the content type.
app.use("*", parseBody());

TenetsController.register(app);
TenetsApiController.register(app);
WellKnownController.register(app);
AuthController.register(app);

// Redirect root to /tenets
app.get("/", (c) => c.redirect("/tenets"));

export default app;

