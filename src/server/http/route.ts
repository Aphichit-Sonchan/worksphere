import { z } from "zod";
import { logger } from "@/server/infra/logger";
import { AppError } from "./errors";
import { assertTrustedOrigin, SECURITY_HEADERS } from "./security";

type Handler<Ctx> = (request: Request, context: Ctx) => Promise<Response>;

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function ok<T>(data: T, init?: { meta?: Record<string, unknown>; status?: number }) {
  return Response.json(
    init?.meta ? { data, meta: init.meta } : { data },
    { status: init?.status ?? 200 },
  );
}

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return withSecurityHeaders(
    Response.json({ error: { code, message, details } }, { status }),
  );
}

/**
 * ห่อ Route Handler ทุกตัว: ตรวจ Origin (CSRF), ใส่ Security Headers และแปลง Error Envelope
 */
export function route<Ctx = unknown>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (request, context) => {
    try {
      assertTrustedOrigin(request);
      const res = await handler(request, context);
      return withSecurityHeaders(res);
    } catch (err) {
      if (err instanceof AppError) {
        return errorResponse(err.code, err.message, err.status, err.details);
      }
      if (err instanceof z.ZodError) {
        return errorResponse("VALIDATION_ERROR", "Invalid request input", 422, z.flattenError(err));
      }
      if (typeof err === "object" && err !== null && "code" in err) {
        const prismaCode = (err as { code?: string }).code;
        if (prismaCode === "P2002") {
          return errorResponse("CONFLICT", "A record with these unique values already exists", 409);
        }
        if (prismaCode === "P2025") {
          return errorResponse("NOT_FOUND", "Requested record was not found", 404);
        }
      }
      logger.error("unhandled api error", {
        method: request.method,
        url: request.url,
        error: err instanceof Error ? err.message : String(err),
      });
      return errorResponse("INTERNAL", "Internal server error", 500);
    }
  };
}

export async function parseJson<T extends z.ZodType>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
  }
  return schema.parse(body) as z.infer<T>;
}
