"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthMeData {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    systemRole: "SYSTEM_ADMIN" | "USER";
    locale: "th" | "en";
    emailVerified: boolean;
    createdAt: string;
  };
  organizations: Array<{
    orgId: string;
    name: string;
    slug: string;
    role: "ORG_OWNER" | "ORG_ADMIN" | "MEMBER";
  }>;
}

async function fetchMeWithRefresh(): Promise<AuthMeData | null> {
  let res = await fetch("/api/v1/auth/me", { credentials: "include" });

  if (res.status === 401) {
    const refreshed = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!refreshed.ok) return null;
    res = await fetch("/api/v1/auth/me", { credentials: "include" });
  }

  if (!res.ok) return null;
  const json = (await res.json()) as { data: AuthMeData };
  return json.data;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMeWithRefresh,
    retry: false,
  });

  async function logout(allDevices = false) {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allDevices }),
      credentials: "include",
    });
    queryClient.setQueryData(["auth-me"], null);
  }

  return {
    ...query,
    user: query.data?.user ?? null,
    organizations: query.data?.organizations ?? [],
    logout,
  };
}
