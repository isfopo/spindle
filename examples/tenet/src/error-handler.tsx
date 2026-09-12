import { Context } from "hono";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ServerError,
} from "@spindle/spindle/thread";
import { ResultsView } from "views/routes/Shared/Results";

export function handleError(
  c: Context,
  error: unknown,
): Response | Promise<Response> {
  if (error instanceof NotFoundError) {
    c.status(404);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof UnauthorizedError) {
    c.status(401);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof ForbiddenError) {
    c.status(403);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof ValidationError) {
    c.status(400);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof ConflictError) {
    c.status(409);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof RateLimitError) {
    c.status(429);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof ServerError) {
    c.status(500);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }
  if (error instanceof AppError) {
    c.status(error.statusCode);
    return c.html(
      <ResultsView variant="error" message={error.message} error={error} />,
    );
  }

  c.status(500);
  return c.html(
    <ResultsView
      variant="error"
      message={error instanceof Error ? error.message : "Unknown error"}
      error={error instanceof Error ? error : undefined}
    />,
  );
}

