import { Context, Env } from "hono";
import { Get, Post, ControllerBase } from "@spindle/spindle/thread";
import { Exists, Validate } from "@spindle/spindle/thread";
import { Layout } from "views/routes/Shared/Layout";
import { handleError } from "error-handler";
import { requireAuth } from "middleware/auth";
import { tenetService } from "domains/tenet/service";
import { ProposeTenetRequest } from "views/routes/Tenets/requests/ProposeTenetRequest";
import { VoteRequest } from "views/routes/Tenets/requests/VoteRequest";
import { FindTenetGuard } from "views/routes/Tenets/guards/FindTenetGuard";
import type { UserRow } from "domains/user/model";
import type { TenetRow } from "domains/tenet/model";
import { TransitionRequest } from "./requests/TransitionRequest";

class TenetsApiController<T extends Env> extends ControllerBase<T> {
  override base = "api/tenets";

  constructor() {
    super();
    this.configureRendering({ layout: Layout, handleError });
    this._app.use("*", requireAuth());
  }

  @Get("/")
  async list(c: Context) {
    const result = await tenetService.list((c.env as CloudflareBindings).DB);
    return c.json(result);
  }

  @Get("/:slug")
  @Exists(FindTenetGuard)
  async show(c: Context) {
    const tenetRow = c.get("tenet") as TenetRow;
    const detail = await tenetService.getBySlug(
      (c.env as CloudflareBindings).DB,
      tenetRow.slug,
    );
    return c.json(detail);
  }

  @Post("/")
  @Validate(ProposeTenetRequest)
  async create(c: Context) {
    const user = c.get("user") as UserRow;
    const input = c.get("body") as ProposeTenetRequest;
    const tenet = await tenetService.propose(
      (c.env as CloudflareBindings).DB,
      user.id,
      input,
    );
    return c.json(tenet, 201);
  }

  @Post("/:slug/vote")
  @Exists(FindTenetGuard)
  @Validate(VoteRequest)
  async vote(c: Context) {
    const user = c.get("user") as UserRow;
    const tenetRow = c.get("tenet") as TenetRow;
    const input = c.get("body") as VoteRequest;
    await tenetService.vote(
      (c.env as CloudflareBindings).DB,
      user.id,
      tenetRow.slug,
      input,
    );
    return c.json({ success: true });
  }

  @Post("/:slug/status")
  @Exists(FindTenetGuard)
  async transition(c: Context) {
    const user = c.get("user") as UserRow;
    const tenetRow = c.get("tenet") as TenetRow;
    const body = c.get("body") as TransitionRequest;

    const detail = await tenetService.transitionStatus(
      (c.env as CloudflareBindings).DB,
      user.id,
      tenetRow.slug,
      body.status,
    );
    return c.json(detail);
  }
}

export default new TenetsApiController();

