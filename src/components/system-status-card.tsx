"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Database, HardDrive, RefreshCw, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ServiceState {
  status: "ok" | "unconfigured" | "error";
  latencyMs?: number;
  driver?: string;
}

interface HealthResponse {
  data: {
    status: "ok" | "degraded";
    timestamp: string;
    uptimeSeconds: number;
    services: {
      database: ServiceState;
      redis: ServiceState;
      storage: ServiceState;
    };
  };
}

function mapVariant(status: ServiceState["status"]): "ok" | "warn" | "error" {
  if (status === "ok") return "ok";
  if (status === "unconfigured") return "warn";
  return "error";
}

function dotColor(status: ServiceState["status"]): string {
  if (status === "ok") return "bg-emerald-500";
  if (status === "unconfigured") return "bg-amber-500";
  return "bg-rose-500";
}

export function SystemStatusCard() {
  const t = useTranslations("Status");
  const { data, isLoading, isFetching, refetch } = useQuery<HealthResponse>({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/v1/health?deep=1");
      return res.json() as Promise<HealthResponse>;
    },
  });

  const services = data?.data.services;

  return (
    <Card className="border-slate-200/90 bg-white">
      <CardHeader className="mb-5 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Activity className="h-4 w-4" />
            </span>
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {t("refresh")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading || !services ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-16 animate-pulse rounded-xl border border-slate-100 bg-slate-50"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs">
                  <Database className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">PostgreSQL</div>
                  <div className="text-xs text-slate-500">
                    {services.database.latencyMs !== undefined
                      ? `${services.database.latencyMs} ms`
                      : "Neon Serverless"}
                  </div>
                </div>
              </div>
              <Badge variant={mapVariant(services.database.status)}>
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor(services.database.status)}`} />
                {t(`states.${services.database.status}`)}
              </Badge>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs">
                  <Server className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">Redis</div>
                  <div className="text-xs text-slate-500">
                    {services.redis.status === "unconfigured"
                      ? t("memoryFallback")
                      : `${services.redis.latencyMs ?? 0} ms`}
                  </div>
                </div>
              </div>
              <Badge variant={mapVariant(services.redis.status)}>
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor(services.redis.status)}`} />
                {t(`states.${services.redis.status}`)}
              </Badge>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs">
                  <HardDrive className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">Object Storage</div>
                  <div className="text-xs uppercase text-slate-500">
                    {services.storage.driver ?? "local"}
                  </div>
                </div>
              </div>
              <Badge variant={mapVariant(services.storage.status)}>
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor(services.storage.status)}`} />
                {t(`states.${services.storage.status}`)}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
