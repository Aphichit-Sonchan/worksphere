import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { ok, parseJson, route } from "./route";
import { SECURITY_HEADERS } from "./security";

describe("HTTP Route Envelope, Validation, Security Headers & CSRF Integration (WS-702)", () => {
  const sampleSchema = z.object({
    name: z.string().min(2),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  });

  const postHandler = route(async (request) => {
    const body = await parseJson(request, sampleSchema);
    return ok({ created: true, ...body }, { status: 201, meta: { version: 1 } });
  });

  it("wraps valid JSON responses with { data, meta } envelope and strict security headers", async () => {
    const req = new Request("http://localhost:3000/api/v1/demo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: "Kanban Engine", priority: "HIGH" }),
    });

    const res = await postHandler(req, {});
    expect(res.status).toBe(201);
    for (const [header, expected] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(header)).toBe(expected);
    }

    const payload = (await res.json()) as {
      data: { created: boolean; name: string; priority: string };
      meta: { version: number };
    };
    expect(payload.data).toEqual({ created: true, name: "Kanban Engine", priority: "HIGH" });
    expect(payload.meta).toEqual({ version: 1 });
  });

  it("returns 422 VALIDATION_ERROR on invalid schema and 400 BAD_REQUEST on malformed JSON", async () => {
    const invalidSchemaReq = new Request("http://localhost:3000/api/v1/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", priority: "INVALID" }),
    });
    const res422 = await postHandler(invalidSchemaReq, {});
    expect(res422.status).toBe(422);
    const body422 = (await res422.json()) as { error: { code: string } };
    expect(body422.error.code).toBe("VALIDATION_ERROR");

    const brokenJsonReq = new Request("http://localhost:3000/api/v1/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });
    const res400 = await postHandler(brokenJsonReq, {});
    expect(res400.status).toBe(400);
    const body400 = (await res400.json()) as { error: { code: string } };
    expect(body400.error.code).toBe("BAD_REQUEST");
  });

  it("blocks cross-site forged state-changing requests with 403 FORBIDDEN while allowing GET", async () => {
    const forgedPost = new Request("http://localhost:3000/api/v1/demo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil-phishing.invalid",
      },
      body: JSON.stringify({ name: "CSRF", priority: "HIGH" }),
    });
    const res = await postHandler(forgedPost, {});
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("FORBIDDEN");

    const getHandler = route(async () => ok({ healthy: true }));
    const crossGet = new Request("http://localhost:3000/api/v1/demo", {
      method: "GET",
      headers: { Origin: "https://external-reader.invalid" },
    });
    const getRes = await getHandler(crossGet, {});
    expect(getRes.status).toBe(200);
  });

  it("maps Prisma unique/not-found errors and AppError codes into clean HTTP envelopes", async () => {
    const prismaConflictRoute = route(async () => {
      throw { code: "P2002" };
    });
    const r409 = await prismaConflictRoute(new Request("http://localhost:3000/api/v1/x"), {});
    expect(r409.status).toBe(409);

    const prismaNotFoundRoute = route(async () => {
      throw { code: "P2025" };
    });
    const r404 = await prismaNotFoundRoute(new Request("http://localhost:3000/api/v1/x"), {});
    expect(r404.status).toBe(404);

    const domainConflictRoute = route(async () => {
      throw new AppError("VERSION_CONFLICT", "Version mismatch", { currentVersion: 3 });
    });
    const rDomain = await domainConflictRoute(new Request("http://localhost:3000/api/v1/x"), {});
    expect(rDomain.status).toBe(409);
    const body = (await rDomain.json()) as { error: { details: { currentVersion: number } } };
    expect(body.error.details.currentVersion).toBe(3);
  });
});
