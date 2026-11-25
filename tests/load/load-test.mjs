import http from "node:http";
import { performance } from "node:perf_hooks";

const VUS = Number(process.env.VUS ?? 100);
const REQUESTS_PER_VU = Number(process.env.REQUESTS_PER_VU ?? 25);
const EXTERNAL_URL = process.env.TARGET_URL ?? "";

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

/**
 * สร้างเซิร์ฟเวอร์จำลองโหลดภายในโปรเซสที่จำลองพฤติกรรมจริงของ WorkSphere API:
 * - Read-through Cache + TTL สำหรับ Project Meta และ Dashboard Analytics
 * - Cursor Pagination สำหรับรายการงาน
 * - Optimistic Locking (`version`) ที่คืน `409 VERSION_CONFLICT` เมื่ออัปเดตชนกันพร้อมกัน
 */
async function startSelfHostedBenchmarkServer() {
  const cache = new Map();
  let taskVersion = 1;
  const tasks = Array.from({ length: 60 }, (_, i) => ({
    id: `tsk_${i + 1}`,
    key: `ENG-${i + 1}`,
    title: `Benchmark Task #${i + 1}`,
    priority: i % 3 === 0 ? "HIGH" : "MEDIUM",
    completed: i % 2 === 0,
  }));

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    if (req.method === "GET" && url.startsWith("/api/v1/projects/proj_1/tasks")) {
      const slice = tasks.slice(0, 50);
      res.writeHead(200);
      res.end(JSON.stringify({ data: slice, meta: { nextCursor: "tsk_50", hasMore: true } }));
      return;
    }

    if (req.method === "GET" && url.startsWith("/api/v1/projects/proj_1")) {
      let cached = cache.get("proj:proj_1:meta");
      if (!cached) {
        cached = JSON.stringify({
          data: {
            project: { id: "proj_1", key: "ENG", name: "Engineering" },
            columns: ["To Do", "In Progress", "Done"],
          },
        });
        cache.set("proj:proj_1:meta", cached);
      }
      res.writeHead(200);
      res.end(cached);
      return;
    }

    if (req.method === "GET" && url.startsWith("/api/v1/organizations/org_1/dashboard/summary")) {
      let summary = cache.get("org:org_1:dashboard");
      if (!summary) {
        const completed = tasks.filter((t) => t.completed).length;
        summary = JSON.stringify({
          data: {
            totals: {
              totalTasks: tasks.length,
              completedTasks: completed,
              openTasks: tasks.length - completed,
              completionRate: Math.round((completed / tasks.length) * 100),
            },
          },
        });
        cache.set("org:org_1:dashboard", summary);
      }
      res.writeHead(200);
      res.end(summary);
      return;
    }

    if (req.method === "PATCH" && url.startsWith("/api/v1/tasks/tsk_1")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const parsed = raw ? JSON.parse(raw) : {};
        if (parsed.version !== undefined && parsed.version !== taskVersion) {
          res.writeHead(409);
          res.end(
            JSON.stringify({
              error: { code: "VERSION_CONFLICT", details: { currentVersion: taskVersion } },
            }),
          );
          return;
        }
        taskVersion += 1;
        cache.delete("org:org_1:dashboard");
        res.writeHead(200);
        res.end(JSON.stringify({ data: { id: "tsk_1", version: taskVersion } }));
      });
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({ data: { status: "ok" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}`, getVersion: () => taskVersion };
}

async function runVirtualUser(vuId, baseUrl, externalMode, latencies, counters) {
  for (let i = 0; i < REQUESTS_PER_VU; i += 1) {
    const roll = (vuId + i) % 10;
    let path = "/api/v1/health";
    let method = "GET";
    let body;

    if (!externalMode) {
      if (roll < 4) {
        path = "/api/v1/projects/proj_1";
      } else if (roll < 7) {
        path = "/api/v1/organizations/org_1/dashboard/summary";
      } else if (roll < 9) {
        path = "/api/v1/projects/proj_1/tasks?limit=50";
      } else {
        path = "/api/v1/tasks/tsk_1";
        method = "PATCH";
        body = JSON.stringify({ title: `Updated by VU-${vuId}`, version: 1 + (i % 3) });
      }
    }

    const t0 = performance.now();
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      await res.arrayBuffer();
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);

      if (res.status >= 200 && res.status < 300) {
        counters.ok2xx += 1;
      } else if (res.status === 409) {
        counters.conflict409 += 1;
      } else {
        counters.unexpectedErrors += 1;
      }
    } catch {
      counters.unexpectedErrors += 1;
    }
  }
}

async function main() {
  const externalMode = Boolean(EXTERNAL_URL);
  const hosted = externalMode ? null : await startSelfHostedBenchmarkServer();
  const baseUrl = externalMode ? EXTERNAL_URL : hosted.baseUrl;

  const latencies = [];
  const counters = { ok2xx: 0, conflict409: 0, unexpectedErrors: 0 };

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: VUS }, (_, vu) =>
      runVirtualUser(vu + 1, baseUrl, externalMode, latencies, counters),
    ),
  );
  const durationMs = performance.now() - startedAt;

  if (hosted) {
    await new Promise((resolve) => hosted.server.close(resolve));
  }

  latencies.sort((a, b) => a - b);
  const totalRequests = VUS * REQUESTS_PER_VU;
  const avgMs =
    latencies.length > 0
      ? Number((latencies.reduce((acc, v) => acc + v, 0) / latencies.length).toFixed(2))
      : 0;
  const rps = Number(((totalRequests / durationMs) * 1000).toFixed(1));

  const report = {
    mode: externalMode ? "external" : "self-hosted-benchmark",
    virtualUsers: VUS,
    requestsPerVu: REQUESTS_PER_VU,
    totalRequests,
    durationMs: Number(durationMs.toFixed(1)),
    throughputRps: rps,
    responses: counters,
    latencyMs: {
      min: percentile(latencies, 0),
      avg: avgMs,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length > 0 ? Number(latencies[latencies.length - 1].toFixed(2)) : 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (counters.unexpectedErrors > 0) {
    process.exitCode = 1;
  }
}

main();
