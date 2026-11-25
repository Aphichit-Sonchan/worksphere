"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useUiStore } from "@/stores/ui-store";

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  role: "ORG_OWNER" | "ORG_ADMIN" | "MEMBER";
  workspaceCount: number;
  memberCount: number;
  createdAt: string;
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function useOrganizations(enabled = true) {
  const queryClient = useQueryClient();
  const { activeOrgId, setActiveOrgId } = useUiStore();

  const query = useQuery<OrganizationItem[]>({
    queryKey: ["organizations"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/v1/organizations", { credentials: "include" });
      if (!res.ok) return [];
      const json = (await res.json()) as { data: OrganizationItem[] };
      return json.data;
    },
  });

  const list = useMemo(() => query.data ?? [], [query.data]);
  const activeOrg = list.find((o) => o.id === activeOrgId) ?? list[0] ?? null;

  useEffect(() => {
    if (list.length > 0 && !list.some((o) => o.id === activeOrgId)) {
      setActiveOrgId(list[0]!.id);
    } else if (list.length === 0 && activeOrgId !== null && query.isSuccess) {
      setActiveOrgId(null);
    }
  }, [list, activeOrgId, setActiveOrgId, query.isSuccess]);

  async function refreshOrganizations() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      queryClient.invalidateQueries({ queryKey: ["auth-me"] }),
    ]);
  }

  return {
    ...query,
    organizations: list,
    activeOrg,
    setActiveOrgId,
    refreshOrganizations,
  };
}
