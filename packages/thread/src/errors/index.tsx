export type StatusCode =
  | 100 | 101
  | 200 | 201 | 204
  | 301 | 302 | 304
  | 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429
  | 500 | 502 | 503;

export class AppError extends Error {
  readonly statusCode: StatusCode;
  override name: string = "AppError";

  constructor(message: string, statusCode: StatusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  override name = "NotFound";
  constructor(message = "Could not be found") {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  override name = "Unauthorized";
  constructor(message = "You must be logged in") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  override name = "Forbidden";
  constructor(message = "You don't have permission to do that") {
    super(message, 403);
  }
}

export class ValidationError extends AppError {
  override name = "Validation Error";
  readonly fields?: Record<string, string>;

  constructor(message = "Invalid input", fields?: Record<string, string>) {
    super(message, 400);
    this.fields = fields;
  }
}

export class ConflictError extends AppError {
  override name = "Conflict";
  constructor(message = "Resource already exists") {
    super(message, 409);
  }
}

export class RateLimitError extends AppError {
  override name = "Rate Limited";
  constructor(message = "Too many requests, try again later") {
    super(message, 429);
  }
}

export class ServerError extends AppError {
  override name = "Server Error";
  constructor(message = "Something went wrong on our end") {
    super(message, 500);
  }
}
