import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/v1/health", () => {
  it("returns 200 ok envelope on shallow health check", async () => {
    const res = await GET(new Request("http://localhost:3000/api/v1/health"), {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { status: string; uptimeSeconds: number } };
    expect(json.data.status).toBe("ok");
    expect(typeof json.data.uptimeSeconds).toBe("number");
  });

  it("returns structured service statuses on deep health check", async () => {
    const res = await GET(new Request("http://localhost:3000/api/v1/health?deep=1"), {});
    const json = (await res.json()) as {
      data: {
        status: string;
        services: {
          database: { status: string };
          redis: { status: string };
          storage: { status: string; driver: string };
        };
      };
    };
    expect([200, 503]).toContain(res.status);
    expect(json.data.services.storage.status).toBe("ok");
    expect(["ok", "unconfigured", "error"]).toContain(json.data.services.database.status);
    expect(["ok", "unconfigured", "error"]).toContain(json.data.services.redis.status);
  });
});
