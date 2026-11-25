/** มาตรฐาน Error Codes ตาม docs/api-spec.md §1.2 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "DEPENDENCY_CYCLE"
  | "DEPENDENCY_INCOMPLETE"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  DEPENDENCY_CYCLE: 409,
  DEPENDENCY_INCOMPLETE: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("BAD_REQUEST", message, details);
export const unauthenticated = (message = "Authentication required") =>
  new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError("FORBIDDEN", message);
export const notFound = (message = "Resource not found") =>
  new AppError("NOT_FOUND", message);
export const conflict = (
  message: string,
  code: Extract<
    ErrorCode,
    "CONFLICT" | "VERSION_CONFLICT" | "DEPENDENCY_CYCLE" | "DEPENDENCY_INCOMPLETE"
  > = "CONFLICT",
  details?: unknown,
) => new AppError(code, message, details);
